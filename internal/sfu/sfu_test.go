package sfu

import (
	"context"
	"github.com/pion/webrtc/v4"
	"strings"
	"testing"
)

func TestTrickleAnswersAdvertiseLateCandidates(t *testing.T) {
	for _, incremental := range []bool{false, true} {
		e, err := NewEngine(Options{})
		if err != nil {
			t.Fatal(err)
		}
		client, err := webrtc.NewPeerConnection(webrtc.Configuration{})
		if err != nil {
			t.Fatal(err)
		}
		_, err = client.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo)
		if err != nil {
			t.Fatal(err)
		}
		offer, err := client.CreateOffer(nil)
		if err != nil {
			t.Fatal(err)
		}
		var callbacks []func(webrtc.ICECandidateInit)
		if incremental {
			callbacks = append(callbacks, func(webrtc.ICECandidateInit) {})
		}
		stream, answer, err := e.Publish(context.Background(), "capability", "test", "camera", offer, callbacks...)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(answer.SDP, "a=ice-options:trickle") != incremental {
			t.Fatalf("trickle advertisement mismatch: incremental=%v", incremental)
		}
		stream.Close()
		client.Close()
		e.Close()
	}
}

func TestProviderChangeRestoresDirectPolicyForLocalFallback(t *testing.T) {
	policy := webrtc.ICETransportPolicyRelay
	e, err := NewEngine(Options{ICEConfiguration: func() webrtc.Configuration { return webrtc.Configuration{ICETransportPolicy: policy} }})
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	for _, want := range []webrtc.ICETransportPolicy{webrtc.ICETransportPolicyRelay, webrtc.ICETransportPolicyAll} {
		policy = want
		pc, err := e.newPC()
		if err != nil {
			t.Fatal(err)
		}
		if pc.GetConfiguration().ICETransportPolicy != want {
			t.Fatal("media provider policy did not change")
		}
		pc.Close()
	}
}

func TestCancelledGatheringReturnsNoAnswer(t *testing.T) {
	e, err := NewEngine(Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer pc.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if answer, err := e.complete(ctx, pc); err == nil || answer != nil {
		t.Fatal("cancelled negotiation returned an answer")
	}
}

func TestCountMedia(t *testing.T) {
	sdp := "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendonly\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\nm=video 0 UDP/TLS/RTP/SAVPF 96\r\nm=video 9 UDP 96\r\na=recvonly\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n"
	if n := countMedia(sdp); n != 2 {
		t.Fatalf("countMedia=%d want 2", n)
	}
	if n := countMedia("v=0\r\n"); n != 1 {
		t.Fatalf("empty sdp should count as 1, got %d", n)
	}
}
