package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"

	"github.com/webr0m/streamwebrom/internal/config"
	"github.com/webr0m/streamwebrom/internal/record"
	"github.com/webr0m/streamwebrom/internal/server"
	"github.com/webr0m/streamwebrom/internal/sfu"
	"github.com/webr0m/streamwebrom/internal/studio"
	"github.com/webr0m/streamwebrom/web"
)

type env struct {
	ts  *httptest.Server
	hub *studio.Hub
	dir string
}

func newEnv(t *testing.T) *env {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	eng, err := sfu.NewEngine(sfu.Options{Logger: log, GatherTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = eng.Close() })
	cfg := config.Default()
	cfg.STUN = nil
	dir := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	hub := studio.NewHub(ctx, studio.Options{Engine: eng, Recorder: record.New(dir, "ffmpeg"), FFmpeg: "ffmpeg",
		MaxRooms: 10, MaxPeers: 8, MaxMsgBytes: 1 << 20, MsgRate: 100, MsgBurst: 100, RoomTTL: time.Minute,
		CheckOrigin: server.CheckOrigin(cfg), Logger: log})
	ts := httptest.NewServer(server.New(cfg, hub, web.Files, log).Handler())
	t.Cleanup(ts.Close)
	return &env{ts: ts, hub: hub, dir: dir}
}

func (e *env) createRoom(t *testing.T, body string) studio.Keys {
	t.Helper()
	res, err := http.Post(e.ts.URL+"/api/rooms", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 201 {
		b, _ := io.ReadAll(res.Body)
		t.Fatalf("create room: %d %s", res.StatusCode, b)
	}
	var k studio.Keys
	if err := json.NewDecoder(res.Body).Decode(&k); err != nil {
		t.Fatal(err)
	}
	return k
}

type wsClient struct {
	t *testing.T
	c *websocket.Conn
}

func (e *env) dial(t *testing.T) *wsClient {
	t.Helper()
	c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(e.ts.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close() })
	return &wsClient{t: t, c: c}
}

func (w *wsClient) send(m map[string]any) {
	w.t.Helper()
	if err := w.c.WriteJSON(m); err != nil {
		w.t.Fatal(err)
	}
}

// expect reads until a message of type typ arrives.
func (w *wsClient) expect(typ string) studio.Msg {
	w.t.Helper()
	_ = w.c.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		var m studio.Msg
		if err := w.c.ReadJSON(&m); err != nil {
			w.t.Fatalf("waiting for %q: %v", typ, err)
		}
		if m.Type == typ {
			return m
		}
	}
}

func TestPagesAndHeaders(t *testing.T) {
	e := newEnv(t)
	for _, p := range []string{"/", "/studio", "/guest", "/view", "/js/rtc.js", "/css/app.css", "/api/health", "/api/config"} {
		res, err := http.Get(e.ts.URL + p)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 200 {
			t.Errorf("%s: status %d", p, res.StatusCode)
		}
		if res.Header.Get("X-Content-Type-Options") != "nosniff" || !strings.Contains(res.Header.Get("Content-Security-Policy"), "frame-ancestors") {
			t.Errorf("%s: missing security headers", p)
		}
	}
	res, _ := http.Get(e.ts.URL + "/api/admin/stats")
	if res.StatusCode != 401 {
		t.Errorf("admin without token should be 401, got %d", res.StatusCode)
	}
}

func TestRoomValidation(t *testing.T) {
	e := newEnv(t)
	for _, bad := range []string{`{"room":"A B"}`, `{"room":"../etc"}`, `{"room":"x"}`} {
		res, _ := http.Post(e.ts.URL+"/api/rooms", "application/json", strings.NewReader(bad))
		if res.StatusCode == 201 {
			t.Errorf("room %s should be rejected", bad)
		}
	}
	k := e.createRoom(t, `{"room":"show-1","password":"secret"}`)
	if k.HostKey == "" || k.ViewKey == "" || k.PushKey == "" {
		t.Fatal("missing keys")
	}
	res, _ := http.Post(e.ts.URL+"/api/rooms", "application/json", strings.NewReader(`{"room":"show-1"}`))
	if res.StatusCode != 409 {
		t.Errorf("duplicate room should be 409, got %d", res.StatusCode)
	}
}

