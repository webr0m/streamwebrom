package studio

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
	"github.com/webr0m/streamwebrom/internal/sfu"
	"golang.org/x/time/rate"
)

func TestReconnectReclaimsStreamBeforeSlowNetworkClose(t *testing.T) {
	e, err := sfu.NewEngine(sfu.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	client, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	client.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo)
	offer, err := client.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	s, _, err := e.Publish(context.Background(), "stable-camera", "old-peer", "camera", offer, func(webrtc.ICECandidateInit) {})
	if err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	s.OnClose(func() { close(entered); <-release })
	r, _, _ := newRoom("slow-close", "", false, "")
	r.AddStream(s)
	sockets := make(chan *websocket.Conn, 1)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err == nil {
			sockets <- c
		}
	}))
	defer ts.Close()
	ws, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(ts.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	p := newPeer(<-sockets, rate.NewLimiter(30, 60))
	p.ID = "old-peer"
	p.Role = RoleGuest
	p.room = r
	p.pass = "admitted"
	p.pubs[s.ID] = s
	r.peers[p.ID] = p
	h := &Hub{o: Options{RejoinGrace: time.Second}}
	done := make(chan struct{})
	go func() { h.leave(p); close(done) }()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("teardown did not reach the slow close")
	}
	unreserve, err := r.reserveStream(s.ID, "reconnected-peer", false, 8)
	if err != nil {
		t.Fatal("reconnection blocked by stale stream ownership:", err)
	}
	unreserve()
	close(release)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("leave did not finish")
	}
}
