package studio

import (
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
	"golang.org/x/time/rate"

	"github.com/webr0m/streamwebrom/internal/restream"
	"github.com/webr0m/streamwebrom/internal/sfu"
	"github.com/webr0m/streamwebrom/internal/turnrelay"
)

// Msg is the single signalling envelope (JSON over WebSocket).
type Msg struct {
	Type          string                 `json:"type"`
	Persistent    bool                   `json:"persistent,omitempty"`
	Persistence   *PersistenceInfo       `json:"persistence,omitempty"`
	Relay         *turnrelay.RelayStatus `json:"relay,omitempty"`
	RelayProvider string                 `json:"relayProvider,omitempty"`
	RelayAccess   *RelayAccess           `json:"relayAccess,omitempty"`

	// identity / auth
	Room     string `json:"room,omitempty"`
	Name     string `json:"name,omitempty"`
	Role     Role   `json:"role,omitempty"`
	Key      string `json:"key,omitempty"`      // host key or view key
	Password string `json:"password,omitempty"` // guest password
	PeerID   string `json:"peerId,omitempty"`
	Invite   string `json:"invite,omitempty"` // invite key from the host's invite link: skips the lobby
	Rejoin   string `json:"rejoin,omitempty"` // pass given to an admitted guest so a reconnect skips the lobby
	Route    string `json:"route,omitempty"`  // empty = default provider; local = operator-installed relay

	// media
	Stream      string                     `json:"stream,omitempty"`
	Revision    string                     `json:"revision,omitempty"`
	Kind        string                     `json:"kind,omitempty"`
	SDP         *webrtc.SessionDescription `json:"sdp,omitempty"`
	Info        *sfu.Info                  `json:"info,omitempty"`
	Trickle     bool                       `json:"trickle,omitempty"`
	Negotiation string                     `json:"negotiation,omitempty"`
	Candidate   *webrtc.ICECandidateInit   `json:"candidate,omitempty"`

	// control
	Action string          `json:"action,omitempty"`
	Target string          `json:"target,omitempty"`
	Value  json.RawMessage `json:"value,omitempty"`
	Text   string          `json:"text,omitempty"`
	Error  string          `json:"error,omitempty"`
	ReqID  string          `json:"reqId,omitempty"`

	// state
	State    *State                 `json:"state,omitempty"`
	Peers    []PeerInfo             `json:"peers,omitempty"`
	Streams  []sfu.Info             `json:"streams,omitempty"`
	Peer     *PeerInfo              `json:"peer,omitempty"`
	Chat     []Comment              `json:"chat,omitempty"`
	Comment  *Comment               `json:"comment,omitempty"`
	ICE      []webrtc.ICEServer     `json:"ice,omitempty"`
	LocalICE []webrtc.ICEServer     `json:"localIce,omitempty"`
	Keys     *Keys                  `json:"keys,omitempty"`
	Dests    []restream.Destination `json:"dests,omitempty"`
	Settings *restream.Settings     `json:"settings,omitempty"`
	Mic      *bool                  `json:"mic,omitempty"`
	Cam      *bool                  `json:"cam,omitempty"`
	TS       int64                  `json:"ts,omitempty"`
}

// Peer is one WebSocket connection.
type Peer struct {
	ID   string
	Name string
	Role Role

	room  *Room
	pass  string // rejoin pass (guests), guarded by room.mu
	route string // immutable after join, before publishing the peer into a room
	conn  *websocket.Conn
	out   chan []byte
	lim   *rate.Limiter

	mu              sync.Mutex
	mic             bool
	cam             bool
	network         *NetworkInfo
	screenAllowed   bool
	screenRequested bool
	screenEpoch     uint64
	routeRefresh    bool
	hand            bool
	subs            map[string]*sfu.Subscriber
	pubs            map[string]*sfu.Stream
	icePCs          map[string]*webrtc.PeerConnection
	retiredICE      map[string]time.Time
	once            sync.Once
	gone            chan struct{}
}

func newPeer(conn *websocket.Conn, lim *rate.Limiter) *Peer {
	return &Peer{ID: token(12), conn: conn, out: make(chan []byte, 256), lim: lim,
		subs: map[string]*sfu.Subscriber{}, pubs: map[string]*sfu.Stream{}, icePCs: map[string]*webrtc.PeerConnection{}, retiredICE: map[string]time.Time{}, gone: make(chan struct{})}
}

const retiredICETTL = 2 * time.Minute
const maxRetiredICE = 256

