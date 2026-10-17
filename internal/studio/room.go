// Package studio implements rooms, roles and the live production state
// (stage, layout, branding, banners, featured comments, recording and
// multistreaming) shared by the host studio, guests and OBS outputs.
package studio

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base32"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/webr0m/streamwebrom/internal/restream"
	"github.com/webr0m/streamwebrom/internal/sfu"
)

// Role of a participant.
type Role string

// Roles. Host = full control, Guest = can publish when allowed, Viewer = OBS
// output / audience (receive only).
const (
	RoleHost   Role = "host"
	RoleGuest  Role = "guest"
	RoleViewer Role = "viewer"
)

// Layouts supported by the compositor (web/js/layout.js mirrors this list).
var Layouts = []string{"solo", "split", "grid", "pip", "sidebar", "spotlight", "screen", "news"}

// Banner is an on-screen message (StreamYard "banners" / news ticker).
type Banner struct {
	ID     string `json:"id"`
	Text   string `json:"text"`
	Ticker bool   `json:"ticker"`
}

// Comment is a chat or audience comment that can be shown on screen.
type Comment struct {
	ID     string `json:"id"`
	From   string `json:"from"`
	Text   string `json:"text"`
	Source string `json:"source"` // chat | youtube | twitch | ...
	TS     int64  `json:"ts"`
}

// Brand controls the look of the program output.
type Brand struct {
	Color      string `json:"color"`      // accent (lower thirds, banners)
	Background string `json:"background"` // css color or image URL
	Logo       string `json:"logo"`       // image URL (data: or https:)
	Overlay    string `json:"overlay"`    // full-frame transparent PNG URL
	Theme      string `json:"theme"`      // bubble | minimal | bold
	ShowNames  bool   `json:"showNames"`
}

// State is everything an output needs to render the program identically.
type State struct {
	Title     string            `json:"title"`
	Layout    string            `json:"layout"`
	Stage     []string          `json:"stage"`    // stream ids on stage, in order
	Featured  string            `json:"featured"` // stream id spotlighted
	Banner    *Banner           `json:"banner"`
	Banners   []Banner          `json:"banners"`
	Comment   *Comment          `json:"comment"`
	Brand     Brand             `json:"brand"`
	Lobby     bool              `json:"lobby"`
	Live      bool              `json:"live"`
	Recording []string          `json:"recording"`
	Restream  *restream.Status  `json:"restream,omitempty"`
	Scenes    map[string]Scene  `json:"scenes"`
	Outputs   map[string]Output `json:"outputs"`   // live scenes 2..8 (and custom), each with its own lineup
	Labels    map[string]string `json:"labels"`    // stream id -> display name / lower third
	Countdown int64             `json:"countdown"` // unix ms target, 0 = none

	// Program audio/video moderation (does not touch the guest's devices).
	Muted      map[string]bool    `json:"muted"`      // stream id -> muted in the program mix
	Volumes    map[string]float64 `json:"volumes"`    // stream id -> gain 0..2
	StageMuted bool               `json:"stageMuted"` // whole stage muted
	Hidden     map[string]bool    `json:"hidden"`     // stream id -> video hidden, audio kept
}

// Scene is a saved layout + stage combination (one-click switching).
type Scene struct {
	Layout string   `json:"layout"`
	Stage  []string `json:"stage"`
	Banner *Banner  `json:"banner"`
}

// Output is a live scene other than the program: its own lineup and layout,
// rendered by /view?scene=NAME (VDO.Ninja "add to scene N").
type Output struct {
	Stage    []string `json:"stage"`
	Layout   string   `json:"layout"`
	Featured string   `json:"featured"`
}

// Room is a production.
type Room struct {
	ID      string
	Created time.Time

	hostHash  []byte
	guestHash []byte
	viewKey   string
	pushKey   string

	mu       sync.RWMutex
	peers    map[string]*Peer
	waiting  map[string]*Peer
	streams  map[string]*sfu.Stream
	state    State
	chat     []Comment
	emptyAt  time.Time
	restream *restream.Session
	starting bool // a go-live is being set up (guards against double start)
}

// Keys returned once to the creator.
type Keys struct {
	Room    string `json:"room"`
	HostKey string `json:"hostKey"`
	ViewKey string `json:"viewKey"`
	PushKey string `json:"pushKey"`
}

// NewRoomID makes an unguessable, URL-friendly id (50 bits).
func NewRoomID() string { return token(10) }

func token(n int) string {
	b := make([]byte, (n*5+7)/8)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	s := strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b))
	return s[:n]
}

func newRoom(id, guestPassword string, lobby bool, title string) (*Room, Keys, error) {
	hostKey := token(24)
	hh, err := bcrypt.GenerateFromPassword([]byte(hostKey), bcrypt.DefaultCost)
	if err != nil {
		return nil, Keys{}, err
	}
	r := &Room{
		ID: id, Created: time.Now(), hostHash: hh,
		viewKey: token(16), pushKey: token(20),
		peers: map[string]*Peer{}, waiting: map[string]*Peer{}, streams: map[string]*sfu.Stream{},
		emptyAt: time.Now(),
		state: State{Title: title, Layout: "grid", Lobby: lobby, Scenes: map[string]Scene{},
			Labels: map[string]string{},
			Brand:  Brand{Color: "#7c5cff", Background: "#0b0b12", Theme: "bubble", ShowNames: true}},
	}
	if guestPassword != "" {
		gh, err := bcrypt.GenerateFromPassword([]byte(guestPassword), bcrypt.DefaultCost)
		if err != nil {
			return nil, Keys{}, err
		}
		r.guestHash = gh
	}
	return r, Keys{Room: id, HostKey: hostKey, ViewKey: r.viewKey, PushKey: r.pushKey}, nil
}

