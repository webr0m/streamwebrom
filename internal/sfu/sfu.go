// Package sfu is a small Selective Forwarding Unit built on pion/webrtc.
//
// A publisher uploads its media once; the server fans every RTP packet out to
// any number of sinks: WebRTC subscribers (browsers, OBS browser sources,
// WHEP players), recorders and the RTMP restreamer. Nothing is decoded, so
// latency stays at network level and CPU stays low.
package sfu

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/ice/v4"
	"github.com/pion/interceptor"
	"github.com/pion/interceptor/pkg/intervalpli"
	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

// Options configures the media engine.
type Options struct {
	ICEServers  []webrtc.ICEServer
	ICEProvider func() []webrtc.ICEServer
	PublicIPs   []string
	UDPPort     int
	UDPPortMin  uint16
	UDPPortMax  uint16
	// GatherTimeout bounds how long we wait for ICE gathering when building
	// non-trickle SDP (WHIP/WHEP style).
	GatherTimeout time.Duration
	Logger        *slog.Logger
}

// Engine creates peer connections that share one configured pion API.
type Engine struct {
	api    *webrtc.API
	opts   Options
	log    *slog.Logger
	udpMux ice.UDPMux
	closer io.Closer
}

// NewEngine builds the pion API with codecs, interceptors and network settings.
func NewEngine(o Options) (*Engine, error) {
	if o.Logger == nil {
		o.Logger = slog.Default()
	}
	if o.GatherTimeout == 0 {
		o.GatherTimeout = 3 * time.Second
	}
	m := &webrtc.MediaEngine{}
	if err := m.RegisterDefaultCodecs(); err != nil {
		return nil, fmt.Errorf("codecs: %w", err)
	}
	ir := &interceptor.Registry{}
	if err := webrtc.RegisterDefaultInterceptors(m, ir); err != nil {
		return nil, fmt.Errorf("interceptors: %w", err)
	}
	// Ask publishers for a keyframe every 3s as a safety net for late joiners
	// and lossy links; explicit PLIs are still forwarded immediately.
	pli, err := intervalpli.NewReceiverInterceptor(intervalpli.GeneratorInterval(3 * time.Second))
	if err != nil {
		return nil, err
	}
	ir.Add(pli)

	se := webrtc.SettingEngine{}
	se.SetIncludeLoopbackCandidate(true)
	if len(o.PublicIPs) > 0 {
		se.SetNAT1To1IPs(o.PublicIPs, webrtc.ICECandidateTypeHost)
	}
	e := &Engine{opts: o, log: o.Logger}
	if o.UDPPort > 0 {
		conn, err := net.ListenUDP("udp", &net.UDPAddr{Port: o.UDPPort})
		if err != nil {
			return nil, fmt.Errorf("udp mux listen :%d: %w", o.UDPPort, err)
		}
		mux := webrtc.NewICEUDPMux(nil, conn)
		se.SetICEUDPMux(mux)
		e.udpMux, e.closer = mux, conn
	} else if o.UDPPortMin > 0 {
		if err := se.SetEphemeralUDPPortRange(o.UDPPortMin, o.UDPPortMax); err != nil {
			return nil, err
		}
	}
	e.api = webrtc.NewAPI(webrtc.WithMediaEngine(m), webrtc.WithInterceptorRegistry(ir), webrtc.WithSettingEngine(se))
	return e, nil
}

// Close releases shared sockets.
func (e *Engine) Close() error {
	if e.udpMux != nil {
		_ = e.udpMux.Close()
	}
	if e.closer != nil {
		return e.closer.Close()
	}
	return nil
}

func (e *Engine) newPC() (*webrtc.PeerConnection, error) {
	ice := e.opts.ICEServers
	if e.opts.ICEProvider != nil {
		ice = e.opts.ICEProvider()
	}
	return e.api.NewPeerConnection(webrtc.Configuration{
		ICEServers:   ice,
		BundlePolicy: webrtc.BundlePolicyMaxBundle,
		SDPSemantics: webrtc.SDPSemanticsUnifiedPlan,
	})
}

// complete waits (bounded) for ICE gathering so the SDP carries candidates.
func (e *Engine) complete(ctx context.Context, pc *webrtc.PeerConnection) (*webrtc.SessionDescription, error) {
	done := webrtc.GatheringCompletePromise(pc)
	t := time.NewTimer(e.opts.GatherTimeout)
	defer t.Stop()
	select {
	case <-done:
	case <-t.C:
	case <-ctx.Done():
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return pc.LocalDescription(), nil
}

// WebSocket peers exchange candidates as they arrive, including slow TURN
// allocations. HTTP WHIP/WHEP clients retain the non-trickle SDP path.
func trickle(pc *webrtc.PeerConnection, callbacks []func(webrtc.ICECandidateInit)) {
	if len(callbacks) == 0 {
		return
	}
	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c != nil {
			callbacks[0](c.ToJSON())
		}
	})
}

