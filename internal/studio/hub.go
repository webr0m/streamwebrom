package studio

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
	"golang.org/x/time/rate"

	"github.com/webr0m/streamwebrom/internal/record"
	"github.com/webr0m/streamwebrom/internal/restream"
	"github.com/webr0m/streamwebrom/internal/sfu"
)

// Options for the hub.
type Options struct {
	Engine      *sfu.Engine
	Recorder    *record.Recorder
	FFmpeg      string
	ICE         []webrtc.ICEServer
	ICEProvider func() []webrtc.ICEServer
	MaxRooms    int
	MaxPeers    int
	MaxMsgBytes int64
	MsgRate     float64
	MsgBurst    int
	RoomTTL     time.Duration
	// RejoinGrace keeps a reconnecting guest's place on stage (0 = drop at once).
	RejoinGrace time.Duration
	CheckOrigin func(*http.Request) bool
	Logger      *slog.Logger
}

// Hub owns all rooms.
type Hub struct {
	o        Options
	log      *slog.Logger
	upgrader websocket.Upgrader

	mu    sync.RWMutex
	rooms map[string]*Room
}

// NewHub creates a hub and starts the idle-room reaper.
func NewHub(ctx context.Context, o Options) *Hub {
	if o.Logger == nil {
		o.Logger = slog.Default()
	}
	h := &Hub{o: o, log: o.Logger, rooms: map[string]*Room{}}
	h.upgrader = websocket.Upgrader{
		ReadBufferSize: 4096, WriteBufferSize: 4096,
		CheckOrigin:       o.CheckOrigin,
		EnableCompression: true,
	}
	go h.reap(ctx)
	return h
}

var roomIDRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{2,47}$`)

// RefreshRoutes reconnects browsers so active sessions leave an exhausted
// provider, while preserving stage slots for the normal rejoin grace period.
func (h *Hub) RefreshRoutes() {
	h.mu.RLock()
	var peers []*Peer
	for _, r := range h.rooms {
		r.mu.RLock()
		for _, p := range r.peers {
			peers = append(peers, p)
		}
		for _, p := range r.waiting {
			peers = append(peers, p)
		}
		r.mu.RUnlock()
	}
	h.mu.RUnlock()
	for _, p := range peers {
		p.mu.Lock()
		p.routeRefresh = true
		p.mu.Unlock()
		p.close()
	}
}

// ValidRoomID reports whether id is an acceptable room name.
func ValidRoomID(id string) bool { return roomIDRe.MatchString(id) }

// CreateRoom creates a room. An empty id generates a random one.
func (h *Hub) CreateRoom(id, guestPassword, title string, lobby bool) (Keys, error) {
	if id == "" {
		id = NewRoomID()
	}
	id = strings.ToLower(id)
	if !ValidRoomID(id) {
		return Keys{}, errors.New("room id must be 3-48 chars: a-z 0-9 _ -")
	}
	if len(guestPassword) > 72 || utf8.RuneCountInString(title) > 120 {
		return Keys{}, errors.New("password or title too long")
	}
	// Hash passwords outside the hub lock so other rooms remain responsive.
	r, keys, err := newRoom(id, guestPassword, lobby, title)
	if err != nil {
		return Keys{}, err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.rooms[id]; ok {
		return Keys{}, errors.New("room already exists")
	}
	if len(h.rooms) >= h.o.MaxRooms {
		return Keys{}, errors.New("server is at room capacity")
	}
	h.rooms[id] = r
	h.log.Info("room created", "room", id)
	return keys, nil
}

// Room returns a room by id.
func (h *Hub) Room(id string) *Room {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.rooms[strings.ToLower(id)]
}

// Stats summarises the hub.
func (h *Hub) Stats() map[string]any {
	h.mu.RLock()
	defer h.mu.RUnlock()
	peers, streams := 0, 0
	for _, r := range h.rooms {
		r.mu.RLock()
		peers += len(r.peers)
		streams += len(r.streams)
		r.mu.RUnlock()
	}
	return map[string]any{"rooms": len(h.rooms), "peers": peers, "streams": streams}
}

func (h *Hub) reap(ctx context.Context) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			h.mu.Lock()
			for _, r := range h.rooms {
				r.close()
			}
			h.mu.Unlock()
			return
		case <-t.C:
			h.ReapNow(time.Now())
		}
	}
}

// ReapNow removes rooms that have been empty longer than the TTL.
func (h *Hub) ReapNow(now time.Time) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	n := 0
	for id, r := range h.rooms {
		r.mu.RLock()
		idle := len(r.peers) == 0 && len(r.waiting) == 0 && len(r.streams) == 0 && len(r.publishing) == 0 && now.Sub(r.emptyAt) > h.o.RoomTTL
		r.mu.RUnlock()
		if idle {
			r.close()
			delete(h.rooms, id)
			n++
			h.log.Info("room reaped", "room", id)
		}
	}
	return n
}

// ServeWS upgrades and runs a signalling connection.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(h.o.MaxMsgBytes)
	p := newPeer(conn, rate.NewLimiter(rate.Limit(h.o.MsgRate), h.o.MsgBurst))
	go p.writeLoop()
	defer h.leave(p)
	_ = conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(pongWait)) })

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		_ = conn.SetReadDeadline(time.Now().Add(pongWait))
		if !p.lim.Allow() {
			p.Send(Msg{Type: "error", Error: "rate limited"})
			continue
		}
		var m Msg
		if err := json.Unmarshal(data, &m); err != nil {
			p.Send(Msg{Type: "error", Error: "bad json"})
			continue
		}
		if err := h.handle(ctx, p, m); err != nil {
			p.Send(Msg{Type: "error", Error: err.Error(), ReqID: m.ReqID, Action: m.Type})
		}
	}
}

func cleanName(s string) string {
	s = strings.TrimSpace(strings.Map(func(r rune) rune {
		if r < 32 || r == '<' || r == '>' {
			return -1
		}
		return r
	}, s))
	if utf8.RuneCountInString(s) > 40 {
		s = string([]rune(s)[:40])
	}
	if s == "" {
		s = "Invitado"
	}
	return s
}

var streamIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,48}$`)

