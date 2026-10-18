package studio

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestRoomKeysAndReaper(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	h := NewHub(ctx, Options{MaxRooms: 2, MaxPeers: 4, RoomTTL: time.Second, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	k, err := h.CreateRoom("", "pw", "Show", false)
	if err != nil {
		t.Fatal(err)
	}
	r := h.Room(k.Room)
	if !r.CheckHost(k.HostKey) || r.CheckHost("x") || r.CheckHost("") {
		t.Fatal("host key check")
	}
	if !r.CheckGuest("pw") || r.CheckGuest("") {
		t.Fatal("guest password check")
	}
	if !r.CheckView(k.ViewKey) || r.CheckView(k.PushKey) || !r.CheckPush(k.PushKey) {
		t.Fatal("view/push key separation")
	}
	if _, err := h.CreateRoom("b-room", "", "", false); err != nil {
		t.Fatal(err)
	}
	if _, err := h.CreateRoom("c-room", "", "", false); err == nil {
		t.Fatal("room cap not enforced")
	}
	if n := h.ReapNow(time.Now().Add(2 * time.Second)); n != 2 {
		t.Fatalf("reaped %d rooms, want 2", n)
	}
}

func TestBrandValidation(t *testing.T) {
	good := Brand{Color: "#fff", Background: "https://x/y.png", Logo: "data:image/png;base64,AA", Theme: "bold"}
	if err := validBrand(good); err != nil {
		t.Fatal(err)
	}
	for _, b := range []Brand{{Color: "red"}, {Logo: "javascript:alert(1)"}, {Background: "url(x)"}, {Theme: "evil"}} {
		if validBrand(b) == nil {
			t.Errorf("%+v should be rejected", b)
		}
	}
}

func TestCleanName(t *testing.T) {
	if got := cleanName("  <img src=x>Ana\x00 "); got != "img src=xAna" {
		t.Fatalf("got %q", got)
	}
	if cleanName("") != "Invitado" {
		t.Fatal("default name")
	}
}

func TestUpdateIsAllOrNothing(t *testing.T) {
	r, _, err := newRoom("atomic", "", false, "T")
	if err != nil {
		t.Fatal(err)
	}
	err = r.Update(func(st *State) error {
		st.Title = "changed"
		st.Labels["x"] = "y"
		return errFull
	})
	if err == nil {
		t.Fatal("want error")
	}
	if st := r.Snapshot(); st.Title != "T" || st.Labels["x"] != "" {
		t.Fatalf("failed update leaked into state: %+v", st)
	}
}

func TestPassStreamIDIsStableAndOpaque(t *testing.T) {
	a, b := passStreamID("secret-pass", "camera"), passStreamID("secret-pass", "camera")
	if a != b || !streamIDRe.MatchString(a) || strings.Contains(a, "secret") {
		t.Fatalf("bad stream id %q / %q", a, b)
	}
	if passStreamID("other", "camera") == a || passStreamID("secret-pass", "screen") == a {
		t.Fatal("stream ids collide")
	}
	if !validSticker("hola") || validSticker("<script>") {
		t.Fatal("sticker validation")
	}
}
