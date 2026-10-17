package sfu

import "testing"

func TestCountMedia(t *testing.T) {
	sdp := "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendonly\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\nm=video 0 UDP/TLS/RTP/SAVPF 96\r\nm=video 9 UDP 96\r\na=recvonly\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n"
	if n := countMedia(sdp); n != 2 {
		t.Fatalf("countMedia=%d want 2", n)
	}
	if n := countMedia("v=0\r\n"); n != 1 {
		t.Fatalf("empty sdp should count as 1, got %d", n)
	}
}