func (h *Hub) handle(ctx context.Context, p *Peer, m Msg) error {
	if m.Type == "ping" {
		p.Send(Msg{Type: "pong", TS: m.TS})
		return nil
	}
	if p.room == nil {
		if m.Type != "join" {
			return errors.New("join first")
		}
		return h.join(p, m)
	}
	r := p.room
	role := p.role()
	if role == "" { // waiting in lobby
		return errors.New("waiting for the host to let you in")
	}
	switch m.Type {
	case "ice":
		p.mu.Lock()
		pc := p.icePCs[m.Negotiation]
		p.mu.Unlock()
		if pc == nil || m.Candidate == nil {
			return errors.New("unknown ICE negotiation")
		}
		return pc.AddICECandidate(*m.Candidate)
	case "publish":
		return h.publish(ctx, p, m)
	case "unpublish":
		p.mu.Lock()
		s := p.pubs[m.Stream]
		delete(p.pubs, m.Stream)
		p.mu.Unlock()
		if s != nil {
			s.Close()
		}
		return nil
	case "subscribe":
		return h.subscribe(ctx, p, m)
	case "answer":
		p.mu.Lock()
		sub := p.subs[m.Stream]
		p.mu.Unlock()
		if sub == nil || m.SDP == nil {
			return errors.New("no pending subscription")
		}
		return sub.PC().SetRemoteDescription(*m.SDP)
	case "unsubscribe":
		p.mu.Lock()
		sub := p.subs[m.Stream]
		delete(p.subs, m.Stream)
		p.mu.Unlock()
		if sub != nil {
			sub.Close()
		}
		return nil
	case "chat":
		c := Comment{ID: token(8), From: p.Name, Source: "chat", TS: time.Now().UnixMilli(), PeerID: p.ID, Role: role}
		if m.Kind == "sticker" {
			if !validSticker(m.Text) {
				return errors.New("unknown sticker")
			}
			c.Sticker = m.Text
		} else {
			c.Text = limit(strings.TrimSpace(m.Text), 500)
			if c.Text == "" {
				return nil
			}
		}
		r.addChat(c)
		r.broadcast(Msg{Type: "chat", Comment: &c, PeerID: p.ID}, "")
		return nil
	case "media":
		p.mu.Lock()
		if m.Mic != nil {
			p.mic = *m.Mic
		}
		if m.Cam != nil {
			p.cam = *m.Cam
		}
		p.mu.Unlock()
		h.peerUpdated(p)
		return nil
	case "hand":
		p.mu.Lock()
		p.hand = !p.hand
		p.mu.Unlock()
		h.peerUpdated(p)
		return nil
	case "report": // guest -> hosts: device list, live stats, applied quality
		if !slices.Contains(ReportActions, m.Action) {
			return fmt.Errorf("unknown report %q", m.Action)
		}
		if len(m.Value) > maxReportValue {
			return errors.New("report too large")
		}
		r.toHosts(Msg{Type: "report", Action: m.Action, Value: m.Value, PeerID: p.ID, Name: p.Name, ReqID: m.ReqID})
		return nil
	case "reaction":
		e := strings.TrimSpace(m.Text)
		if e == "" || utf8.RuneCountInString(e) > 4 {
			return errors.New("bad reaction")
		}
		r.broadcast(Msg{Type: "reaction", Text: e, PeerID: p.ID, Name: p.Name}, "")
		return nil
	}
	if role != RoleHost {
		return fmt.Errorf("%s requires host", m.Type)
	}
	return h.hostAction(p, m)
}