func TestSignallingRolesChatAndState(t *testing.T) {
	e := newEnv(t)
	k := e.createRoom(t, `{"room":"talk","password":"pw"}`)

	host := e.dial(t)
	host.send(map[string]any{"type": "join", "room": "talk", "role": "host", "key": "wrong"})
	if m := host.expect("error"); !strings.Contains(m.Error, "host key") {
		t.Fatalf("bad host key accepted: %+v", m)
	}
	host.send(map[string]any{"type": "join", "room": "talk", "role": "host", "key": k.HostKey, "name": "Rodrigo"})
	w := host.expect("welcome")
	if w.Role != studio.RoleHost || w.Keys == nil || w.Keys.ViewKey != k.ViewKey {
		t.Fatalf("unexpected welcome %+v", w)
	}

	guest := e.dial(t)
	guest.send(map[string]any{"type": "join", "room": "talk", "name": "<b>Ana</b>", "password": "nope"})
	guest.expect("error")
	guest.send(map[string]any{"type": "join", "room": "talk", "name": "<b>Ana</b>", "password": "pw"})
	gw := guest.expect("welcome")
	if gw.Keys != nil {
		t.Fatal("guest must not receive room keys")
	}
	pj := host.expect("peer-joined")
	if strings.ContainsAny(pj.Peer.Name, "<>") {
		t.Fatalf("name not sanitised: %q", pj.Peer.Name)
	}

	// guests cannot control the show
	guest.send(map[string]any{"type": "state", "value": map[string]any{"layout": "solo"}})
	if m := guest.expect("error"); !strings.Contains(m.Error, "host") {
		t.Fatalf("expected host-only error, got %+v", m)
	}
	guest.send(map[string]any{"type": "kick", "target": w.PeerID})
	guest.expect("error")

	// chat reaches everyone
	guest.send(map[string]any{"type": "chat", "text": "hola!"})
	if c := host.expect("chat"); c.Comment.Text != "hola!" || c.Comment.From == "" {
		t.Fatalf("chat %+v", c)
	}

	// host state changes are validated and broadcast
	host.send(map[string]any{"type": "state", "value": map[string]any{"layout": "nope"}})
	host.expect("error")
	host.send(map[string]any{"type": "state", "value": map[string]any{"brand": map[string]any{"color": "red; background:url(x)"}}})
	host.expect("error")
	host.send(map[string]any{"type": "state", "value": map[string]any{"layout": "pip", "banner": map[string]any{"id": "b1", "text": "En vivo", "ticker": true}}})
	st := guest.expect("state")
	if st.State.Layout != "pip" || st.State.Banner == nil || st.State.Banner.Text != "En vivo" {
		t.Fatalf("state not broadcast: %+v", st.State)
	}

	// viewer with view key, invisible to others
	view := e.dial(t)
	view.send(map[string]any{"type": "join", "room": "talk", "role": "viewer", "key": k.ViewKey})
	view.expect("welcome")

	// kick
	host.send(map[string]any{"type": "kick", "target": gw.PeerID})
	guest.expect("kicked")
}

func TestLobby(t *testing.T) {
	e := newEnv(t)
	k := e.createRoom(t, `{"room":"lobby-room","lobby":true}`)
	host := e.dial(t)
	host.send(map[string]any{"type": "join", "room": "lobby-room", "role": "host", "key": k.HostKey})
	host.expect("welcome")
	g := e.dial(t)
	g.send(map[string]any{"type": "join", "room": "lobby-room", "name": "Pepe"})
	g.expect("waiting")
	knock := host.expect("knock")
	g.send(map[string]any{"type": "chat", "text": "let me in"})
	g.expect("error")
	host.send(map[string]any{"type": "admit", "target": knock.PeerID})
	g.expect("welcome")
}

// pionClient publishes a fake VP8 track via WHIP and returns the track.
func whipPublish(t *testing.T, url, token string) (*webrtc.PeerConnection, *webrtc.TrackLocalStaticRTP) {
	t.Helper()
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = pc.Close() })
	track, _ := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8, ClockRate: 90000}, "video", "obs")
	if _, err := pc.AddTransceiverFromTrack(track, webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionSendonly}); err != nil {
		t.Fatal(err)
	}
	offer, _ := pc.CreateOffer(nil)
	_ = pc.SetLocalDescription(offer)
	<-webrtc.GatheringCompletePromise(pc)
	req, _ := http.NewRequest("POST", url, strings.NewReader(pc.LocalDescription().SDP))
	req.Header.Set("Content-Type", "application/sdp")
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != 201 {
		t.Fatalf("whip: %d %s", res.StatusCode, body)
	}
	if res.Header.Get("Location") == "" {
		t.Fatal("whip: missing Location header")
	}
	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: string(body)}); err != nil {
		t.Fatal(err)
	}
	return pc, track
}

func pump(ctx context.Context, track *webrtc.TrackLocalStaticRTP) {
	seq := uint16(0)
	ts := uint32(0)
	// Minimal VP8 keyframe-looking payload; the SFU never decodes it.
	payload := append([]byte{0x10, 0x00, 0x00, 0x9d, 0x01, 0x2a}, bytes.Repeat([]byte{0xAB}, 400)...)
	t := time.NewTicker(10 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			seq++
			ts += 3000
			_ = track.WriteRTP(&rtp.Packet{Header: rtp.Header{Version: 2, Marker: true, SequenceNumber: seq, Timestamp: ts, PayloadType: 96}, Payload: payload})
		}
	}
}