// Keep a bounded, socket-local tombstone for controls already in flight when
// a receiver closes (for example when its publisher adds a late audio track).
// Unknown IDs still fail; a tombstone never resolves to a replacement PC.
func (p *Peer) retireICELocked(id string) {
	now := time.Now()
	oldestID := ""
	var oldest time.Time
	for key, until := range p.retiredICE {
		if !until.After(now) {
			delete(p.retiredICE, key)
		} else if oldestID == "" || until.Before(oldest) {
			oldestID, oldest = key, until
		}
	}
	if len(p.retiredICE) >= maxRetiredICE {
		delete(p.retiredICE, oldestID)
	}
	p.retiredICE[id] = now.Add(retiredICETTL)
}

func (p *Peer) retiredICELocked(id string) bool {
	until, ok := p.retiredICE[id]
	return ok && until.After(time.Now())
}

// Each negotiation belongs to this authenticated socket. Removing it on close
// also prevents late candidates from being applied to a replacement stream.
func (p *Peer) registerICE(id string, pc *webrtc.PeerConnection, done <-chan struct{}) {
	p.mu.Lock()
	p.icePCs[id] = pc
	p.mu.Unlock()
	go func() {
		<-done
		p.mu.Lock()
		if p.icePCs[id] == pc {
			delete(p.icePCs, id)
			p.retireICELocked(id)
		}
		p.mu.Unlock()
	}()
}

func (p *Peer) iceCallback(m Msg) ([]func(webrtc.ICECandidateInit), error) {
	if !m.Trickle && m.Negotiation == "" {
		return nil, nil
	}
	if !streamIDRe.MatchString(m.Negotiation) {
		return nil, errors.New("invalid ICE negotiation")
	}
	p.mu.Lock()
	_, exists := p.icePCs[m.Negotiation]
	retired := p.retiredICELocked(m.Negotiation)
	p.mu.Unlock()
	if exists || retired {
		return nil, errors.New("ICE negotiation already exists")
	}
	if !m.Trickle {
		return nil, nil
	}
	return []func(webrtc.ICECandidateInit){func(c webrtc.ICECandidateInit) {
		p.Send(Msg{Type: "ice", Negotiation: m.Negotiation, Candidate: &c})
	}}, nil
}

// Legacy clients omit negotiation. Modern clients scope every control message
// so delayed teardown/answers cannot touch a replacement with the same ID.
func (p *Peer) matchesNegotiation(id string, pc *webrtc.PeerConnection) bool {
	return id == "" || p.icePCs[id] == pc
}

// role reads the peer's role; it changes once, when the host admits a
// guest from the lobby, while the guest's own goroutine may be reading it.
func (p *Peer) role() Role {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.Role
}

// Info returns the public view. stage is the room's current stage list.
func (p *Peer) Info(stage []string) PeerInfo {
	p.mu.Lock()
	defer p.mu.Unlock()
	onStage := false
	for _, s := range stage {
		if _, ok := p.pubs[s]; ok {
			onStage = true
		}
	}
	return PeerInfo{ID: p.ID, Name: p.Name, Role: p.Role, Mic: p.mic, Cam: p.cam, Hand: p.hand, Stage: onStage, ScreenAllowed: p.screenAllowed, ScreenRequested: p.screenRequested, Network: p.network}
}

// Send queues a message; slow consumers are dropped instead of blocking the room.
func (p *Peer) Send(m Msg) {
	b, err := json.Marshal(m)
	if err == nil {
		p.sendRaw(b)
	}
}

func (p *Peer) sendRaw(b []byte) {
	select {
	case <-p.gone:
	case p.out <- b:
	default:
		// Buffer full: the client is not reading. Disconnect it.
		p.close()
	}
}

func (p *Peer) close() {
	p.once.Do(func() {
		close(p.gone)
		_ = p.conn.Close()
	})
}

const (
	writeWait  = 10 * time.Second
	pongWait   = 45 * time.Second
	pingPeriod = 20 * time.Second
)

func (p *Peer) writeLoop() {
	t := time.NewTicker(pingPeriod)
	defer t.Stop()
	for {
		select {
		case <-p.gone:
			return
		case b := <-p.out:
			_ = p.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := p.conn.WriteMessage(websocket.TextMessage, b); err != nil {
				p.close()
				return
			}
		case <-t.C:
			_ = p.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := p.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				p.close()
				return
			}
		}
	}
}