// CheckHost verifies a host key.
func (r *Room) CheckHost(key string) bool {
	return key != "" && bcrypt.CompareHashAndPassword(r.hostHash, []byte(key)) == nil
}

// CheckGuest verifies the guest password (always true when none is set).
func (r *Room) CheckGuest(pw string) bool {
	if r.guestHash == nil {
		return true
	}
	return bcrypt.CompareHashAndPassword(r.guestHash, []byte(pw)) == nil
}

// CheckView verifies a view key (constant time).
func (r *Room) CheckView(k string) bool {
	return subtle.ConstantTimeCompare([]byte(k), []byte(r.viewKey)) == 1
}

// CheckPush verifies a WHIP push key (constant time).
func (r *Room) CheckPush(k string) bool {
	return subtle.ConstantTimeCompare([]byte(k), []byte(r.pushKey)) == 1
}

// Stream returns a published stream.
func (r *Room) Stream(id string) *sfu.Stream {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.streams[id]
}

// Streams lists stream infos.
func (r *Room) Streams() []sfu.Info {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]sfu.Info, 0, len(r.streams))
	for _, s := range r.streams {
		out = append(out, s.Info())
	}
	return out
}

// AddStream registers a stream; an existing stream with the same id is replaced.
func (r *Room) AddStream(s *sfu.Stream) {
	r.mu.Lock()
	old := r.streams[s.ID]
	r.streams[s.ID] = s
	r.mu.Unlock()
	if old != nil && old != s {
		old.Close()
	}
	s.OnClose(func() {
		r.mu.Lock()
		if r.streams[s.ID] == s {
			delete(r.streams, s.ID)
		}
		r.mu.Unlock()
		r.broadcast(Msg{Type: "stream-removed", Stream: s.ID}, "")
	})
	go func() {
		select {
		case <-s.Ready():
			inf := s.Info()
			r.broadcast(Msg{Type: "stream-added", Info: &inf, Name: r.label(s)}, "")
		case <-s.Done():
		}
	}()
}

func (r *Room) label(s *sfu.Stream) string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if l := r.state.Labels[s.ID]; l != "" {
		return l
	}
	if p := r.peers[s.Owner]; p != nil {
		return p.Name
	}
	return s.ID
}

// Snapshot returns a copy of the state.
func (r *Room) Snapshot() State {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s, _ := cloneState(r.state)
	return s
}

// cloneState deep-copies a state (maps, slices and pointers included).
func cloneState(in State) (State, error) {
	b, err := json.Marshal(in)
	if err != nil {
		return in, err
	}
	var s State
	if err := json.Unmarshal(b, &s); err != nil {
		return in, err
	}
	if s.Labels == nil {
		s.Labels = map[string]string{}
	}
	if s.Scenes == nil {
		s.Scenes = map[string]Scene{}
	}
	return s, nil
}

// Update mutates the state under lock and broadcasts it. The change is
// all-or-nothing: fn works on a deep copy that replaces the state only when
// fn succeeds, so a patch rejected half-way (e.g. a valid title followed by
// an unknown layout) never leaves the room with a state nobody was told about.
func (r *Room) Update(fn func(*State) error) error {
	r.mu.Lock()
	next, err := cloneState(r.state)
	if err == nil {
		err = fn(&next)
	}
	if err != nil {
		r.mu.Unlock()
		return err
	}
	r.state = next
	r.mu.Unlock()
	st := r.Snapshot()
	r.broadcast(Msg{Type: "state", State: &st}, "")
	return nil
}

func (r *Room) broadcast(m Msg, except string) {
	b, err := json.Marshal(m)
	if err != nil {
		return
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	for id, p := range r.peers {
		if id != except {
			p.sendRaw(b)
		}
	}
}

func (r *Room) toHosts(m Msg) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, p := range r.peers {
		if p.role() == RoleHost {
			p.Send(m)
		}
	}
}

// PeerInfo is the public view of a participant.
type PeerInfo struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Role  Role   `json:"role"`
	Mic   bool   `json:"mic"`
	Cam   bool   `json:"cam"`
	Hand  bool   `json:"hand"`
	Stage bool   `json:"stage"`
}

// Peers returns public infos (viewers are hidden).
func (r *Room) Peers() []PeerInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := []PeerInfo{}
	for _, p := range r.peers {
		if p.Role != RoleViewer {
			out = append(out, p.Info(r.state.Stage))
		}
	}
	return out
}

func (r *Room) empty() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.peers) == 0 && len(r.waiting) == 0 && len(r.streams) == 0
}

func (r *Room) close() {
	r.mu.Lock()
	streams := make([]*sfu.Stream, 0, len(r.streams))
	for _, s := range r.streams {
		streams = append(streams, s)
	}
	rs := r.restream
	r.restream = nil
	r.mu.Unlock()
	if rs != nil {
		rs.Stop()
	}
	for _, s := range streams {
		s.Close()
	}
}

func (r *Room) addChat(c Comment) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.chat = append(r.chat, c)
	if len(r.chat) > 200 {
		r.chat = r.chat[len(r.chat)-200:]
	}
}

func (r *Room) history() []Comment {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return append([]Comment(nil), r.chat...)
}

var errFull = errors.New("room is full")