func (e *Engine) description(ctx context.Context, pc *webrtc.PeerConnection, incremental bool) (*webrtc.SessionDescription, error) {
	if !incremental {
		return e.complete(ctx, pc)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return pc.LocalDescription(), nil
}

// Sink receives forwarded RTP. TrackLocalStaticRTP, pion media writers and
// UDP pipes all satisfy it.
type Sink interface {
	WriteRTP(*rtp.Packet) error
}

// Forwarder fans one incoming track out to many sinks.
type Forwarder struct {
	ID       string
	StreamID string
	Kind     webrtc.RTPCodecType
	Codec    webrtc.RTPCodecCapability
	PT       uint8

	remote *webrtc.TrackRemote
	pc     *webrtc.PeerConnection

	mu      sync.RWMutex
	sinks   map[uint64]Sink
	nextID  uint64
	packets atomic.Uint64
	bytes   atomic.Uint64
}

// AddSink registers a sink and returns a function that removes it.
func (f *Forwarder) AddSink(s Sink) (remove func()) {
	f.mu.Lock()
	f.nextID++
	id := f.nextID
	if f.sinks == nil {
		f.sinks = map[uint64]Sink{}
	}
	f.sinks[id] = s
	f.mu.Unlock()
	f.RequestKeyframe()
	return func() {
		f.mu.Lock()
		delete(f.sinks, id)
		f.mu.Unlock()
	}
}

// SinkCount returns the number of attached sinks.
func (f *Forwarder) SinkCount() int {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return len(f.sinks)
}

// RequestKeyframe sends a PLI upstream so new viewers get a picture fast.
func (f *Forwarder) RequestKeyframe() {
	if f.Kind != webrtc.RTPCodecTypeVideo || f.pc == nil || f.remote == nil {
		return
	}
	_ = f.pc.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: uint32(f.remote.SSRC())}})
}

// Stats returns forwarded packet and byte counters.
func (f *Forwarder) Stats() (packets, bytes uint64) { return f.packets.Load(), f.bytes.Load() }

func (f *Forwarder) run(log *slog.Logger) {
	buf := make([]byte, 1500)
	pkt := &rtp.Packet{}
	for {
		n, _, err := f.remote.Read(buf)
		if err != nil {
			if !errors.Is(err, io.EOF) {
				log.Debug("track read ended", "track", f.ID, "err", err)
			}
			return
		}
		if err := pkt.Unmarshal(buf[:n]); err != nil {
			continue
		}
		f.packets.Add(1)
		f.bytes.Add(uint64(n))
		f.mu.RLock()
		for _, s := range f.sinks {
			// Each sink rewrites SSRC/PT as needed; give each its own copy of
			// the header so they never race on shared state.
			cp := *pkt
			if err := s.WriteRTP(&cp); err != nil && !errors.Is(err, io.ErrClosedPipe) {
				log.Debug("sink write", "err", err)
			}
		}
		f.mu.RUnlock()
	}
}

// Stream is one published source (camera, screen, program, OBS WHIP push).
type Stream struct {
	ID    string
	Owner string // peer id, "whip" for WHIP pushes
	Kind  string // camera | screen | program | whip

	engine *Engine
	pc     *webrtc.PeerConnection

	mu         sync.RWMutex
	forwarders []*Forwarder
	expected   int
	ready      chan struct{}
	readyOnce  sync.Once
	closed     chan struct{}
	closeOnce  sync.Once
	onClose    []func()
	created    time.Time
}

