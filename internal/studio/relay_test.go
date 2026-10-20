package studio

import (
	"context"
	"encoding/json"
	"github.com/pion/webrtc/v4"
	"github.com/webr0m/streamwebrom/internal/turnrelay"
	"golang.org/x/crypto/bcrypt"
	"testing"
	"time"
)

func relayFixture(t *testing.T) (*Hub, *Room, *Peer, Keys) {
	t.Helper()
	hash, _ := bcrypt.GenerateFromPassword([]byte("test-master-only"), bcrypt.MinCost)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	h := NewHub(ctx, Options{MaxRooms: 20, MaxPeers: 8, RoomTTL: time.Hour, CloudflareMasterHash: string(hash),
		LocalICEProvider: func() []webrtc.ICEServer { return []webrtc.ICEServer{{URLs: []string{"turn:local.test:3478"}}} },
		CloudflareICEProvider: func() []webrtc.ICEServer {
			return []webrtc.ICEServer{{URLs: []string{"turn:cloud.test:3478"}, Username: "private-cf-user", Credential: "private-cf-credential"}}
		},
		RelayStatus: func() *turnrelay.RelayStatus { return &turnrelay.RelayStatus{Provider: "cloudflare", UsageBytes: 42} },
	})
	k, err := h.CreateRoom("protected-test", "room-password", "", false)
	if err != nil {
		t.Fatal(err)
	}
	r := h.Room(k.Room)
	host := newPeer(nil, nil)
	host.Role = RoleHost
	host.room = r
	return h, r, host, k
}

func TestCloudflareRequiresHostRoomPasswordAndMaster(t *testing.T) {
	h, r, host, _ := relayFixture(t)
	ctx := context.Background()
	guest := newPeer(nil, nil)
	guest.Role = RoleGuest
	guest.room = r
	request := Msg{Type: "relay", Value: json.RawMessage(`{"provider":"cloudflare","password":"test-master-only"}`)}
	if r.Snapshot().Connection != "local" {
		t.Fatal("new room did not default to local")
	}
	if err := h.handle(ctx, guest, request); err == nil {
		t.Fatal("guest enabled Cloudflare")
	}
	if err := h.setState(r, Msg{Value: json.RawMessage(`{"connection":"cloudflare"}`)}); err == nil {
		t.Fatal("generic state bypassed master validation")
	}
	if err := h.handle(ctx, host, Msg{Type: "relay", Value: json.RawMessage(`{"provider":"cloudflare","password":"incorrect"}`)}); err == nil {
		t.Fatal("wrong master accepted")
	}
	if r.CloudflareEnabled() {
		t.Fatal("failed attempt changed routing")
	}
	k, err := h.CreateRoom("public-test", "", "", false)
	if err != nil {
		t.Fatal(err)
	}
	host.room = h.Room(k.Room)
	if err := h.handle(ctx, host, request); err == nil {
		t.Fatal("passwordless room allowed Cloudflare")
	}
	host.room = r
	if err := h.handle(ctx, host, request); err != nil {
		t.Fatal(err)
	}
	if !r.CloudflareEnabled() {
		t.Fatal("valid host authorization was ignored")
	}
	ice, provider := h.RoomICE(r, "")
	if provider != "cloudflare" || ice[0].Username != "private-cf-user" {
		t.Fatal("authorized room missing CF route")
	}
	ice, provider = h.RoomICE(r, "local")
	if provider != "local" || ice[0].Username != "" {
		t.Fatal("explicit local override leaked CF")
	}
	if err := h.handle(ctx, host, Msg{Type: "relay", Value: json.RawMessage(`{"provider":"local"}`)}); err != nil {
		t.Fatal(err)
	}
	if r.CloudflareEnabled() {
		t.Fatal("host could not return to local")
	}
}

func TestCloudflareScopedProbeAndHostOnlyUsage(t *testing.T) {
	h, r, host, _ := relayFixture(t)
	ice, provider := h.RoomICE(r, "")
	if provider != "local" || ice[0].Username != "" {
		t.Fatal("default room leaked CF credentials")
	}
	if _, err := h.CreateRoomRouteProbe(r.ID, "wrong"); err == nil {
		t.Fatal("unauthenticated probe allowed")
	}
	r.mu.Lock()
	r.state.Connection = "cloudflare"
	r.peers[host.ID] = host
	r.mu.Unlock()
	guest := newPeer(nil, nil)
	guest.Role = RoleGuest
	guest.room = r
	r.mu.Lock()
	r.peers[guest.ID] = guest
	r.mu.Unlock()
	h.NotifyRelay(turnrelay.RelayStatus{Provider: "cloudflare", UsageBytes: 123})
	if len(host.out) != 1 || len(guest.out) != 0 {
		t.Fatal("account usage leaked to guests")
	}
	// Do not close these synthetic socket-less peers in delayed route tests.
	r.mu.Lock()
	delete(r.peers, host.ID)
	delete(r.peers, guest.ID)
	r.mu.Unlock()
	k, err := h.CreateRoomRouteProbe(r.ID, "room-password")
	if err != nil {
		t.Fatal(err)
	}
	defer h.ReleaseRouteProbe(k.Room, k.HostKey)
	_, provider = h.RoomICE(h.Room(k.Room), "")
	if provider != "cloudflare" {
		t.Fatal("authenticated automatic preflight lost selected provider")
	}
	plain, err := h.CreateRouteProbe()
	if err != nil {
		t.Fatal(err)
	}
	defer h.ReleaseRouteProbe(plain.Room, plain.HostKey)
	_, provider = h.RoomICE(h.Room(plain.Room), "")
	if provider != "local" {
		t.Fatal("anonymous probe obtained Cloudflare")
	}
}

func TestQuotaRouteRefreshDoesNotInterruptLocalRooms(t *testing.T) {
	h, r, _, _ := relayFixture(t)
	k, err := h.CreateRoom("unaffected-local", "", "", false)
	if err != nil {
		t.Fatal(err)
	}
	var refreshed []string
	h.o.RoomRoutesChanged = func(id string) { refreshed = append(refreshed, id) }
	h.RefreshCloudflareRoutes()
	if len(refreshed) != 0 {
		t.Fatal("local rooms refreshed on provider change")
	}
	r.mu.Lock()
	r.state.Connection = "cloudflare"
	r.mu.Unlock()
	h.RefreshCloudflareRoutes()
	if len(refreshed) != 1 || refreshed[0] != r.ID {
		t.Fatal("unrelated room interrupted", k.Room, refreshed)
	}
}
