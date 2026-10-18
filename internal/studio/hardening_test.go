package studio

import (
	"context"
	"encoding/json"
	"github.com/pion/webrtc/v4"
	"github.com/webr0m/streamwebrom/internal/sfu"
	"strings"
	"testing"
	"time"
)

func TestDropStreamsDoesNotDeadlockAndKeepsRejoinedSources(t *testing.T) {
	r, _, _ := newRoom("drop-test", "", false, "")
	r.state.Stage = []string{"gone", "back"}
	r.state.Featured = "gone"
	r.state.Outputs = map[string]Output{"2": {Stage: []string{"gone", "back"}, Featured: "gone"}}
	r.streams["back"] = &sfu.Stream{ID: "back"}
	h := &Hub{}
	done := make(chan struct{})
	go func() { h.dropStreams(r, map[string]*sfu.Stream{"gone": {}, "back": {}}, true); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cleanup deadlocked")
	}
	st := r.Snapshot()
	if len(st.Stage) != 1 || st.Stage[0] != "back" || st.Featured != "" || len(st.Outputs["2"].Stage) != 1 {
		t.Fatalf("bad cleanup: %+v", st)
	}
}

func TestStateCopyIsDeep(t *testing.T) {
	r, _, _ := newRoom("copy-test", "", false, "")
	r.state.Stage = []string{"original"}
	r.state.Outputs = map[string]Output{"2": {Stage: []string{"original"}}}
	r.state.Scenes = map[string]Scene{"saved": {Stage: []string{"original"}, Banner: &Banner{Text: "original"}}}
	r.state.Muted = map[string]bool{"x": true}
	st := r.Snapshot()
	st.Stage[0] = "changed"
	st.Outputs["2"].Stage[0] = "changed"
	st.Scenes["saved"].Stage[0] = "changed"
	st.Scenes["saved"].Banner.Text = "changed"
	st.Muted["x"] = false
	actual := r.Snapshot()
	if actual.Stage[0] != "original" || actual.Outputs["2"].Stage[0] != "original" || actual.Scenes["saved"].Banner.Text != "original" || !actual.Muted["x"] {
		t.Fatal("snapshot aliases live state")
	}
}

func TestPasswordByteLimitAndColors(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	h := NewHub(ctx, Options{MaxRooms: 2})
	if _, err := h.CreateRoom("long-password", strings.Repeat("á", 37), "", false); err == nil {
		t.Fatal("bcrypt byte limit ignored")
	}
	for _, color := range []string{"#12345", "#1234567"} {
		if validBrand(Brand{Color: color}) == nil {
			t.Fatalf("invalid color accepted: %s", color)
		}
	}
}

func BenchmarkStateCopy(b *testing.B) {
	r, _, _ := newRoom("benchmark", "", false, "")
	for i := 0; i < 25; i++ {
		r.state.Stage = append(r.state.Stage, "camera")
		r.state.Banners = append(r.state.Banners, Banner{Text: strings.Repeat("x", 200)})
	}
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _ = cloneState(r.state)
	}
}

func BenchmarkStateCopyJSON(b *testing.B) {
	r, _, _ := newRoom("benchmark", "", false, "")
	for i := 0; i < 25; i++ {
		r.state.Stage = append(r.state.Stage, "camera")
		r.state.Banners = append(r.state.Banners, Banner{Text: strings.Repeat("x", 200)})
	}
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		encoded, _ := json.Marshal(r.state)
		var out State
		_ = json.Unmarshal(encoded, &out)
	}
}

func TestConcurrentPublicationReservation(t *testing.T) {
	r, _, _ := newRoom("reservation", "", false, "")
	release, err := r.reserveStream("camera", "alice", false, 8)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.reserveStream("camera", "bob", false, 8); err == nil {
		t.Fatal("concurrent ID takeover allowed")
	}
	release()
	r.streams["camera"] = &sfu.Stream{ID: "camera", Owner: "alice"}
	if _, err := r.reserveStream("camera", "bob", false, 8); err == nil {
		t.Fatal("stream owner bypassed")
	}
	if _, err := r.reserveStream("other", "bob", false, 1); err == nil {
		t.Fatal("capacity bypassed")
	}
	delete(r.streams, "camera")
	r.close()
	if _, err := r.reserveStream("new", "alice", false, 8); err == nil {
		t.Fatal("closed room accepted publisher")
	}
}

func TestStateRejectsMalformedScenesAtomically(t *testing.T) {
	r, _, _ := newRoom("scene-test", "", false, "Before")
	h := &Hub{}
	for _, value := range []string{
		`{"title":"Changed","stage":["cam","cam"]}`,
		`{"scenes":{"saved":{"layout":"bogus","stage":[]}}}`,
		`{"outputs":{"2":{"stage":["bad/id"]}}}`,
		`{"labels":{"bad/id":"Name"}}`,
	} {
		if h.setState(r, Msg{Value: json.RawMessage(value)}) == nil {
			t.Fatalf("accepted malformed scene %s", value)
		}
		if r.Snapshot().Title != "Before" {
			t.Fatal("failed patch modified state")
		}
	}
}

func TestReplacingStreamDoesNotRemoveTheReplacement(t *testing.T) {
	engine, err := sfu.NewEngine(sfu.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	r, _, _ := newRoom("replace-test", "", false, "")
	viewer := &Peer{ID: "viewer", out: make(chan []byte, 10), gone: make(chan struct{})}
	r.peers[viewer.ID] = viewer
	publish := func() *sfu.Stream {
		pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = pc.Close() })
		_, err = pc.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo)
		if err != nil {
			t.Fatal(err)
		}
		offer, err := pc.CreateOffer(nil)
		if err != nil {
			t.Fatal(err)
		}
		stream, _, err := engine.Publish(context.Background(), "camera", "owner", "camera", offer)
		if err != nil {
			t.Fatal(err)
		}
		return stream
	}
	first := publish()
	r.AddStream(first)
	second := publish()
	r.AddStream(second)
	if r.Stream("camera") != second {
		t.Fatal("replacement missing")
	}
	select {
	case data := <-viewer.out:
		t.Fatalf("replacement emitted stale event: %s", data)
	default:
	}
	second.Close()
	select {
	case data := <-viewer.out:
		var msg Msg
		if err := json.Unmarshal(data, &msg); err != nil {
			t.Fatal(err)
		}
		if msg.Type != "stream-removed" {
			t.Fatalf("unexpected event: %s", data)
		}
	case <-time.After(time.Second):
		t.Fatal("current stream closure not announced")
	}
}
