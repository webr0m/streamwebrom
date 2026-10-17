// Package record writes forwarded RTP to disk without re-encoding
// (ISO-BMFF muxing is delegated to ffmpeg when it is available).
//
// Each guest is recorded as a separate, full quality ISO track - the
// "local multi-track recording" feature of tools like Riverside/StreamYard,
// done server side so a weak guest uplink never ruins the program.
package record

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media/h264writer"
	"github.com/pion/webrtc/v4/pkg/media/ivfwriter"
	"github.com/pion/webrtc/v4/pkg/media/oggwriter"

	"github.com/webr0m/streamwebrom/internal/sfu"
)

type rtpWriter interface {
	WriteRTP(*rtp.Packet) error
	Close() error
}

// lockedWriter makes media writers safe: the forwarder may call from its own goroutine
// while Stop closes the file.
type lockedWriter struct {
	mu     sync.Mutex
	w      rtpWriter
	closed bool
}

func (l *lockedWriter) WriteRTP(p *rtp.Packet) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return io.ErrClosedPipe
	}
	return l.w.WriteRTP(p)
}

func (l *lockedWriter) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return nil
	}
	l.closed = true
	return l.w.Close()
}

// Recording is an in-progress capture of one stream.
type Recording struct {
	Stream  string    `json:"stream"`
	Files   []string  `json:"files"`
	Started time.Time `json:"started"`
	Output  string    `json:"output,omitempty"`

	writers []*lockedWriter
	removes []func()
}

// Recorder manages recordings under a directory.
type Recorder struct {
	Dir    string
	FFmpeg string

	mu     sync.Mutex
	active map[string]*Recording // key room/stream
}

// New creates a recorder.
func New(dir, ffmpeg string) *Recorder {
	return &Recorder{Dir: dir, FFmpeg: ffmpeg, active: map[string]*Recording{}}
}

var unsafeChars = regexp.MustCompile(`[^a-zA-Z0-9_-]+`)

// SafeName strips anything that could escape the recordings directory.
func SafeName(s string) string {
	s = unsafeChars.ReplaceAllString(s, "_")
	if len(s) > 64 {
		s = s[:64]
	}
	if s == "" {
		s = "x"
	}
	return s
}

// Start begins recording every track of s.
func (r *Recorder) Start(room string, s *sfu.Stream) (*Recording, error) {
	key := room + "/" + s.ID
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.active[key]; ok {
		return nil, errors.New("already recording")
	}
	dir := filepath.Join(r.Dir, "recordings", SafeName(room))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	ts := time.Now().Format("20060102-150405")
	rec := &Recording{Stream: s.ID, Started: time.Now()}
	for _, f := range s.Forwarders() {
		base := filepath.Join(dir, fmt.Sprintf("%s-%s-%s", SafeName(s.ID), ts, f.Kind.String()))
		w, path, err := open(base, f.Codec)
		if err != nil {
			rec.stop()
			return nil, err
		}
		lw := &lockedWriter{w: w}
		rec.writers = append(rec.writers, lw)
		rec.Files = append(rec.Files, path)
		rec.removes = append(rec.removes, f.AddSink(lw))
	}
	if len(rec.writers) == 0 {
		return nil, errors.New("stream has no tracks yet")
	}
	r.active[key] = rec
	s.OnClose(func() { _, _ = r.Stop(room, s.ID) })
	return rec, nil
}

func open(base string, c webrtc.RTPCodecCapability) (rtpWriter, string, error) {
	switch strings.ToLower(c.MimeType) {
	case strings.ToLower(webrtc.MimeTypeOpus):
		p := base + ".ogg"
		w, err := oggwriter.New(p, c.ClockRate, max16(c.Channels, 2))
		return w, p, err
	case strings.ToLower(webrtc.MimeTypeVP8):
		p := base + ".ivf"
		w, err := ivfwriter.New(p, ivfwriter.WithCodec(webrtc.MimeTypeVP8))
		return w, p, err
	case strings.ToLower(webrtc.MimeTypeVP9):
		p := base + ".ivf"
		w, err := ivfwriter.New(p, ivfwriter.WithCodec(webrtc.MimeTypeVP9))
		return w, p, err
	case strings.ToLower(webrtc.MimeTypeAV1):
		p := base + ".ivf"
		w, err := ivfwriter.New(p, ivfwriter.WithCodec(webrtc.MimeTypeAV1))
		return w, p, err
	case strings.ToLower(webrtc.MimeTypeH264):
		p := base + ".h264"
		w, err := h264writer.New(p)
		return w, p, err
	}
	return nil, "", fmt.Errorf("cannot record codec %s", c.MimeType)
}

func max16(v uint16, d uint16) uint16 {
	if v == 0 {
		return d
	}
	return v
}

func (rec *Recording) stop() {
	for _, rm := range rec.removes {
		rm()
	}
	for _, w := range rec.writers {
		_ = w.Close()
	}
}

// Stop ends a recording and, when ffmpeg exists, muxes the tracks into one .mkv.
func (r *Recorder) Stop(room, stream string) (*Recording, error) {
	key := room + "/" + stream
	r.mu.Lock()
	rec, ok := r.active[key]
	delete(r.active, key)
	r.mu.Unlock()
	if !ok {
		return nil, errors.New("not recording")
	}
	rec.stop()
	if out, err := r.mux(rec); err == nil {
		rec.Output = out
	}
	return rec, nil
}

// Active lists running recordings for a room.
func (r *Recorder) Active(room string) []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []string
	for k, rec := range r.active {
		if strings.HasPrefix(k, room+"/") {
			out = append(out, rec.Stream)
		}
	}
	return out
}

func (r *Recorder) mux(rec *Recording) (string, error) {
	if r.FFmpeg == "" || len(rec.Files) == 0 {
		return "", errors.New("no ffmpeg")
	}
	bin, err := exec.LookPath(r.FFmpeg)
	if err != nil {
		return "", err
	}
	out := strings.TrimSuffix(rec.Files[0], filepath.Ext(rec.Files[0]))
	out = strings.TrimSuffix(strings.TrimSuffix(out, "-video"), "-audio") + ".mkv"
	args := []string{"-hide_banner", "-loglevel", "error", "-y"}
	for _, f := range rec.Files {
		args = append(args, "-i", f)
	}
	for i := range rec.Files {
		args = append(args, "-map", fmt.Sprint(i))
	}
	args = append(args, "-c", "copy", out)
	if err := exec.Command(bin, args...).Run(); err != nil {
		return "", err
	}
	return out, nil
}
