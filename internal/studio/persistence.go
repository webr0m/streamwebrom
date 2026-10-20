package studio

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"

	"github.com/webr0m/streamwebrom/internal/sfu"
)

// PersistenceInfo is sent only to authenticated hosts. Participant passes and
// output keys must never be included in public room state.
type PersistenceInfo struct {
	Enabled      bool                `json:"enabled"`
	Days         int                 `json:"days"`
	Expires      int64               `json:"expires"`
	Password     bool                `json:"password"`
	Available    bool                `json:"available"`
	Options      json.RawMessage     `json:"options,omitempty"`
	Participants map[string]string   `json:"participants,omitempty"`
	Sources      map[string]sfu.Info `json:"sources,omitempty"`
}

type savedRoom struct {
	Version                     int
	ID                          string
	Created                     time.Time
	HostHash, GuestHash         []byte
	ViewKey, PushKey, InviteKey string
	Expires                     int64
	Days                        int
	State                       State
	Passes                      map[string]bool
	Participants                map[string]string
	Sources                     map[string]sfu.Info
	StreamOwners                map[string]string
	Options                     json.RawMessage
}

func (r *Room) persistenceInfo(available bool, withOptions ...bool) *PersistenceInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var options json.RawMessage
	if len(withOptions) > 0 && withOptions[0] {
		options = r.options
	}
	b, _ := json.Marshal(PersistenceInfo{Enabled: r.persistent, Days: r.persistDays, Expires: r.expires, Password: len(r.guestHash) > 0,
		Available: available, Options: options, Participants: r.participants, Sources: r.savedSources})
	var info PersistenceInfo
	_ = json.Unmarshal(b, &info)
	return &info
}

func (h *Hub) notifyPersistence(r *Room) {
	r.toHosts(Msg{Type: "persistence", Persistence: r.persistenceInfo(h.o.StoreDir != "")})
	r.mu.RLock()
	enabled := r.persistent
	r.mu.RUnlock()
	r.broadcast(Msg{Type: "room-persistent", Persistent: enabled}, "")
}