func TestWHIPtoWHEPandRecording(t *testing.T) {
	e := newEnv(t)
	k := e.createRoom(t, `{"room":"obs-room"}`)

	// wrong token rejected
	req, _ := http.NewRequest("POST", e.ts.URL+"/whip/obs-room/cam", strings.NewReader("v=0"))
	req.Header.Set("Content-Type", "application/sdp")
	req.Header.Set("Authorization", "Bearer "+k.ViewKey)
	if res, _ := http.DefaultClient.Do(req); res.StatusCode != 401 {
		t.Fatalf("view key must not allow WHIP publish, got %d", res.StatusCode)
	}

	_, track := whipPublish(t, e.ts.URL+"/whip/obs-room/cam", k.PushKey)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go pump(ctx, track)

	// WHEP viewer
	sub, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Close()
	got := make(chan int, 1)
	sub.OnTrack(func(tr *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		n := 0
		buf := make([]byte, 1500)
		for {
			if _, _, err := tr.Read(buf); err != nil {
				return
			}
			n++
			if n == 20 {
				got <- n
			}
		}
	})
	_, _ = sub.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo, webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionRecvonly})
	offer, _ := sub.CreateOffer(nil)
	_ = sub.SetLocalDescription(offer)
	<-webrtc.GatheringCompletePromise(sub)
	r2, _ := http.NewRequest("POST", e.ts.URL+"/whep/obs-room/cam", strings.NewReader(sub.LocalDescription().SDP))
	r2.Header.Set("Content-Type", "application/sdp")
	r2.Header.Set("Authorization", "Bearer "+k.ViewKey)
	res, err := http.DefaultClient.Do(r2)
	if err != nil {
		t.Fatal(err)
	}
	ans, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 201 {
		t.Fatalf("whep: %d %s", res.StatusCode, ans)
	}
	if err := sub.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: string(ans)}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-got:
	case <-time.After(10 * time.Second):
		t.Fatal("WHEP viewer received no media")
	}

	// host records the WHIP stream through the signalling channel
	host := e.dial(t)
	host.send(map[string]any{"type": "join", "room": "obs-room", "role": "host", "key": k.HostKey})
	host.expect("welcome")
	host.send(map[string]any{"type": "record", "action": "start", "stream": "cam"})
	if st := host.expect("state"); len(st.State.Recording) != 1 {
		t.Fatalf("recording not active: %+v", st.State.Recording)
	}
	time.Sleep(500 * time.Millisecond)
	host.send(map[string]any{"type": "record", "action": "stop", "stream": "cam"})
	host.expect("state")
	files, _ := filepath.Glob(filepath.Join(e.dir, "recordings", "obs-room", "cam-*-video.ivf"))
	if len(files) != 1 {
		t.Fatalf("expected one ivf file, got %v", files)
	}
	if fi, _ := os.Stat(files[0]); fi.Size() < 1000 {
		t.Fatalf("recording too small: %d bytes", fi.Size())
	}

	// DELETE ends the WHEP session
	loc := res.Header.Get("Location")
	dr, _ := http.NewRequest("DELETE", e.ts.URL+loc, nil)
	if res, _ := http.DefaultClient.Do(dr); res.StatusCode != 200 {
		t.Fatalf("delete session: %d", res.StatusCode)
	}
}

func TestOriginPolicy(t *testing.T) {
	cfg := config.Default()
	check := server.CheckOrigin(cfg)
	r := httptest.NewRequest("GET", "http://studio.local/ws", nil)
	r.Header.Set("Origin", "http://evil.example")
	if check(r) {
		t.Fatal("cross-origin websocket must be rejected by default")
	}
	r.Header.Set("Origin", "http://studio.local")
	if !check(r) {
		t.Fatal("same-origin websocket must be allowed")
	}
	cfg.AllowedOrigins = []string{"*"}
	r.Header.Set("Origin", "http://evil.example")
	if !server.CheckOrigin(cfg)(r) {
		t.Fatal("* must allow any origin")
	}
}

func TestClientIPTrustsProxyOnlyFromLoopback(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "127.0.0.1:5555"
	r.Header.Set("CF-Connecting-IP", "203.0.113.9")
	if got := server.ClientIP(r); got != "203.0.113.9" {
		t.Fatalf("behind tunnel got %q", got)
	}
	r.RemoteAddr = "198.51.100.7:5555"
	if got := server.ClientIP(r); got != "198.51.100.7" {
		t.Fatalf("spoofed header must be ignored from public peers, got %q", got)
	}
}
