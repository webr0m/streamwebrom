package studio

import (
	"context"
	"github.com/pion/webrtc/v4"
	"golang.org/x/time/rate"
	"testing"
	"time"
)

func TestICEIsScopedToAuthenticatedSocket(t *testing.T) {
	room, _, _ := newRoom("ice-scope", "", false, "")
	p := newPeer(nil, rate.NewLimiter(30, 60))
	p.room, p.Role = room, RoleGuest
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer pc.Close()
	done := make(chan struct{})
	p.registerICE("owned", pc, done)
	h := &Hub{}
	candidate := &webrtc.ICECandidateInit{Candidate: "candidate:1 1 udp 2130706431 127.0.0.1 50000 typ host"}
	if err := h.handle(context.Background(), p, Msg{Type: "ice", Negotiation: "other", Candidate: candidate}); err == nil {
		t.Fatal("unknown negotiation accepted")
	}
	other := newPeer(nil, rate.NewLimiter(30, 60))
	other.room, other.Role = room, RoleGuest
	if err := h.handle(context.Background(), other, Msg{Type: "ice", Negotiation: "owned", Candidate: candidate}); err == nil {
		t.Fatal("another socket can inject ICE")
	}
	if _, err := p.iceCallback(Msg{Trickle: true, Negotiation: "owned"}); err == nil {
		t.Fatal("duplicate negotiation accepted")
	}
	close(done)
	deadline := time.Now().Add(time.Second)
	for {
		p.mu.Lock()
		n := len(p.icePCs)
		p.mu.Unlock()
		if n == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("closed negotiation leaked")
		}
		time.Sleep(time.Millisecond)
	}
}
