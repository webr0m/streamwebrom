// Package turnrelay hosts an authenticated native TURN fallback for this SFU.
package turnrelay

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/pion/turn/v5"
	"github.com/pion/webrtc/v4"
)

type Options struct {
	Listen           string
	URLs             []string // optional externally terminated TURN/TLS proxy
	TCPAlternate     string
	PublicIP         string
	Secret           string
	MinPort, MaxPort int
	SFUPort          int
	PeerIPs          []net.IP
}

type Server struct {
	server *turn.Server
	opts   Options
	urls   []string
}

func Start(o Options) (*Server, error) {
	public := net.ParseIP(o.PublicIP)
	if public == nil || public.To4() == nil {
		return nil, errors.New("relay-public-ip must be IPv4")
	}
	if len(o.Secret) < 32 {
		return nil, errors.New("relay-secret must contain at least 32 bytes")
	}
	if o.MinPort < 1024 || o.MaxPort > 65534 || o.MaxPort < o.MinPort || o.MaxPort-o.MinPort > 1023 {
		return nil, errors.New("invalid relay port range (maximum 1024 ports)")
	}
	if o.SFUPort < 1 || o.SFUPort > 65535 {
		return nil, errors.New("local TURN requires a fixed udp-port for the SFU")
	}
	host, port, err := net.SplitHostPort(o.Listen)
	if err != nil {
		return nil, errors.New("invalid relay listen address")
	}
	listenPort, e := strconv.Atoi(port)
	if e != nil || listenPort < 1 || listenPort > 65535 {
		return nil, errors.New("relay listener requires a numeric port between 1 and 65535")
	}
	gen := &generator{opts: o, public: public, bind: host}
	udp, err := net.ListenPacket("udp4", o.Listen)
	if err != nil {
		return nil, err
	}
	tcp, err := net.Listen("tcp4", o.Listen)
	if err != nil {
		udp.Close()
		return nil, err
	}
	listeners := []turn.ListenerConfig{{Listener: tcp, RelayAddressGenerator: gen, PermissionHandler: gen.allowIP}}
	urls := []string{"turn:" + net.JoinHostPort(o.PublicIP, port) + "?transport=udp", "turn:" + net.JoinHostPort(o.PublicIP, port) + "?transport=tcp"}
	if o.TCPAlternate != "" {
		_, alternatePort, e := net.SplitHostPort(o.TCPAlternate)
		number, parseErr := strconv.Atoi(alternatePort)
		if e != nil || parseErr != nil || number < 1 || number > 65535 {
			udp.Close()
			tcp.Close()
			return nil, errors.New("invalid alternate TURN TCP address")
		}
		alt, e := net.Listen("tcp4", o.TCPAlternate)
		if e != nil {
			udp.Close()
			tcp.Close()
			return nil, e
		}
		listeners = append(listeners, turn.ListenerConfig{Listener: alt, RelayAddressGenerator: gen, PermissionHandler: gen.allowIP})
		_, altPort, _ := net.SplitHostPort(o.TCPAlternate)
		urls = append(urls, "turn:"+net.JoinHostPort(o.PublicIP, altPort)+"?transport=tcp")
	}
	if len(o.URLs) > 0 {
		urls = append([]string(nil), o.URLs...)
	}
	server, err := turn.NewServer(turn.ServerConfig{
		Realm: "streamwebrom", AuthHandler: turn.NewLongTermAuthHandler(o.Secret, nil),
		PacketConnConfigs: []turn.PacketConnConfig{{PacketConn: udp, RelayAddressGenerator: gen, PermissionHandler: gen.allowIP}},
		ListenerConfigs:   listeners,
	})
	if err != nil {
		udp.Close()
		for _, l := range listeners {
			l.Listener.Close()
		}
		return nil, err
	}
	return &Server{server: server, opts: o, urls: urls}, nil
}

func (s *Server) Close() error { return s.server.Close() }
func (s *Server) ICE() []webrtc.ICEServer {
	user, pass, _ := turn.GenerateLongTermCredentials(s.opts.Secret, 24*time.Hour)
	return []webrtc.ICEServer{{URLs: append([]string(nil), s.urls...), Username: user, Credential: pass}}
}

// Relay only to this installation's SFU UDP socket, never to arbitrary Internet
// or LAN services. The port range also puts a hard bound on active allocations.
type generator struct {
	opts   Options
	public net.IP
	bind   string
	next   atomic.Uint32
}

func (g *generator) Validate() error { return nil }
func (g *generator) allowIP(_ net.Addr, ip net.IP) bool {
	for _, peer := range g.opts.PeerIPs {
		if peer.Equal(ip) {
			return true
		}
	}
	return false
}
func (g *generator) allowed(addr net.Addr) bool {
	peer, ok := addr.(*net.UDPAddr)
	return ok && peer.Port == g.opts.SFUPort && g.allowIP(nil, peer.IP)
}
func (g *generator) AllocatePacketConn(conf turn.AllocateListenerConfig) (net.PacketConn, net.Addr, error) {
	if conf.RequestedPort != 0 || (conf.Network != "udp4" && conf.Network != "udp") {
		return nil, nil, errors.New("unsupported relay allocation")
	}
	count := g.opts.MaxPort - g.opts.MinPort + 1
	for i := 0; i < count; i++ {
		port := g.opts.MinPort + int(g.next.Add(1)-1)%count
		conn, err := net.ListenPacket("udp4", net.JoinHostPort(g.bind, strconv.Itoa(port)))
		if err != nil {
			continue
		}
		return &restrictedPacketConn{PacketConn: conn, g: g}, &net.UDPAddr{IP: g.public, Port: port}, nil
	}
	return nil, nil, errors.New("local TURN allocation capacity reached")
}
func (g *generator) AllocateListener(turn.AllocateListenerConfig) (net.Listener, net.Addr, error) {
	return nil, nil, errors.New("TCP peer relaying is disabled")
}
func (g *generator) AllocateConn(turn.AllocateConnConfig) (net.Conn, error) {
	return nil, errors.New("TCP peer relaying is disabled")
}

type restrictedPacketConn struct {
	net.PacketConn
	g *generator
}

func (c *restrictedPacketConn) WriteTo(p []byte, addr net.Addr) (int, error) {
	if !c.g.allowed(addr) {
		return 0, fmt.Errorf("relay destination is not the SFU")
	}
	return c.PacketConn.WriteTo(p, addr)
}
func (c *restrictedPacketConn) ReadFrom(p []byte) (int, net.Addr, error) {
	for {
		n, addr, err := c.PacketConn.ReadFrom(p)
		if err != nil || c.g.allowed(addr) {
			return n, addr, err
		}
	}
}