func (h *Hub) join(p *Peer, m Msg) error {
	r := h.Room(m.Room)
	if r == nil {
		return errors.New("room not found")
	}
	role := m.Role
	switch role {
	case RoleHost:
		if !r.CheckHost(m.Key) {
			return errors.New("invalid host key")
		}
	case RoleViewer:
		if !r.CheckView(m.Key) && !r.CheckHost(m.Key) {
			return errors.New("invalid view key")
		}
	case RoleGuest, "":
		role = RoleGuest
		if !r.CheckGuest(m.Password) {
			return errors.New("invalid password")
		}
	default:
		return errors.New("invalid role")
	}
	p.Name = cleanName(m.Name)
	if role == RoleViewer && m.Name == "" {
		p.Name = "OBS"
	}
	r.mu.Lock()
	if len(r.peers)+len(r.waiting) >= h.o.MaxPeers {
		r.mu.Unlock()
		return errFull
	}
	p.room = r
	rejoin := role == RoleGuest && m.Rejoin != "" && r.passes[m.Rejoin]
	if rejoin {
		p.pass = m.Rejoin
	}
	lobby := role == RoleGuest && r.state.Lobby && !rejoin && !r.CheckInvite(m.Invite)
	if lobby {
		r.waiting[p.ID] = p
	} else {
		p.mu.Lock()
		p.Role = role
		p.mu.Unlock()
		r.peers[p.ID] = p
	}
	r.mu.Unlock()

	if lobby {
		p.Send(Msg{Type: "waiting", PeerID: p.ID})
		r.toHosts(Msg{Type: "knock", PeerID: p.ID, Name: p.Name})
		return nil
	}
	h.welcome(p)
	return nil
}

// admit moves one waiting guest (or all of them when id is "") into the
// room's backstage and welcomes them. It returns how many got in.
func (h *Hub) admit(r *Room, id string) int {
	r.mu.Lock()
	var in []*Peer
	for wid, p := range r.waiting {
		if id != "" && wid != id {
			continue
		}
		delete(r.waiting, wid)
		p.mu.Lock()
		p.Role = RoleGuest
		p.mu.Unlock()
		r.peers[wid] = p
		in = append(in, p)
	}
	r.mu.Unlock()
	for _, p := range in {
		r.toHosts(Msg{Type: "knock-cancel", PeerID: p.ID, Action: "admitted"})
		h.welcome(p)
	}
	return len(in)
}

func (h *Hub) welcome(p *Peer) {
	r := p.room
	st := r.Snapshot()
	role := p.role()
	w := Msg{Type: "welcome", PeerID: p.ID, Role: role, Room: r.ID, State: &st,
		Peers: r.Peers(), Streams: r.Streams(), Chat: r.history(), ICE: h.o.ICE, Trickle: true}
	if h.o.ICEProvider != nil {
		w.ICE = h.o.ICEProvider()
	}
	if role == RoleGuest {
		w.Rejoin = r.issuePass(p)
	}
	if role == RoleHost {
		w.Keys = &Keys{Room: r.ID, ViewKey: r.viewKey, PushKey: r.pushKey, InviteKey: r.inviteKey}
		r.mu.RLock()
		for _, wp := range r.waiting {
			defer p.Send(Msg{Type: "knock", PeerID: wp.ID, Name: wp.Name})
		}
		r.mu.RUnlock()
	}
	p.Send(w)
	if role != RoleViewer {
		inf := p.Info(st.Stage)
		r.broadcast(Msg{Type: "peer-joined", Peer: &inf}, p.ID)
	}
}

func (h *Hub) peerUpdated(p *Peer) {
	st := p.room.Snapshot()
	inf := p.Info(st.Stage)
	p.room.broadcast(Msg{Type: "peer-updated", Peer: &inf}, "")
}