// Publish accepts a publisher offer and returns the answer. expectedTracks is
// derived from the offer's m-lines so we know when the stream is complete.
func (e *Engine) Publish(ctx context.Context, id, owner, kind string, offer webrtc.SessionDescription, onICE ...func(webrtc.ICECandidateInit)) (*Stream, *webrtc.SessionDescription, error) {
	if offer.Type != webrtc.SDPTypeOffer {
		return nil, nil, errors.New("expected an SDP offer")
	}
	pc, err := e.newPC()
	if err != nil {
		return nil, nil, err
	}
	s := &Stream{ID: id, Owner: owner, Kind: kind, engine: e, pc: pc,
		ready: make(chan struct{}), closed: make(chan struct{}), created: time.Now(),
		expected: countMedia(offer.SDP)}
	trickle(pc, onICE)

	pc.OnTrack(func(tr *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		f := &Forwarder{
			ID: tr.ID(), StreamID: id, Kind: tr.Kind(), Codec: tr.Codec().RTPCodecCapability,
			PT: uint8(tr.PayloadType()), remote: tr, pc: pc,
		}
		s.mu.Lock()
		s.forwarders = append(s.forwarders, f)
		n := len(s.forwarders)
		s.mu.Unlock()
		e.log.Info("track up", "stream", id, "kind", tr.Kind().String(), "codec", tr.Codec().MimeType)
		if n >= s.expected {
			s.markReady()
		}
		go f.run(e.log)
	})
	pc.OnConnectionStateChange(func(st webrtc.PeerConnectionState) {
		switch st {
		case webrtc.PeerConnectionStateConnected:
			// Some publishers negotiate more m-lines than they send; don't
			// keep viewers waiting forever.
			go func() {
				select {
				case <-time.After(1500 * time.Millisecond):
					s.markReady()
				case <-s.closed:
				}
			}()
		case webrtc.PeerConnectionStateFailed, webrtc.PeerConnectionStateClosed:
			s.Close()
		}
	})
	if err := pc.SetRemoteDescription(offer); err != nil {
		_ = pc.Close()
		return nil, nil, fmt.Errorf("remote description: %w", err)
	}
	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		_ = pc.Close()
		return nil, nil, err
	}
	if err := pc.SetLocalDescription(answer); err != nil {
		_ = pc.Close()
		return nil, nil, err
	}
	desc, err := e.description(ctx, pc, len(onICE) > 0)
	if err != nil {
		s.Close()
		return nil, nil, err
	}
	return s, desc, nil
}

// countMedia counts audio/video sections the publisher will actually send.
func countMedia(sdp string) int {
	n := 0
	inMedia, sending := false, false
	flush := func() {
		if inMedia && sending {
			n++
		}
	}
	for _, l := range strings.Split(sdp, "\n") {
		l = strings.TrimSpace(l)
		switch {
		case strings.HasPrefix(l, "m="):
			flush()
			inMedia = strings.HasPrefix(l, "m=audio") || strings.HasPrefix(l, "m=video")
			// port 0 means the section was rejected/disabled
			f := strings.Fields(l)
			sending = inMedia && len(f) > 1 && f[1] != "0"
		case l == "a=recvonly" || l == "a=inactive":
			sending = false
		}
	}
	flush()
	if n == 0 {
		n = 1
	}
	return n
}

func (s *Stream) markReady() { s.readyOnce.Do(func() { close(s.ready) }) }

// Ready is closed once the stream's tracks are flowing.
func (s *Stream) Ready() <-chan struct{} { return s.ready }

// Done is closed when the stream ends.
func (s *Stream) Done() <-chan struct{} { return s.closed }

// PC exposes the publisher connection for authenticated trickle ICE signalling.
func (s *Stream) PC() *webrtc.PeerConnection { return s.pc }

// Forwarders returns a snapshot of the stream's tracks.
func (s *Stream) Forwarders() []*Forwarder {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]*Forwarder(nil), s.forwarders...)
}

// OnClose registers a callback run once when the stream ends.
func (s *Stream) OnClose(fn func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	select {
	case <-s.closed:
		go fn()
	default:
		s.onClose = append(s.onClose, fn)
	}
}

// Close tears the publisher down and notifies listeners.
func (s *Stream) Close() {
	s.closeOnce.Do(func() {
		close(s.closed)
		_ = s.pc.Close()
		s.mu.Lock()
		cbs := s.onClose
		s.onClose = nil
		s.mu.Unlock()
		for _, fn := range cbs {
			fn()
		}
	})
}

// Info is a JSON friendly description of a stream.
type Info struct {
	ID      string   `json:"id"`
	Owner   string   `json:"owner"`
	Kind    string   `json:"kind"`
	Tracks  []string `json:"tracks"`
	Viewers int      `json:"viewers"`
	Since   int64    `json:"since"`
}

// Info describes the stream.
func (s *Stream) Info() Info {
	inf := Info{ID: s.ID, Owner: s.Owner, Kind: s.Kind, Since: s.created.Unix()}
	for _, f := range s.Forwarders() {
		inf.Tracks = append(inf.Tracks, f.Kind.String()+":"+f.Codec.MimeType)
		if c := f.SinkCount(); c > inf.Viewers {
			inf.Viewers = c
		}
	}
	return inf
}

