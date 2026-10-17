package studio

import (
	"context"
	"io"
	"log/slog"
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