func (h *Hub) leave(p *Peer) {
	p.close()
	r := p.room
	if r == nil {
		return
	}
	r.mu.Lock()
	_, knocking := r.waiting[p.ID]
	delete(r.waiting, p.ID)
	_, was := r.peers[p.ID]
	delete(r.peers, p.ID)
	if len(r.peers) == 0 {
		r.emptyAt = time.Now()
	}
	r.mu.Unlock()
	if knocking { // let hosts drop the stale "wants to join" entry
		r.toHosts(Msg{Type: "knock-cancel", PeerID: p.ID})
	}
	p.mu.Lock()
	pubs := p.pubs
	subs := p.subs
	routeRefresh := p.routeRefresh
	p.pubs, p.subs = map[string]*sfu.Stream{}, map[string]*sfu.Subscriber{}
	p.mu.Unlock()
	// Network teardown can block on pending TURN dials. Release every owned
	// stream ID first so an authenticated reconnect can immediately republish.
	// Pointer checks keep a delayed old OnClose from removing a replacement.
	var removed []string
	r.mu.Lock()
	for id, s := range pubs {
		if r.streams[id] == s {
			delete(r.streams, id)
			removed = append(removed, id)
		}
	}
	r.mu.Unlock()
	for _, id := range removed {
		r.broadcast(Msg{Type: "stream-removed", Stream: id}, "")
	}
	for _, s := range pubs {
		s.Close()
	}
	for _, s := range subs {
		s.Close()
	}
	if was && p.role() != RoleViewer {
		r.broadcast(Msg{Type: "peer-left", PeerID: p.ID}, "")
	}
	// Drop departed streams from the program and every extra scene, and
	// refresh the recording list (their recordings stopped with them).
	// A guest with a rejoin pass gets a grace period: if they reconnect and
	// publish the same stream again, they keep their place on stage.
	if len(pubs) == 0 {
		return
	}
	r.mu.RLock()
	hasPass := p.pass != ""
	r.mu.RUnlock()
	if (hasPass || routeRefresh) && h.o.RejoinGrace > 0 {
		h.dropStreams(r, pubs, false)
		time.AfterFunc(h.o.RejoinGrace, func() { h.dropStreams(r, pubs, true) })
		return
	}
	h.dropStreams(r, pubs, true)
}

// dropStreams removes departed streams from the stage, the featured slot and
// every extra scene (only those that were not published again when
// skipLive), and refreshes the recording list.
func (h *Hub) dropStreams(r *Room, pubs map[string]*sfu.Stream, fromStage bool) {
	{
		gone := func(id string) bool {
			if _, ok := pubs[id]; !ok {
				return false
			}
			// Update already owns r.mu; calling Stream here deadlocks.
			return r.streams[id] == nil
		}
		if !fromStage {
			gone = func(string) bool { return false }
		}
		_ = r.Update(func(st *State) error {
			st.Stage = slices.DeleteFunc(st.Stage, gone)
			if gone(st.Featured) {
				st.Featured = ""
			}
			for name, o := range st.Outputs {
				o.Stage = slices.DeleteFunc(o.Stage, gone)
				if gone(o.Featured) {
					o.Featured = ""
				}
				st.Outputs[name] = o
			}
			if h.o.Recorder != nil {
				st.Recording = h.o.Recorder.Active(r.ID)
			}
			return nil
		})
	}
}

