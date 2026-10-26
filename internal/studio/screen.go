package studio

import (
	"errors"

	"github.com/webr0m/streamwebrom/internal/sfu"
)

// All stage/permission decisions take room.mu before peer.mu. Permissions are
// scoped to a live guest connection and are never restored by a rejoin pass.
func (r *Room) onStageLocked(p *Peer) bool {
	on := func(ids []string) bool {
		for _, id := range ids {
			if s := r.streams[id]; s != nil && s.Owner == p.ID {
				return true
			}
		}
		return false
	}
	if on(r.state.Stage) {
		return true
	}
	for _, output := range r.state.Outputs {
		if on(output.Stage) {
			return true
		}
	}
	return false
}

func (h *Hub) requestScreen(p *Peer, m Msg) error {
	r := p.room
	r.mu.Lock()
	if p.role() != RoleGuest || r.peers[p.ID] != p || !r.onStageLocked(p) {
		r.mu.Unlock()
		return errors.New("Debes estar en el escenario para solicitar compartir pantalla")
	}
	p.mu.Lock()
	action := "pending"
	if p.screenAllowed {
		action = "allowed"
	} else {
		p.screenRequested = true
	}
	p.mu.Unlock()
	r.mu.Unlock()
	p.Send(Msg{Type: "screen-permission", Action: action, ReqID: m.ReqID})
	h.peerUpdated(p)
	return nil
}

func (h *Hub) allowScreen(p *Peer) error {
	r := p.room
	r.mu.Lock()
	if p.role() != RoleGuest || r.peers[p.ID] != p || !r.onStageLocked(p) {
		r.mu.Unlock()
		return errors.New("El invitado debe estar en el escenario para autorizar su pantalla")
	}
	p.mu.Lock()
	if !p.screenAllowed {
		p.screenEpoch++
	}
	p.screenAllowed, p.screenRequested = true, false
	p.mu.Unlock()
	r.mu.Unlock()
	p.Send(Msg{Type: "screen-permission", Action: "allowed"})
	h.peerUpdated(p)
	return nil
}

// clearScreenLocked invalidates pending negotiations and removes live screens
// before slow network teardown. It is also used when a guest leaves the stage.
func (r *Room) clearScreenLocked(p *Peer) []*sfu.Stream {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.screenAllowed, p.screenRequested = false, false
	p.screenEpoch++
	var removed []*sfu.Stream
	for id, s := range p.pubs {
		if s.Kind == "screen" {
			delete(p.pubs, id)
			if r.streams[id] == s {
				delete(r.streams, id)
				removed = append(removed, s)
			}
		}
	}
	return removed
}

func (r *Room) finishScreenRemoval(p *Peer, removed []*sfu.Stream, action string) {
	for _, s := range removed {
		r.broadcast(Msg{Type: "stream-removed", Stream: s.ID, Revision: s.Revision}, "")
		go s.Close()
	}
	p.Send(Msg{Type: "screen-permission", Action: action})
	st := r.Snapshot()
	info := p.Info(st.Stage)
	r.broadcast(Msg{Type: "peer-updated", Peer: &info}, "")
}

func (h *Hub) revokeScreen(p *Peer, action string) {
	r := p.room
	r.mu.Lock()
	removed := r.clearScreenLocked(p)
	r.mu.Unlock()
	r.finishScreenRemoval(p, removed, action)
	if len(removed) > 0 {
		pubs := make(map[string]*sfu.Stream, len(removed))
		for _, s := range removed {
			pubs[s.ID] = s
		}
		h.dropStreams(r, pubs, true)
	}
}

// screenPermitLocked must run with room.mu held. The epoch check prevents a
// revoked negotiation from becoming visible even if a new grant was issued.
func (r *Room) screenPermitLocked(p *Peer, epoch uint64) bool {
	if r.peers[p.ID] != p || !r.onStageLocked(p) {
		return false
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.screenAllowed && p.screenEpoch == epoch
}
