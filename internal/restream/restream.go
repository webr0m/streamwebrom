// Package restream pushes a stream to many RTMP(S) destinations at once
// (YouTube, Twitch, Facebook, Kick, LinkedIn, custom) - the StreamYard
// "multistream" feature - using a single ffmpeg process and its tee muxer.
//
// RTP is handed to ffmpeg over loopback UDP with an SDP description, so the
// SFU never decodes anything. H.264 input is copied untouched; VP8/VP9/AV1
// are transcoded to H.264 with zero-latency settings because RTMP/FLV
// cannot carry them.
package restream

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/url"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"

	"github.com/webr0m/streamwebrom/internal/sfu"
)

// Destination is one RTMP target.
type Destination struct {
	Name string `json:"name"`
	URL  string `json:"url"` // rtmp(s)://host/app/key
}

// Validate rejects anything that is not an rtmp/rtmps/srt URL, which also
// prevents ffmpeg protocol tricks (file:, concat:, pipe:...).
func (d Destination) Validate() error {
	u, err := url.Parse(d.URL)
	if err != nil {
		return err
	}
	switch u.Scheme {
	case "rtmp", "rtmps", "srt":
	default:
		return fmt.Errorf("destination %q: only rtmp://, rtmps:// and srt:// are allowed", d.Name)
	}
	if u.Host == "" {
		return fmt.Errorf("destination %q: missing host", d.Name)
	}
	if strings.ContainsAny(d.URL, "|[]\n\r") {
		return fmt.Errorf("destination %q: invalid characters", d.Name)
	}
	return nil
}

// Settings tune the encoder when transcoding is needed.
type Settings struct {
	VideoKbps int `json:"videoKbps"`
	AudioKbps int `json:"audioKbps"`
	FPS       int `json:"fps"`
}

// Status is reported to the studio.
type Status struct {
	Live      bool          `json:"live"`
	Since     int64         `json:"since,omitempty"`
	Targets   []string      `json:"targets,omitempty"`
	LastError string        `json:"lastError,omitempty"`
	Stats     string        `json:"stats,omitempty"`
	Uptime    time.Duration `json:"-"`
}

// Session is a running restream.
type Session struct {
	cancel  context.CancelFunc
	done    chan struct{}
	mu      sync.Mutex
	status  Status
	conns   []*net.UDPConn
	removes []func()
}

// Status returns a snapshot.
func (s *Session) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

// Stop ends the restream.
func (s *Session) Stop() {
	s.cancel()
	<-s.done
}

// Done is closed when ffmpeg exits.
func (s *Session) Done() <-chan struct{} { return s.done }

type udpSink struct {
	conn *net.UDPConn
	pt   uint8
	buf  []byte
	mu   sync.Mutex
}

func (u *udpSink) WriteRTP(p *rtp.Packet) error {
	u.mu.Lock()
	defer u.mu.Unlock()
	p.PayloadType = u.pt
	n, err := p.MarshalTo(u.buf)
	if err != nil {
		return err
	}
	_, err = u.conn.Write(u.buf[:n])
	return err
}

// BuildSDP describes the forwarded tracks for ffmpeg. Exported for tests.
func BuildSDP(tracks []TrackDesc) string {
	var b strings.Builder
	b.WriteString("v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=StreamWebRom\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\n")
	for _, t := range tracks {
		kind := "video"
		if t.Audio {
			kind = "audio"
		}
		fmt.Fprintf(&b, "m=%s %d RTP/AVP %d\r\n", kind, t.Port, t.PT)
		enc := strings.TrimPrefix(strings.TrimPrefix(t.Mime, "video/"), "audio/")
		if t.Audio && t.Channels > 0 {
			fmt.Fprintf(&b, "a=rtpmap:%d %s/%d/%d\r\n", t.PT, enc, t.ClockRate, t.Channels)
		} else {
			fmt.Fprintf(&b, "a=rtpmap:%d %s/%d\r\n", t.PT, enc, t.ClockRate)
		}
		if t.Fmtp != "" {
			fmt.Fprintf(&b, "a=fmtp:%d %s\r\n", t.PT, t.Fmtp)
		}
	}
	return b.String()
}

// TrackDesc is the minimum ffmpeg needs to know about a track.
type TrackDesc struct {
	Audio     bool
	Port      int
	PT        uint8
	Mime      string
	ClockRate uint32
	Channels  uint16
	Fmtp      string
}