func (h *Hub) publish(ctx context.Context, p *Peer, m Msg) error {
	role := p.role()
	if role == RoleViewer {
		return errors.New("viewers cannot publish")
	}
	if m.SDP == nil {
		return errors.New("missing sdp")
	}
	kind := m.Kind
	if kind == "" {
		kind = "camera"
	}
	if kind != "camera" && kind != "screen" && kind != "program" && kind != "media" {
		return errors.New("bad kind")
	}
	if kind == "program" && role != RoleHost {
		return errors.New("only the host publishes the program")
	}
	id := m.Stream
	if id == "" {
		id = p.ID + "-" + kind
		// Guests with a rejoin pass keep the same stream id across reconnects,
		// so they come back to the same spot on stage.
		p.room.mu.RLock()
		pass := p.pass
		p.room.mu.RUnlock()
		if pass != "" {
			id = passStreamID(pass, kind)
		}
	}
	if !streamIDRe.MatchString(id) {
		return errors.New("bad stream id")
	}
	if id == "program" && role != RoleHost {
		return errors.New("program stream id requires host")
	}
	p.mu.Lock()
	_, replacing := p.pubs[id]
	full := len(p.pubs) >= 8 && !replacing
	p.mu.Unlock()
	if full {
		return errors.New("maximum 8 published streams per peer")
	}
	// A guest may not hijack someone else's stream id.
	if old := p.room.Stream(id); old != nil && old.Owner != p.ID && role != RoleHost {
		return errors.New("stream id in use")
	}
	release, err := p.room.reserveStream(id, p.ID, role == RoleHost, h.o.MaxPeers*8)
	if err != nil {
		return err
	}
	defer release()
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	callbacks, err := p.iceCallback(m)
	if err != nil {
		return err
	}
	s, answer, err := h.o.Engine.Publish(cctx, id, p.ID, kind, *m.SDP, callbacks...)
	if err != nil {
		return err
	}
	p.mu.Lock()
	if old := p.pubs[id]; old != nil {
		defer old.Close()
	}
	p.pubs[id] = s
	p.mu.Unlock()
	if m.Trickle {
		p.registerICE(m.Negotiation, s.PC(), s.Done())
	}
	if !p.room.AddStream(s) {
		return errors.New("room closed")
	}
	if label := strings.TrimSpace(m.Name); label != "" {
		_ = p.room.Update(func(st *State) error { st.Labels[id] = cleanName(label); return nil })
	}
	p.Send(Msg{Type: "answer", Stream: id, SDP: answer, ReqID: m.ReqID})
	return nil
}

func (h *Hub) subscribe(ctx context.Context, p *Peer, m Msg) error {
	s := p.room.Stream(m.Stream)
	if s == nil {
		return fmt.Errorf("stream %q not found", m.Stream)
	}
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	callbacks, err := p.iceCallback(m)
	if err != nil {
		return err
	}
	sub, offer, err := h.o.Engine.SubscribeOffer(cctx, s, callbacks...)
	if err != nil {
		return err
	}
	p.mu.Lock()
	if old := p.subs[s.ID]; old != nil {
		defer old.Close()
	}
	p.subs[s.ID] = sub
	p.mu.Unlock()
	if m.Trickle {
		p.registerICE(m.Negotiation, sub.PC(), sub.Done())
	}
	p.Send(Msg{Type: "offer", Stream: s.ID, SDP: offer, ReqID: m.ReqID, Name: p.room.label(s)})
	return nil
}

// RequestActions are the moderation requests a host may send to guests.
var RequestActions = []string{
	"mute", "unmute", "camoff", "camon", "lowerhand", "screenoff", // moderation
	"quality", "device", "devices", "stats", "camctl", "gain", "audio", // remote device / encoder control (VDO.Ninja director)
	"deafen", "undeafen", "message", "reload", "transfer", "screenon",
}

// ReportActions are the replies a guest may send back to the hosts.
var ReportActions = []string{"devices", "stats", "quality", "ack"}

const maxRequestValue = 4 << 10
const maxReportValue = 16 << 10

// requestTargets resolves a request target: a peer id, "*" (every guest) or
// "stage" (every guest that has a stream on stage).
func (h *Hub) requestTargets(r *Room, host *Peer, target string) []*Peer {
	if target != "*" && target != "stage" {
		if p := h.peerByID(r, target); p != nil && p != host {
			return []*Peer{p}
		}
		return nil
	}
	r.mu.RLock()
	stage := slices.Clone(r.state.Stage)
	peers := make([]*Peer, 0, len(r.peers))
	for _, p := range r.peers {
		if p != host && p.Role == RoleGuest {
			peers = append(peers, p)
		}
	}
	r.mu.RUnlock()
	if target == "*" {
		return peers
	}
	var out []*Peer
	for _, p := range peers {
		if p.Info(stage).Stage {
			out = append(out, p)
		}
	}
	return out
}

func (h *Hub) peerByID(r *Room, id string) *Peer {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if p := r.peers[id]; p != nil {
		return p
	}
	return r.waiting[id]
}

