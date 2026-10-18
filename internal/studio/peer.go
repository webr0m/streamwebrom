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
)

// Msg is the single signalling envelope (JSON over WebSocket).
type Msg struct {
	Type string `json:"type"`

	// identity / auth
	Room     string `json:"room,omitempty"`
	Name     string `json:"name,omitempty"`
	Role     Role   `json:"role,omitempty"`
	Key      string `json:"key,omitempty"`      // host key or view key
	Password string `json:"password,omitempty"` // guest password
	PeerID   string `json:"peerId,omitempty"`
	Invite   string `json:"invite,omitempty"` // invite key from the host's invite link: skips the lobby
	Rejoin   string `json:"rejoin,omitempty"` // pass given to an admitted guest so a reconnect skips the lobby

	// media
	Stream      string                     `json:"stream,omitempty"`
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

	room *Room
	pass string // rejoin pass (guests), guarded by room.mu
	conn *websocket.Conn
	out  chan []byte
	lim  *rate.Limiter

	mu           sync.Mutex
	mic          bool
	cam          bool
	routeRefresh bool
	hand         bool
	subs         map[string]*sfu.Subscriber
	pubs         map[string]*sfu.Stream
	icePCs       map[string]*webrtc.PeerConnection
	once         sync.Once
	gone         chan struct{}
}

func newPeer(conn *websocket.Conn, lim *rate.Limiter) *Peer {
	return &Peer{ID: token(12), conn: conn, out: make(chan []byte, 256), lim: lim,
		subs: map[string]*sfu.Subscriber{}, pubs: map[string]*sfu.Stream{}, icePCs: map[string]*webrtc.PeerConnection{}, gone: make(chan struct{})}
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
		}
		p.mu.Unlock()
	}()
}

func (p *Peer) iceCallback(m Msg) ([]func(webrtc.ICECandidateInit), error) {
	if !m.Trickle {
		return nil, nil
	}
	if !streamIDRe.MatchString(m.Negotiation) {
		return nil, errors.New("invalid ICE negotiation")
	}
	p.mu.Lock()
	_, exists := p.icePCs[m.Negotiation]
	p.mu.Unlock()
	if exists {
		return nil, errors.New("ICE negotiation already exists")
	}
	return []func(webrtc.ICECandidateInit){func(c webrtc.ICECandidateInit) {
		p.Send(Msg{Type: "ice", Negotiation: m.Negotiation, Candidate: &c})
	}}, nil
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
	return PeerInfo{ID: p.ID, Name: p.Name, Role: p.Role, Mic: p.mic, Cam: p.cam, Hand: p.hand, Stage: onStage}
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