// BuildArgs returns ffmpeg arguments. Exported for tests.
func BuildArgs(videoMime string, dests []Destination, st Settings) []string {
	if st.VideoKbps <= 0 {
		st.VideoKbps = 4500
	}
	if st.AudioKbps <= 0 {
		st.AudioKbps = 160
	}
	if st.FPS <= 0 {
		st.FPS = 30
	}
	args := []string{"-hide_banner", "-loglevel", "warning", "-stats_period", "2", "-progress", "pipe:2",
		"-protocol_whitelist", "pipe,udp,rtp", "-fflags", "+genpts+nobuffer", "-flags", "low_delay",
		"-reorder_queue_size", "256", "-analyzeduration", "2000000", "-probesize", "2000000",
		"-f", "sdp", "-i", "pipe:0"}
	if strings.EqualFold(videoMime, webrtc.MimeTypeH264) {
		args = append(args, "-c:v", "copy")
	} else {
		args = append(args, "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
			"-pix_fmt", "yuv420p", "-r", fmt.Sprint(st.FPS), "-g", fmt.Sprint(st.FPS*2),
			"-b:v", fmt.Sprintf("%dk", st.VideoKbps), "-maxrate", fmt.Sprintf("%dk", st.VideoKbps),
			"-bufsize", fmt.Sprintf("%dk", st.VideoKbps*2))
	}
	args = append(args, "-c:a", "aac", "-ar", "48000", "-b:a", fmt.Sprintf("%dk", st.AudioKbps))
	var outs []string
	for _, d := range dests {
		f := "flv"
		if strings.HasPrefix(d.URL, "srt://") {
			f = "mpegts"
		}
		outs = append(outs, fmt.Sprintf("[f=%s:onfail=ignore]%s", f, d.URL))
	}
	args = append(args, "-map", "0", "-flags", "+global_header", "-f", "tee", strings.Join(outs, "|"))
	return args
}

// Start launches the restream for stream s.
func Start(ffmpeg string, s *sfu.Stream, dests []Destination, st Settings, log *slog.Logger) (*Session, error) {
	if len(dests) == 0 {
		return nil, errors.New("no destinations")
	}
	for _, d := range dests {
		if err := d.Validate(); err != nil {
			return nil, err
		}
	}
	bin, err := exec.LookPath(ffmpeg)
	if err != nil {
		return nil, fmt.Errorf("ffmpeg not found (%s): install it or pass -ffmpeg", ffmpeg)
	}
	fwd := s.Forwarders()
	if len(fwd) == 0 {
		return nil, errors.New("stream has no tracks")
	}
	ctx, cancel := context.WithCancel(context.Background())
	sess := &Session{cancel: cancel, done: make(chan struct{})}
	var descs []TrackDesc
	videoMime := ""
	for _, f := range fwd {
		// Reserve a free port, then release it for ffmpeg and connect to it.
		l, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
		if err != nil {
			cancel()
			return nil, err
		}
		port := l.LocalAddr().(*net.UDPAddr).Port
		_ = l.Close()
		conn, err := net.DialUDP("udp", nil, &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: port})
		if err != nil {
			cancel()
			return nil, err
		}
		sess.conns = append(sess.conns, conn)
		pt := f.PT
		if pt == 0 {
			pt = 96
		}
		audio := f.Kind == webrtc.RTPCodecTypeAudio
		if !audio {
			videoMime = f.Codec.MimeType
		}
		descs = append(descs, TrackDesc{Audio: audio, Port: port, PT: pt, Mime: f.Codec.MimeType,
			ClockRate: f.Codec.ClockRate, Channels: f.Codec.Channels, Fmtp: f.Codec.SDPFmtpLine})
	}
	cmd := exec.CommandContext(ctx, bin, BuildArgs(videoMime, dests, st)...)
	cmd.Stdin = strings.NewReader(BuildSDP(descs))
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		cancel()
		return nil, err
	}
	// Give ffmpeg a moment to bind its sockets before media flows.
	time.Sleep(400 * time.Millisecond)
	for i, f := range fwd {
		sess.removes = append(sess.removes, f.AddSink(&udpSink{conn: sess.conns[i], pt: descs[i].PT, buf: make([]byte, 1600)}))
	}
	var names []string
	for _, d := range dests {
		names = append(names, d.Name)
	}
	sess.status = Status{Live: true, Since: time.Now().Unix(), Targets: names}
	go sess.readStats(stderr)
	go func() {
		err := cmd.Wait()
		for _, rm := range sess.removes {
			rm()
		}
		for _, c := range sess.conns {
			_ = c.Close()
		}
		sess.mu.Lock()
		sess.status.Live = false
		if err != nil && ctx.Err() == nil {
			sess.status.LastError = err.Error()
		}
		sess.mu.Unlock()
		log.Info("restream ended", "stream", s.ID, "err", err)
		close(sess.done)
	}()
	s.OnClose(func() { cancel() })
	return sess, nil
}

func (s *Session) readStats(r io.Reader) {
	if r == nil {
		return
	}
	sc := bufio.NewScanner(r)
	stats := map[string]string{}
	for sc.Scan() {
		line := sc.Text()
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			s.mu.Lock()
			s.status.LastError = trim(line, 200)
			s.mu.Unlock()
			continue
		}
		stats[k] = v
		if k == "progress" {
			s.mu.Lock()
			s.status.Stats = fmt.Sprintf("%s fps · %s · %s", stats["fps"], stats["bitrate"], stats["out_time"])
			s.mu.Unlock()
		}
	}
}

func trim(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