func (h *Hub) hostAction(host *Peer, m Msg) error {
	r := host.room
	switch m.Type {
	case "admit", "deny":
		if m.Type == "admit" {
			if h.admit(r, m.Target) == 0 {
				return errors.New("nobody waiting with that id")
			}
			return nil
		}
		r.mu.Lock()
		p := r.waiting[m.Target]
		delete(r.waiting, m.Target)
		r.mu.Unlock()
		if p == nil {
			return errors.New("nobody waiting with that id")
		}
		p.Send(Msg{Type: "denied"})
		p.close()
		return nil
	case "admit-all":
		h.admit(r, "")
		return nil
	case "kick":
		p := h.peerByID(r, m.Target)
		if p == nil {
			return errors.New("peer not found")
		}
		r.revokePass(p)
		p.Send(Msg{Type: "kicked"})
		time.AfterFunc(200*time.Millisecond, p.close)
		return nil
	case "request": // remote moderation: mute/unmute mic, camera off/on, lower hand...
		if !slices.Contains(RequestActions, m.Action) {
			return fmt.Errorf("unknown request %q", m.Action)
		}
		if len(m.Value) > maxRequestValue {
			return errors.New("request value too large")
		}
		if m.Action == "transfer" {
			var to string
			if err := json.Unmarshal(m.Value, &to); err != nil || h.Room(to) == nil {
				return errors.New("transfer: destination room not found")
			}
		}
		targets := h.requestTargets(r, host, m.Target)
		if len(targets) == 0 {
			return errors.New("peer not found")
		}
		for _, p := range targets {
			if m.Action == "lowerhand" {
				p.mu.Lock()
				p.hand = false
				p.mu.Unlock()
				h.peerUpdated(p)
			}
			p.Send(Msg{Type: "request", Action: m.Action, Value: m.Value})
		}
		return nil
	case "state":
		return h.setState(r, m)
	case "record":
		return h.record(r, m)
	case "golive":
		return h.goLive(r, m)
	case "endlive":
		r.mu.Lock()
		r.liveGeneration++
		r.starting = false
		rs := r.restream
		r.restream = nil
		r.state.Live = false
		r.state.Restream = nil
		r.mu.Unlock()
		if rs != nil {
			rs.Stop()
		}
		st := r.Snapshot()
		r.broadcast(Msg{Type: "state", State: &st}, "")
		return nil
	}
	return fmt.Errorf("unknown message %q", m.Type)
}

