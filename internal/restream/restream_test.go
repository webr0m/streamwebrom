package restream

import (
	"strings"
	"testing"
)

func TestDestinationValidate(t *testing.T) {
	ok := []string{"rtmp://a.rtmp.youtube.com/live2/abcd", "rtmps://live-api-s.facebook.com:443/rtmp/k", "srt://host:9000?streamid=x"}
	bad := []string{"file:///etc/passwd", "concat:a|b", "rtmp://", "http://x/y", "rtmp://h/app/key|[f=flv]file.flv", "pipe:1"}
	for _, u := range ok {
		if err := (Destination{Name: "x", URL: u}).Validate(); err != nil {
			t.Errorf("%s should be valid: %v", u, err)
		}
	}
	for _, u := range bad {
		if err := (Destination{Name: "x", URL: u}).Validate(); err == nil {
			t.Errorf("%s should be rejected", u)
		}
	}
}

func TestBuildArgs(t *testing.T) {
	d := []Destination{{Name: "yt", URL: "rtmp://a/live2/k1"}, {Name: "srt", URL: "srt://h:1"}}
	a := strings.Join(BuildArgs("video/H264", d, Settings{}), " ")
	if !strings.Contains(a, "-c:v copy") {
		t.Error("H264 input must be copied, not transcoded")
	}
	if !strings.Contains(a, "[f=flv:onfail=ignore]rtmp://a/live2/k1|[f=mpegts:onfail=ignore]srt://h:1") {
		t.Errorf("tee output wrong: %s", a)
	}
	v := strings.Join(BuildArgs("video/VP8", d, Settings{VideoKbps: 3000, FPS: 60}), " ")
	if !strings.Contains(v, "libx264") || !strings.Contains(v, "-b:v 3000k") || !strings.Contains(v, "-g 120") {
		t.Errorf("VP8 must be transcoded with settings: %s", v)
	}
	if !strings.Contains(v, "-protocol_whitelist pipe,udp,rtp") {
		t.Error("ffmpeg input protocols must be whitelisted")
	}
}

func TestBuildSDP(t *testing.T) {
	s := BuildSDP([]TrackDesc{
		{Audio: true, Port: 5000, PT: 111, Mime: "audio/opus", ClockRate: 48000, Channels: 2, Fmtp: "minptime=10;useinbandfec=1"},
		{Port: 5002, PT: 96, Mime: "video/VP8", ClockRate: 90000},
	})
	for _, want := range []string{"m=audio 5000 RTP/AVP 111", "a=rtpmap:111 opus/48000/2", "a=fmtp:111 minptime=10", "m=video 5002 RTP/AVP 96", "a=rtpmap:96 VP8/90000"} {
		if !strings.Contains(s, want) {
			t.Errorf("sdp missing %q:\n%s", want, s)
		}
	}
}
