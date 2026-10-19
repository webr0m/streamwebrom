package studio

import (
	"context"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
	"github.com/webr0m/streamwebrom/internal/sfu"
)

func screenFixture(t *testing.T) (*Hub, *Room, *Peer, *Peer) {
	t.Helper()
	r, _, err := newRoom("screen-test", "", false, "")
	if err != nil {
		t.Fatal(err)
	}
	guest, host := newPeer(nil, nil), newPeer(nil, nil)
	guest.ID, guest.Role, guest.room = "guest", RoleGuest, r
	host.ID, host.Role, host.room = "host", RoleHost, r
	r.peers[guest.ID], r.peers[host.ID] = guest, host
	r.streams["camera"] = &sfu.Stream{ID: "camera", Owner: guest.ID, Kind: "camera"}
	return &Hub{}, r, guest, host
}

func TestScreenPermissionRequiresHostAndLiveStage(t *testing.T) {
	h, r, g, host := screenFixture(t)
	ctx := context.Background()
	if h.handle(ctx, g, Msg{Type: "screen-request"}) == nil {
		t.Fatal("backstage request allowed")
	}
	if h.handle(ctx, host, Msg{Type: "screen-permission", Target: g.ID, Action: "allow"}) == nil {
		t.Fatal("backstage grant allowed")
	}
	r.state.Stage = []string{"camera"}
	if err := h.handle(ctx, g, Msg{Type: "screen-request"}); err != nil {
		t.Fatal(err)
	}
	if !g.Info(r.state.Stage).ScreenRequested {
		t.Fatal("request missing from host snapshot")
	}
	if h.handle(ctx, g, Msg{Type: "screen-permission", Target: g.ID, Action: "allow"}) == nil {
		t.Fatal("guest authorized itself")
	}
	if h.publish(ctx, g, Msg{Kind: "screen", SDP: &webrtc.SessionDescription{}}) == nil {
		t.Fatal("screen published before approval")
	}
	if err := h.handle(ctx, host, Msg{Type: "screen-permission", Target: g.ID, Action: "deny"}); err != nil {
		t.Fatal(err)
	}
	if g.Info(nil).ScreenRequested || g.Info(nil).ScreenAllowed {
		t.Fatal("denial left permission")
	}
	if err := h.handle(ctx, g, Msg{Type: "screen-request"}); err != nil {
		t.Fatal(err)
	}
	if err := h.handle(ctx, host, Msg{Type: "screen-permission", Target: g.ID, Action: "allow"}); err != nil {
		t.Fatal(err)
	}
	if !g.Info(nil).ScreenAllowed || g.Info(nil).ScreenRequested {
		t.Fatal("bad grant state")
	}
	if err := h.handle(ctx, g, Msg{Type: "screen-cancel"}); err != nil {
		t.Fatal(err)
	}
	if g.Info(nil).ScreenAllowed {
		t.Fatal("cancellation kept grant")
	}
}

func TestScreenPermissionRevokedOutsideAllScenes(t *testing.T) {
	h, r, g, _ := screenFixture(t)
	r.state.Outputs = map[string]Output{"2": {Stage: []string{"camera"}}}
	if err := h.allowScreen(g); err != nil {
		t.Fatal("extra live scene must qualify", err)
	}
	epoch := g.screenEpoch
	if err := r.Update(func(st *State) error { st.Title = "still on stage"; return nil }); err != nil {
		t.Fatal(err)
	}
	if !g.Info(nil).ScreenAllowed {
		t.Fatal("unrelated patch revoked screen")
	}
	if err := r.Update(func(st *State) error { st.Outputs = map[string]Output{}; return nil }); err != nil {
		t.Fatal(err)
	}
	r.mu.RLock()
	allowed := r.screenPermitLocked(g, epoch)
	r.mu.RUnlock()
	if allowed || g.Info(nil).ScreenAllowed {
		t.Fatal("offstage permission survived")
	}
}

func TestScreenRevocationStopsMediaAndRejectsOldNegotiation(t *testing.T) {
	h, r, g, _ := screenFixture(t)
	r.state.Stage = []string{"camera"}
	engine, err := sfu.NewEngine(sfu.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	client, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	client.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo)
	offer, err := client.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	makeStream := func(id string) *sfu.Stream {
		s, _, err := engine.Publish(context.Background(), id, g.ID, "screen", offer, func(webrtc.ICECandidateInit) {})
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	if err := h.allowScreen(g); err != nil {
		t.Fatal(err)
	}
	s := makeStream("screen-live")
	g.pubs[s.ID] = s
	r.AddStream(s)
	h.revokeScreen(g, "revoked")
	if r.Stream(s.ID) != nil || g.pubs[s.ID] != nil {
		t.Fatal("revoked source is still registered")
	}
	select {
	case <-s.Done():
	case <-time.After(time.Second):
		t.Fatal("revocation did not stop media")
	}
	if err := h.allowScreen(g); err != nil {
		t.Fatal(err)
	}
	epoch := g.screenEpoch
	h.revokeScreen(g, "revoked")
	if err := h.allowScreen(g); err != nil {
		t.Fatal(err)
	}
	late := makeStream("screen-late")
	if r.addStream(late, func() bool { return r.screenPermitLocked(g, epoch) }) {
		t.Fatal("old negotiation survived revoke and regrant")
	}
	if r.Stream(late.ID) != nil {
		t.Fatal("rejected negotiation became visible")
	}
}