func (h *Hub) setState(r *Room, m Msg) error {
	var patch map[string]json.RawMessage
	if err := json.Unmarshal(m.Value, &patch); err != nil {
		return errors.New("state value must be an object")
	}
	if _, ok := patch["lobby"]; ok {
		// Turning the waiting room off must not strand whoever is in it.
		defer func() {
			if !r.Snapshot().Lobby {
				h.admit(r, "")
			}
		}()
	}
	return r.Update(func(st *State) error {
		for k, v := range patch {
			var err error
			switch k {
			case "title":
				err = json.Unmarshal(v, &st.Title)
				st.Title = limit(st.Title, 120)
			case "layout":
				var l string
				if err = json.Unmarshal(v, &l); err == nil {
					if !slices.Contains(Layouts, l) {
						return fmt.Errorf("unknown layout %q", l)
					}
					st.Layout = l
				}
			case "stage":
				var s []string
				if err = json.Unmarshal(v, &s); err == nil {
					if err := validateStage(s); err != nil {
						return err
					}
					st.Stage = s
				}
			case "featured":
				err = json.Unmarshal(v, &st.Featured)
				if st.Featured != "" && !streamIDRe.MatchString(st.Featured) {
					return errors.New("invalid featured stream id")
				}
			case "banner":
				var b *Banner
				if err = json.Unmarshal(v, &b); err == nil {
					if b != nil {
						b.Text = limit(b.Text, 300)
					}
					st.Banner = b
				}
			case "banners":
				var bs []Banner
				if err = json.Unmarshal(v, &bs); err == nil {
					if len(bs) > 50 {
						return errors.New("too many banners")
					}
					for i := range bs {
						bs[i].Text = limit(bs[i].Text, 300)
					}
					st.Banners = bs
				}
			case "comment":
				var c *Comment
				if err = json.Unmarshal(v, &c); err == nil {
					if c != nil {
						c.Text = limit(c.Text, 500)
						c.From = limit(c.From, 60)
						c.Source = limit(c.Source, 30)
						if c.Sticker != "" && !validSticker(c.Sticker) {
							return errors.New("unknown sticker")
						}
					}
					st.Comment = c
				}
			case "brand":
				var b Brand
				if err = json.Unmarshal(v, &b); err == nil {
					if err = validBrand(b); err != nil {
						return err
					}
					st.Brand = b
				}
			case "lobby":
				err = json.Unmarshal(v, &st.Lobby)
			case "scenes":
				var sc map[string]Scene
				if err = json.Unmarshal(v, &sc); err == nil {
					if len(sc) > 20 {
						return errors.New("too many scenes")
					}
					for name, scene := range sc {
						if utf8.RuneCountInString(name) > 80 {
							return errors.New("scene name too long")
						}
						if !slices.Contains(Layouts, scene.Layout) {
							return errors.New("unknown scene layout")
						}
						if err := validateStage(scene.Stage); err != nil {
							return err
						}
						if scene.Banner != nil {
							scene.Banner.Text = limit(scene.Banner.Text, 300)
						}
					}
					st.Scenes = sc
				}
			case "outputs": // VDO.Ninja-style extra scenes (/view?scene=N), "1" is the program
				var o map[string]Output
				if err = json.Unmarshal(v, &o); err == nil {
					if len(o) > 12 {
						return errors.New("too many scenes")
					}
					for name, sc := range o {
						if !sceneNameRe.MatchString(name) {
							return fmt.Errorf("bad scene name %q", name)
						}
						if err := validateStage(sc.Stage); err != nil {
							return err
						}
						if sc.Featured != "" && !streamIDRe.MatchString(sc.Featured) {
							return errors.New("invalid featured stream id")
						}
						if sc.Layout != "" && !slices.Contains(Layouts, sc.Layout) {
							return fmt.Errorf("unknown layout %q", sc.Layout)
						}
					}
					st.Outputs = o
				}
			case "labels":
				var l map[string]string
				if err = json.Unmarshal(v, &l); err == nil {
					if len(l) > 200 {
						return errors.New("too many labels")
					}
					for k2, v2 := range l {
						if !streamIDRe.MatchString(k2) {
							return errors.New("invalid label stream id")
						}
						l[k2] = limit(v2, 80)
					}
					st.Labels = l
				}
			case "countdown":
				err = json.Unmarshal(v, &st.Countdown)
			case "muted": // program-only mute per stream (guest's mic stays open for the backstage)
				var mm map[string]bool
				if err = json.Unmarshal(v, &mm); err == nil {
					if len(mm) > 200 {
						return errors.New("too many muted entries")
					}
					st.Muted = mm
				}
			case "volumes": // program volume per stream, 0..2 (0-200 %)
				var vv map[string]float64
				if err = json.Unmarshal(v, &vv); err == nil {
					if len(vv) > 200 {
						return errors.New("too many volume entries")
					}
					for k2, x := range vv {
						if x != x || x < 0 || x > 2 {
							return fmt.Errorf("volume for %s must be between 0 and 2", k2)
						}
					}
					st.Volumes = vv
				}
			case "stageMuted": // mute the whole stage in the program
				err = json.Unmarshal(v, &st.StageMuted)
			case "hidden": // keep audio, hide video in the program
				var hm map[string]bool
				if err = json.Unmarshal(v, &hm); err == nil {
					if len(hm) > 200 {
						return errors.New("too many hidden entries")
					}
					st.Hidden = hm
				}
			default:
				return fmt.Errorf("unknown state key %q", k)
			}
			if err != nil {
				return fmt.Errorf("%s: %w", k, err)
			}
		}
		return nil
	})
}

func validateStage(stage []string) error {
	if len(stage) > 25 {
		return errors.New("too many on stage")
	}
	seen := make(map[string]bool, len(stage))
	for _, id := range stage {
		if !streamIDRe.MatchString(id) || seen[id] {
			return errors.New("invalid or duplicate stage stream id")
		}
		seen[id] = true
	}
	return nil
}

func limit(s string, n int) string {
	if utf8.RuneCountInString(s) > n {
		return string([]rune(s)[:n])
	}
	return s
}

var sceneNameRe = regexp.MustCompile(`^[a-z0-9-]{1,16}$`)

var colorRe = regexp.MustCompile(`^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$`)

func validURL(u string) bool {
	if u == "" {
		return true
	}
	if len(u) > 2_000_000 {
		return false
	}
	return strings.HasPrefix(u, "https://") || strings.HasPrefix(u, "data:image/") || strings.HasPrefix(u, "/")
}

func validBrand(b Brand) error {
	if b.Color != "" && !colorRe.MatchString(b.Color) {
		return errors.New("brand color must be #hex")
	}
	if b.Background != "" && !colorRe.MatchString(b.Background) && !validURL(b.Background) {
		return errors.New("brand background must be #hex or an https/data image URL")
	}
	if !validURL(b.Logo) || !validURL(b.Overlay) {
		return errors.New("logo/overlay must be https:// or data:image/ URLs")
	}
	switch b.Theme {
	case "", "bubble", "minimal", "bold":
	default:
		return errors.New("unknown theme")
	}
	return nil
}

