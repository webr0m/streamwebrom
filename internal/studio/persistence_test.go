package studio

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func persistentFixture(t *testing.T) (*Hub, *Room, *Peer, Keys) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	h := NewHub(ctx, Options{StoreDir: t.TempDir(), MaxRooms: 8, MaxPeers: 8, RoomTTL: time.Second})
	k, err := h.CreateRoom("saved-room", "room-password", "Estudio", true)
	if err != nil {
		t.Fatal(err)
	}
	r := h.Room(k.Room)
	host := newPeer(nil, nil)
	host.Role = RoleHost
	host.room = r
	return h, r, host, k
}

func TestPersistenceOptInRestoresKeysStateAndParticipantIdentity(t *testing.T) {
	h, r, host, k := persistentFixture(t)
	h.CreateRoom("ephemeral", "pw", "No guardar", false)
	g := newPeer(nil, nil)
	g.Name = "Ana"
	g.Role = RoleGuest
	g.room = r
	pass := r.issuePass(g)
	camera := passStreamID(pass, "camera")
	r.Update(func(st *State) error {
		st.Layout = "split"
		st.Stage = []string{camera}
		st.Labels[camera] = "Panelista"
		st.Live = true
		st.Recording = []string{camera}
		return nil
	})
	if files, _ := filepath.Glob(filepath.Join(h.o.StoreDir, "*.json")); len(files) != 0 {
		t.Fatal("room persisted without host save")
	}
	if err := h.handle(context.Background(), g, Msg{Type: "save-room", Value: json.RawMessage(`{"days":30}`)}); err == nil {
		t.Fatal("guest saved a room")
	}
	if err := h.saveRoom(host, Msg{Value: json.RawMessage(`{"days":30,"options":{"controls":{"obsQuality":"720"},"dests":[]}}`)}); err != nil {
		t.Fatal(err)
	}
	expires := r.expires
	if err := h.saveRoom(host, Msg{Action: "options", Value: json.RawMessage(`{"days":365,"options":{"controls":{"obsQuality":"360"}}}`)}); err != nil {
		t.Fatal(err)
	}
	if r.expires != expires || r.persistDays != 30 {
		t.Fatal("autosave silently extended expiration")
	}
	r.Update(func(st *State) error { st.Title = "Guardado automáticamente"; return nil })
	if n := h.ReapNow(time.Now().Add(24 * time.Hour)); n != 1 {
		t.Fatalf("saved room reaped or ephemeral retained: %d", n)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	h2 := NewHub(ctx, h.o)
	restored := h2.Room(k.Room)
	if restored == nil || h2.Room("ephemeral") != nil {
		t.Fatal("wrong restored rooms")
	}
	if !restored.CheckHost(k.HostKey) || !restored.CheckGuest("room-password") || !restored.CheckView(k.ViewKey) || !restored.CheckInvite(k.InviteKey) || !restored.CheckPush(k.PushKey) {
		t.Fatal("room keys changed")
	}
	if !restored.passes[pass] || restored.participants[pass] != "Ana" || passStreamID(pass, "camera") != camera {
		t.Fatal("participant/OBS identity changed")
	}
	st := restored.Snapshot()
	if st.Title != "Guardado automáticamente" || st.Stage[0] != camera || st.Labels[camera] != "Panelista" || st.Live || len(st.Recording) > 0 {
		t.Fatal("configuration lost or broadcast restarted")
	}
	public, _ := json.Marshal(st)
	var fields map[string]any
	json.Unmarshal(public, &fields)
	if fields["options"] != nil || fields["participants"] != nil {
		t.Fatal("host private options exposed")
	}
}

func TestPersistenceDurationsExpirationAndForget(t *testing.T) {
	h, r, host, k := persistentFixture(t)
	for _, days := range []int{30, 60, 90, 365, 0} {
		b, _ := json.Marshal(map[string]int{"days": days})
		before := time.Now()
		if err := h.saveRoom(host, Msg{Value: b}); err != nil {
			t.Fatal(err)
		}
		if days == 0 {
			if r.expires != 0 {
				t.Fatal("unlimited expired")
			}
		} else if delta := time.UnixMilli(r.expires).Sub(before); delta < time.Duration(days)*24*time.Hour-time.Millisecond || delta > time.Duration(days)*24*time.Hour+time.Second {
			t.Fatal("incorrect expiration")
		}
	}
	if h.saveRoom(host, Msg{Value: json.RawMessage(`{"days":31}`)}) == nil {
		t.Fatal("invalid duration accepted")
	}
	if err := h.forgetRoom(host, Msg{}); err != nil {
		t.Fatal(err)
	}
	if r.persistent {
		t.Fatal("still persistent")
	}
	if _, err := os.Stat(filepath.Join(h.o.StoreDir, k.Room+".json")); !os.IsNotExist(err) {
		t.Fatal("saved file retained")
	}
	h.saveRoom(host, Msg{Value: json.RawMessage(`{"days":30}`)})
	r.mu.Lock()
	r.expires = time.Now().Add(-time.Second).UnixMilli()
	r.mu.Unlock()
	if h.Room(k.Room) != nil {
		t.Fatal("expired room accepts joins")
	}
	if h.ReapNow(time.Now()) != 1 {
		t.Fatal("expiration not reaped")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if NewHub(ctx, h.o).Room(k.Room) != nil {
		t.Fatal("expired room restored")
	}
	_, err := h.CreateRoom("no-password", "", "", false)
	if err != nil {
		t.Fatal(err)
	}
	host.room = h.Room("no-password")
	if h.saveRoom(host, Msg{Value: json.RawMessage(`{"days":30}`)}) == nil {
		t.Fatal("passwordless room persisted")
	}
}
