package studio

import (
	"errors"
	"time"
)

// Route probes have separate admission, a global bound and a hard lifetime.
// Their host key can delete only that temporary room, never a real show.
func (h *Hub) CreateRouteProbe() (Keys, error) { return h.CreateRoomRouteProbe("", "") }

// CreateRoomRouteProbe copies the route only after validating the room password.
// The ordinary diagnostic endpoint remains local and cannot obtain CF access.
func (h *Hub) CreateRoomRouteProbe(room, password string) (Keys, error) {
	cloud := false
	if room != "" {
		r := h.Room(room)
		if r == nil || !r.CheckGuest(password) {
			return Keys{}, errors.New("Sala o contraseña inválida")
		}
		cloud = r.CloudflareEnabled()
	}
	h.mu.RLock()
	full := len(h.probes) >= 32
	h.mu.RUnlock()
	if full {
		return Keys{}, errors.New("network checks are busy; retry shortly")
	}
	keys, err := h.CreateRoom("check-"+NewRoomID(), "", "Prueba de conexión", false)
	if err != nil {
		return Keys{}, err
	}
	h.mu.Lock()
	r := h.rooms[keys.Room]
	if r == nil {
		h.mu.Unlock()
		return Keys{}, errors.New("network check expired")
	}
	if len(h.probes) >= 32 {
		delete(h.rooms, keys.Room)
		h.mu.Unlock()
		r.close()
		return Keys{}, errors.New("network checks are busy; retry shortly")
	}
	h.probes[keys.Room] = r
	r.mu.Lock()
	r.probeCloud = cloud
	r.mu.Unlock()
	h.mu.Unlock()
	time.AfterFunc(45*time.Second, func() { h.ReleaseRouteProbe(keys.Room, keys.HostKey) })
	return keys, nil
}

func (h *Hub) ReleaseRouteProbe(id, key string) bool {
	h.mu.Lock()
	r := h.probes[id]
	if r == nil || !r.CheckHost(key) {
		h.mu.Unlock()
		return false
	}
	delete(h.probes, id)
	if h.rooms[id] == r {
		delete(h.rooms, id)
	}
	h.mu.Unlock()
	go r.close()
	return true
}
