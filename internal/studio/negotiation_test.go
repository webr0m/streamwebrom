package studio

import (
	"context"
	"testing"
	"time"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
	"github.com/webr0m/streamwebrom/internal/sfu"
	"golang.org/x/time/rate"
)

func TestLateControlsCannotCloseReplacementSubscription(t *testing.T) {
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
	track, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2}, "audio", "publisher")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = client.AddTrack(track); err != nil {
		t.Fatal(err)
	}
	offer, err := client.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	gathered := webrtc.GatheringCompletePromise(client)
	if err = client.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	select {
	case <-gathered:
	case <-time.After(5 * time.Second):
		t.Fatal("client ICE timed out")
	}
	stream, answer, err := e.Publish(context.Background(), "stable-audio", "publisher", "camera", *client.LocalDescription())
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	if err = client.SetRemoteDescription(*answer); err != nil {
		t.Fatal(err)
	}
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		ticker := time.NewTicker(20 * time.Millisecond)
		defer ticker.Stop()
		var seq uint16
		for {
			select {
			case <-ticker.C:
				seq++
				_ = track.WriteRTP(&rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: seq, Timestamp: uint32(seq) * 960}, Payload: []byte{0xf8, 0xff, 0xfe}})
			case <-stop:
				return
			}
		}
	}()
	select {
	case <-stream.Ready():
	case <-time.After(7 * time.Second):
		t.Fatal("publisher not ready")
	}
	r, _, _ := newRoom("scoped-audio", "", false, "")
	r.AddStream(stream)
	p := newPeer(nil, rate.NewLimiter(30, 60))
	p.room = r
	p.Role = RoleGuest
	h := &Hub{o: Options{Engine: e}}
	if err = h.subscribe(context.Background(), p, Msg{Stream: stream.ID, Trickle: true, Negotiation: "old-subscription"}); err != nil {
		t.Fatal(err)
	}
	if err = h.subscribe(context.Background(), p, Msg{Stream: stream.ID, Trickle: true, Negotiation: "new-subscription"}); err != nil {
		t.Fatal(err)
	}
	current := p.subs[stream.ID]
	defer current.Close()
	for _, kind := range []string{"unsubscribe", "answer"} {
		if err = h.handle(context.Background(), p, Msg{Type: kind, Stream: stream.ID, Negotiation: "old-subscription", SDP: &webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: "stale-invalid-answer"}}); err != nil {
			t.Fatal(err)
		}
		if p.subs[stream.ID] != current || current.PC().ConnectionState() == webrtc.PeerConnectionStateClosed {
			t.Fatalf("old %s closed the new subscription", kind)
		}
	}
	if err = h.handle(context.Background(), p, Msg{Type: "unsubscribe", Stream: stream.ID, Negotiation: "new-subscription"}); err != nil {
		t.Fatal(err)
	}
	if p.subs[stream.ID] != nil {
		t.Fatal("current unsubscribe did not remove subscription")
	}
}

func TestLateUnpublishCannotCloseReplacementCamera(t *testing.T) {
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
	_, err = client.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo)
	if err != nil {
		t.Fatal(err)
	}
	offer, err := client.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	s, _, err := e.Publish(context.Background(), "camera", "owner", "camera", offer, func(webrtc.ICECandidateInit) {})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	oldPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer oldPC.Close()
	r, _, _ := newRoom("camera-scope", "", false, "")
	r.AddStream(s)
	p := newPeer(nil, rate.NewLimiter(30, 60))
	p.room = r
	p.Role = RoleGuest
	p.pubs[s.ID] = s
	p.icePCs["old-publish"] = oldPC
	p.icePCs["new-publish"] = s.PC()
	h := &Hub{}
	if err = h.handle(context.Background(), p, Msg{Type: "unpublish", Stream: s.ID, Negotiation: "old-publish"}); err != nil {
		t.Fatal(err)
	}
	if p.pubs[s.ID] != s || r.Stream(s.ID) != s || s.PC().ConnectionState() == webrtc.PeerConnectionStateClosed {
		t.Fatal("stale camera cleanup removed current publication")
	}
}