func (h *Hub) record(r *Room, m Msg) error {
	if h.o.Recorder == nil {
		return errors.New("recording disabled")
	}
	ids := []string{m.Stream}
	all := m.Stream == "" || m.Stream == "*"
	if all {
		ids = nil
		for _, s := range r.Streams() {
			ids = append(ids, s.ID)
		}
	}
	for _, id := range ids {
		if m.Action == "stop" {
			_, _ = h.o.Recorder.Stop(r.ID, id)
			continue
		}
		s := r.Stream(id)
		if s == nil {
			return fmt.Errorf("stream %q not found", id)
		}
		if _, err := h.o.Recorder.Start(r.ID, s); err != nil {
			// "Record everything" must not abort because one source is already
			// being recorded or has no media yet: record the rest.
			if all {
				h.log.Warn("record: skipped stream", "room", r.ID, "stream", id, "err", err)
				continue
			}
			return err
		}
	}
	active := h.o.Recorder.Active(r.ID)
	if all && m.Action != "stop" && len(active) == 0 {
		return errors.New("nothing to record yet: add a camera, screen or guest first")
	}
	return r.Update(func(st *State) error { st.Recording = active; return nil })
}

func (h *Hub) goLive(r *Room, m Msg) error {
	id := m.Stream
	if id == "" {
		id = "program"
	}
	s := r.Stream(id)
	if s == nil {
		return errors.New("publish the program first (Studio → Go live does this automatically)")
	}
	settings := restream.Settings{}
	if m.Settings != nil {
		settings = *m.Settings
	}
	r.mu.Lock()
	if r.restream != nil || r.starting {
		r.mu.Unlock()
		return errors.New("already live")
	}
	r.starting = true // two hosts pressing "Go live" at once must not start two ffmpegs
	r.liveGeneration++
	generation := r.liveGeneration
	r.mu.Unlock()
	sess, err := restream.Start(h.o.FFmpeg, s, m.Dests, settings, h.log)
	r.mu.Lock()
	if r.liveGeneration != generation || r.closed {
		r.mu.Unlock()
		if sess != nil {
			sess.Stop()
		}
		return errors.New("go live cancelled")
	}
	r.starting = false
	if err == nil {
		r.restream = sess
		r.state.Live = true
		st := sess.Status()
		r.state.Restream = &st
	}
	r.mu.Unlock()
	if err != nil {
		return err
	}
	go func() {
		t := time.NewTicker(2 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-sess.Done():
				st := sess.Status()
				r.mu.Lock()
				if r.restream == sess {
					r.restream = nil
					r.state.Live = false
					r.state.Restream = &st
				}
				r.mu.Unlock()
				snapshot := r.Snapshot()
				r.broadcast(Msg{Type: "state", State: &snapshot}, "")
				return
			case <-t.C:
				st := sess.Status()
				r.toHosts(Msg{Type: "restream", State: &State{Restream: &st}})
			}
		}
	}()
	snapshot := r.Snapshot()
	r.broadcast(Msg{Type: "state", State: &snapshot}, "")
	return nil
}

// PublishWHIP registers an external (OBS/WHIP) publisher in a room.
func (h *Hub) PublishWHIP(ctx context.Context, r *Room, streamID string, offer webrtc.SessionDescription) (*sfu.Stream, *webrtc.SessionDescription, error) {
	if !streamIDRe.MatchString(streamID) {
		return nil, nil, errors.New("bad stream id")
	}
	release, err := r.reserveStream(streamID, "whip", false, h.o.MaxPeers*8)
	if err != nil {
		return nil, nil, err
	}
	defer release()
	s, ans, err := h.o.Engine.Publish(ctx, streamID, "whip", "whip", offer)
	if err != nil {
		return nil, nil, err
	}
	if !r.AddStream(s) {
		return nil, nil, errors.New("room closed")
	}
	return s, ans, nil
}

// SubscribeWHEP attaches an external (WHEP) player.
func (h *Hub) SubscribeWHEP(ctx context.Context, r *Room, streamID string, offer webrtc.SessionDescription) (*sfu.Subscriber, *webrtc.SessionDescription, error) {
	s := r.Stream(streamID)
	if s == nil {
		return nil, nil, errors.New("stream not found")
	}
	return h.o.Engine.SubscribeAnswer(ctx, s, offer)
}