// Every write snapshots the room under its lock, serializes with other saves,
// and replaces the previous file atomically. Room passwords are stored only as bcrypt hashes.
func (h *Hub) persist(r *Room) error {
	if h.o.StoreDir == "" {
		return nil
	}
	h.persistMu.Lock()
	defer h.persistMu.Unlock()
	r.mu.RLock()
	if !r.persistent {
		r.mu.RUnlock()
		return nil
	}
	st, err := cloneState(r.state)
	if err != nil {
		r.mu.RUnlock()
		return err
	}
	// A restart restores configuration, never a running broadcast or recording.
	st.Live = false
	st.Recording = nil
	st.Restream = nil
	st.Countdown = 0
	s := savedRoom{Version: 1, ID: r.ID, Created: r.Created, HostHash: r.hostHash, GuestHash: r.guestHash,
		ViewKey: r.viewKey, PushKey: r.pushKey, InviteKey: r.inviteKey, Expires: r.expires, Days: r.persistDays,
		State: st, Passes: r.passes, Participants: r.participants, Sources: r.savedSources, StreamOwners: r.streamOwners, Options: r.options}
	b, err := json.Marshal(s)
	r.mu.RUnlock()
	if err != nil {
		return err
	}
	if err = os.MkdirAll(h.o.StoreDir, 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(h.o.StoreDir, ".room-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(b)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(name, filepath.Join(h.o.StoreDir, r.ID+".json"))
}

func (h *Hub) saveRoom(host *Peer, m Msg) error {
	if err := h.configurePersistence(host.room, m); err != nil {
		return err
	}
	host.Send(Msg{Type: "saved", ReqID: m.ReqID, Persistence: host.room.persistenceInfo(true)})
	return nil
}

// SaveRoom authenticates the host before retaining its private production options.
func (h *Hub) SaveRoom(id, key string, value json.RawMessage, auto bool) (*PersistenceInfo, error) {
	r := h.Room(id)
	if r == nil || !r.CheckHost(key) {
		return nil, errors.New("unauthorized")
	}
	action := ""
	if auto {
		action = "options"
	}
	if err := h.configurePersistence(r, Msg{Action: action, Value: value}); err != nil {
		return nil, err
	}
	return r.persistenceInfo(true), nil
}

func (h *Hub) configurePersistence(r *Room, m Msg) error {
	if h.o.StoreDir == "" {
		return errors.New("El servidor no tiene almacenamiento de salas configurado")
	}
	var in struct {
		Days    int             `json:"days"`
		Options json.RawMessage `json:"options"`
	}
	if len(m.Value) > 6<<20 || json.Unmarshal(m.Value, &in) != nil {
		return errors.New("Opciones de sala inválidas")
	}
	if in.Days != 0 && in.Days != 30 && in.Days != 60 && in.Days != 90 && in.Days != 365 {
		return errors.New("Caducidad inválida")
	}
	r.mu.Lock()
	if len(r.guestHash) == 0 {
		r.mu.Unlock()
		return errors.New("Solo se pueden guardar salas con contraseña")
	}
	oldEnabled, oldDays, oldExpires, oldOptions := r.persistent, r.persistDays, r.expires, r.options
	if m.Action == "options" && !r.persistent {
		r.mu.Unlock()
		return errors.New("La sala aún no está guardada")
	}
	r.persistent = true
	r.options = in.Options
	if m.Action != "options" {
		r.persistDays = in.Days
		r.expires = 0
	}
	if m.Action != "options" && in.Days > 0 {
		r.expires = time.Now().Add(time.Duration(in.Days) * 24 * time.Hour).UnixMilli()
	}
	for id, s := range r.streams {
		r.savedSources[id] = s.Info()
	}
	r.mu.Unlock()
	if err := h.persist(r); err != nil {
		r.mu.Lock()
		r.persistent, r.persistDays, r.expires, r.options = oldEnabled, oldDays, oldExpires, oldOptions
		r.mu.Unlock()
		return errors.New("No se pudo guardar la sala en disco")
	}
	h.notifyPersistence(r)
	return nil
}

func (h *Hub) forgetRoom(host *Peer, m Msg) error {
	h.persistMu.Lock()
	defer h.persistMu.Unlock()
	r := host.room
	if h.o.StoreDir != "" {
		if err := os.Remove(filepath.Join(h.o.StoreDir, r.ID+".json")); err != nil && !os.IsNotExist(err) {
			return errors.New("No se pudo quitar la persistencia")
		}
	}
	r.mu.Lock()
	r.persistent = false
	r.expires = 0
	r.persistDays = 0
	r.options = nil
	r.mu.Unlock()
	h.notifyPersistence(r)
	host.Send(Msg{Type: "forgotten", ReqID: m.ReqID})
	return nil
}

func (h *Hub) loadRooms() {
	if h.o.StoreDir == "" {
		return
	}
	paths, err := filepath.Glob(filepath.Join(h.o.StoreDir, "*.json"))
	if err != nil {
		return
	}
	for _, path := range paths {
		b, err := os.ReadFile(path)
		if err != nil {
			h.log.Error("saved room read failed", "file", filepath.Base(path))
			continue
		}
		var s savedRoom
		if len(b) > 16<<20 || json.Unmarshal(b, &s) != nil || s.Version != 1 || !ValidRoomID(s.ID) || filepath.Base(path) != s.ID+".json" || len(s.HostHash) != 32 || len(s.GuestHash) == 0 || s.ViewKey == "" || s.PushKey == "" || s.InviteKey == "" {
			h.log.Error("invalid saved room", "file", filepath.Base(path))
			continue
		}
		if s.Expires > 0 && s.Expires <= time.Now().UnixMilli() {
			_ = os.Remove(path)
			continue
		}
		r, _, err := newRoom(s.ID, "", false, "")
		if err != nil {
			continue
		}
		r.Created = s.Created
		r.hostHash = s.HostHash
		r.guestHash = s.GuestHash
		r.viewKey = s.ViewKey
		r.pushKey = s.PushKey
		r.inviteKey = s.InviteKey
		r.state, _ = cloneState(s.State)
		if r.state.Connection != "cloudflare" {
			r.state.Connection = "local"
		}
		r.state.Live = false
		r.state.Recording = nil
		r.state.Restream = nil
		r.state.Countdown = 0
		r.persistent = true
		r.persistDays = s.Days
		r.expires = s.Expires
		r.options = s.Options
		if s.Passes != nil {
			r.passes = s.Passes
		}
		if s.Participants != nil {
			r.participants = s.Participants
		}
		if s.StreamOwners != nil {
			r.streamOwners = s.StreamOwners
		}
		if s.Sources != nil {
			r.savedSources = s.Sources
		}
		r.onSave = func() {
			if err := h.persist(r); err != nil {
				h.log.Error("room save failed", "room", r.ID)
				r.toHosts(Msg{Type: "error", Error: "No se pudo actualizar la sala guardada en disco"})
			}
		}
		h.rooms[r.ID] = r
	}
}
