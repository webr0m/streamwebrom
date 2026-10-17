package server_test

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
	"github.com/pion/webrtc/v4/pkg/media/ivfreader"
	"github.com/pion/webrtc/v4/pkg/media/oggreader"
)

// TestMultistreamToRTMP runs the whole pipeline end to end with real media:
// WHIP publish (VP8 + Opus) -> SFU -> ffmpeg transcode -> RTMP server.
// Skipped when ffmpeg is not installed.
func TestMultistreamToRTMP(t *testing.T) {
	ff, err := exec.LookPath("ffmpeg")
	if err != nil || testing.Short() {
		t.Skip("ffmpeg not available")
	}
	dir := t.TempDir()
	ivf, ogg := filepath.Join(dir, "v.ivf"), filepath.Join(dir, "a.ogg")
	gen := exec.Command(ff, "-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "testsrc=size=640x360:rate=30", "-t", "8", "-c:v", "libvpx", "-deadline", "realtime", "-g", "30", "-b:v", "800k", ivf)
	if out, err := gen.CombinedOutput(); err != nil {
		t.Skipf("ffmpeg cannot encode vp8: %v %s", err, out)
	}
	gen = exec.Command(ff, "-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "8", "-c:a", "libopus", "-page_duration", "20000", ogg)
	if out, err := gen.CombinedOutput(); err != nil {
		t.Skipf("ffmpeg cannot encode opus: %v %s", err, out)
	}

	e := newEnv(t)
	k := e.createRoom(t, `{"room":"live-room"}`)

	// publisher
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer pc.Close()
	vt, _ := webrtc.NewTrackLocalStaticSample(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8, ClockRate: 90000}, "video", "program")
	at, _ := webrtc.NewTrackLocalStaticSample(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2}, "audio", "program")
	for _, tr := range []webrtc.TrackLocal{vt, at} {
		if _, err := pc.AddTransceiverFromTrack(tr, webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionSendonly}); err != nil {
			t.Fatal(err)
		}
	}
	offer, _ := pc.CreateOffer(nil)
	_ = pc.SetLocalDescription(offer)
	<-webrtc.GatheringCompletePromise(pc)
	req, _ := http.NewRequest("POST", e.ts.URL+"/whip/live-room/program", strings.NewReader(pc.LocalDescription().SDP))
	req.Header.Set("Content-Type", "application/sdp")
	req.Header.Set("Authorization", "Bearer "+k.HostKey)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	ans, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 201 {
		t.Fatalf("whip %d %s", res.StatusCode, ans)
	}
	_ = pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: string(ans)})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go sendIVF(ctx, ivf, vt)
	go sendOgg(ctx, ogg, at)

	// RTMP sink: ffmpeg in listen mode
	l, _ := net.Listen("tcp", "127.0.0.1:0")
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()
	out := filepath.Join(dir, "out.flv")
	sink := exec.CommandContext(ctx, ff, "-hide_banner", "-loglevel", "error", "-y", "-listen", "1", "-i",
		"rtmp://127.0.0.1:"+itoa(port)+"/live/key", "-c", "copy", out)
	if err := sink.Start(); err != nil {
		t.Fatal(err)
	}
	time.Sleep(700 * time.Millisecond)

	host := e.dial(t)
	host.send(map[string]any{"type": "join", "room": "live-room", "role": "host", "key": k.HostKey})
	host.expect("welcome")
	time.Sleep(1500 * time.Millisecond) // stream ready
	host.send(map[string]any{"type": "golive", "stream": "program", "dests": []map[string]string{{"name": "local", "url": "rtmp://127.0.0.1:" + itoa(port) + "/live/key"}}})
	st := host.expect("state")
	if !st.State.Live {
		t.Fatalf("not live: %+v", st)
	}
	time.Sleep(5 * time.Second)
	host.send(map[string]any{"type": "endlive"})
	done := make(chan error, 1)
	go func() { done <- sink.Wait() }()
	select {
	case <-done:
	case <-time.After(8 * time.Second):
		_ = sink.Process.Kill()
	}
	fi, err := os.Stat(out)
	if err != nil || fi.Size() < 20_000 {
		t.Fatalf("RTMP output missing or tiny: %v %v", fi, err)
	}
	probe, err := exec.Command(strings.TrimSuffix(ff, "ffmpeg")+"ffprobe", "-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", out).Output()
	if err == nil {
		s := string(probe)
		if !strings.Contains(s, "h264") || !strings.Contains(s, "aac") {
			t.Fatalf("expected h264+aac in RTMP output, got %q", s)
		}
	}
}

func itoa(i int) string { return strconv.Itoa(i) }

func sendIVF(ctx context.Context, path string, t *webrtc.TrackLocalStaticSample) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	r, _, err := ivfreader.NewWith(f)
	if err != nil {
		return
	}
	tick := time.NewTicker(time.Second / 30)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		frame, _, err := r.ParseNextFrame()
		if errors.Is(err, io.EOF) {
			return
		}
		if err != nil {
			return
		}
		_ = t.WriteSample(media.Sample{Data: frame, Duration: time.Second / 30})
	}
}

func sendOgg(ctx context.Context, path string, t *webrtc.TrackLocalStaticSample) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	r, _, err := oggreader.NewWith(f)
	if err != nil {
		return
	}
	var last uint64
	tick := time.NewTicker(20 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		page, h, err := r.ParseNextPage()
		if err != nil {
			return
		}
		d := time.Duration(h.GranulePosition-last) * time.Second / 48000
		last = h.GranulePosition
		_ = t.WriteSample(media.Sample{Data: page, Duration: d})
	}
}