// Subscriber is a send-only peer connection receiving one stream.
type Subscriber struct {
	pc      *webrtc.PeerConnection
	removes []func()
	once    sync.Once
	done    chan struct{}
}

// Close detaches the subscriber.
func (sub *Subscriber) Close() {
	sub.once.Do(func() {
		for _, r := range sub.removes {
			r()
		}
		_ = sub.pc.Close()
		close(sub.done)
	})
}

// Done is closed when the subscriber goes away.
func (sub *Subscriber) Done() <-chan struct{} { return sub.done }

// PC exposes the underlying peer connection (for answer handling).
func (sub *Subscriber) PC() *webrtc.PeerConnection { return sub.pc }

func (e *Engine) attach(s *Stream, pc *webrtc.PeerConnection) (*Subscriber, error) {
	sub := &Subscriber{pc: pc, done: make(chan struct{})}
	for _, f := range s.Forwarders() {
		local, err := webrtc.NewTrackLocalStaticRTP(f.Codec, f.ID, s.ID)
		if err != nil {
			return nil, err
		}
		sender, err := pc.AddTrack(local)
		if err != nil {
			return nil, err
		}
		ff := f
		go func() {
			buf := make([]byte, 1500)
			for {
				n, _, err := sender.Read(buf)
				if err != nil {
					return
				}
				pkts, err := rtcp.Unmarshal(buf[:n])
				if err != nil {
					continue
				}
				for _, p := range pkts {
					switch p.(type) {
					case *rtcp.PictureLossIndication, *rtcp.FullIntraRequest:
						ff.RequestKeyframe()
					}
				}
			}
		}()
		sub.removes = append(sub.removes, f.AddSink(local))
	}
	pc.OnConnectionStateChange(func(st webrtc.PeerConnectionState) {
		if st == webrtc.PeerConnectionStateFailed || st == webrtc.PeerConnectionStateClosed {
			sub.Close()
		}
	})
	s.OnClose(sub.Close)
	return sub, nil
}

// SubscribeOffer creates a server-initiated subscription (used over the
// WebSocket signalling): the server sends an offer, the client answers.
func (e *Engine) SubscribeOffer(ctx context.Context, s *Stream, onICE ...func(webrtc.ICECandidateInit)) (*Subscriber, *webrtc.SessionDescription, error) {
	if err := waitReady(ctx, s); err != nil {
		return nil, nil, err
	}
	pc, err := e.newPC()
	if err != nil {
		return nil, nil, err
	}
	sub, err := e.attach(s, pc)
	if err != nil {
		_ = pc.Close()
		return nil, nil, err
	}
	trickle(pc, onICE)
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		sub.Close()
		return nil, nil, err
	}
	if err := pc.SetLocalDescription(offer); err != nil {
		sub.Close()
		return nil, nil, err
	}
	desc, err := e.description(ctx, pc, len(onICE) > 0)
	if err != nil {
		sub.Close()
		return nil, nil, err
	}
	return sub, desc, nil
}

// SubscribeAnswer handles client-initiated subscriptions (WHEP): the client
// sends a recvonly offer and receives an answer.
func (e *Engine) SubscribeAnswer(ctx context.Context, s *Stream, offer webrtc.SessionDescription) (*Subscriber, *webrtc.SessionDescription, error) {
	if err := waitReady(ctx, s); err != nil {
		return nil, nil, err
	}
	pc, err := e.newPC()
	if err != nil {
		return nil, nil, err
	}
	if err := pc.SetRemoteDescription(offer); err != nil {
		_ = pc.Close()
		return nil, nil, fmt.Errorf("remote description: %w", err)
	}
	sub, err := e.attach(s, pc)
	if err != nil {
		_ = pc.Close()
		return nil, nil, err
	}
	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		sub.Close()
		return nil, nil, err
	}
	if err := pc.SetLocalDescription(answer); err != nil {
		sub.Close()
		return nil, nil, err
	}
	desc, err := e.complete(ctx, pc)
	if err != nil {
		sub.Close()
		return nil, nil, err
	}
	return sub, desc, nil
}

func waitReady(ctx context.Context, s *Stream) error {
	select {
	case <-s.Ready():
		return nil
	case <-s.Done():
		return errors.New("stream ended")
	case <-ctx.Done():
		return fmt.Errorf("stream %q not ready: %w", s.ID, ctx.Err())
	}
}
