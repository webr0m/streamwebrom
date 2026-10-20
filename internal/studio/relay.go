package studio

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/pion/webrtc/v4"
	"github.com/webr0m/streamwebrom/internal/sfu"
	"golang.org/x/crypto/bcrypt"
)

// RelayAccess contains UI capabilities, never credentials or the master hash.
type RelayAccess struct {
	Available bool `json:"available"`
	Password  bool `json:"password"`
}

func (r *Room) CloudflareEnabled() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return (r.state.Connection == "cloudflare" && len(r.guestHash) > 0) || r.probeCloud
}

func (h *Hub) relayAccess(r *Room) *RelayAccess {
	return &RelayAccess{Available: h.o.CloudflareMasterHash != "" && h.o.CloudflareICEProvider != nil, Password: len(r.guestHash) > 0}
}

// RoomICE is called only after room authentication. Public config uses the
// local provider; Cloudflare credentials must never be offered anonymously.
func (h *Hub) RoomICE(r *Room, route string) ([]webrtc.ICEServer, string) {
	if route != "local" && r.CloudflareEnabled() && h.o.CloudflareMasterHash != "" && h.o.CloudflareICEProvider != nil {
		if ice := h.o.CloudflareICEProvider(); len(ice) > 0 {
			return ice, "cloudflare"
		}
	}
	if h.o.LocalICEProvider != nil {
		return h.o.LocalICEProvider(), "local"
	}
	if h.o.ICEProvider != nil {
		return h.o.ICEProvider(), "local"
	}
	return h.o.ICE, "local"
}

func (h *Hub) mediaContext(ctx context.Context, r *Room, route string) context.Context {
	_, provider := h.RoomICE(r, route)
	if provider == "local" && h.o.LocalICEProvider != nil {
		return sfu.WithLocalRelay(ctx)
	}
	return ctx
}

func (h *Hub) setRelay(host *Peer, m Msg) error {
	var req struct {
		Provider string `json:"provider"`
		Password string `json:"password"`
	}
	if len(m.Value) > 1024 || json.Unmarshal(m.Value, &req) != nil {
		return errors.New("Solicitud de conexión inválida")
	}
	r := host.room
	switch req.Provider {
	case "cloudflare":
		access := h.relayAccess(r)
		if !access.Password {
			return errors.New("Cloudflare requiere una sala con contraseña")
		}
		if !access.Available {
			return errors.New("El administrador no ha habilitado el acceso protegido a Cloudflare")
		}
		if !h.relayRate.Allow() {
			return errors.New("Demasiados intentos; espera antes de volver a validar la contraseña maestra")
		}
		if len(req.Password) > 72 || bcrypt.CompareHashAndPassword([]byte(h.o.CloudflareMasterHash), []byte(req.Password)) != nil {
			return errors.New("Contraseña maestra incorrecta")
		}
	case "local":
	default:
		return errors.New("Relé desconocido")
	}
	r.mu.Lock()
	changed := r.state.Connection != req.Provider
	r.state.Connection = req.Provider
	r.mu.Unlock()
	if r.onSave != nil {
		r.onSave()
	}
	st := r.Snapshot()
	r.broadcast(Msg{Type: "state", State: &st}, "")
	host.Send(Msg{Type: "relay-updated", ReqID: m.ReqID, RelayAccess: h.relayAccess(r)})
	if changed {
		// Let the acknowledgement reach the browser before rejoining the same
		// room with its stable source identifiers and selected provider.
		time.AfterFunc(300*time.Millisecond, func() { h.refreshRoomRoutes(r) })
	}
	return nil
}

func (h *Hub) refreshRoomRoutes(r *Room) {
	r.mu.RLock()
	peers := make([]*Peer, 0, len(r.peers)+len(r.waiting))
	for _, p := range r.peers {
		peers = append(peers, p)
	}
	for _, p := range r.waiting {
		peers = append(peers, p)
	}
	r.mu.RUnlock()
	for _, p := range peers {
		p.mu.Lock()
		p.routeRefresh = true
		p.mu.Unlock()
		p.close()
	}
	if h.o.RoomRoutesChanged != nil {
		h.o.RoomRoutesChanged(r.ID)
	}
}

// RefreshCloudflareRoutes leaves unrelated local rooms online on quota changes.
func (h *Hub) RefreshCloudflareRoutes() {
	h.mu.RLock()
	var rooms []*Room
	for _, r := range h.rooms {
		if r.CloudflareEnabled() {
			rooms = append(rooms, r)
		}
	}
	h.mu.RUnlock()
	for _, r := range rooms {
		h.refreshRoomRoutes(r)
	}
}
