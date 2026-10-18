package turnrelay

import (
	"github.com/pion/turn/v5"
	"net"
	"strings"
	"testing"
)

func TestRelayRestrictsDestinationAndAllocationRange(t *testing.T) {
	g := &generator{opts: Options{SFUPort: 50000, PeerIPs: []net.IP{net.ParseIP("127.0.0.1")}, MinPort: 25160, MaxPort: 25161}, public: net.ParseIP("127.0.0.1"), bind: "127.0.0.1"}
	if !g.allowed(&net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 50000}) {
		t.Fatal("SFU rejected")
	}
	for _, addr := range []*net.UDPAddr{{IP: net.ParseIP("127.0.0.1"), Port: 53}, {IP: net.ParseIP("192.168.1.1"), Port: 50000}, {IP: net.ParseIP("8.8.8.8"), Port: 50000}} {
		if g.allowed(addr) {
			t.Fatal("arbitrary relay destination accepted")
		}
	}
	if _, _, e := g.AllocatePacketConn(turn.AllocateListenerConfig{Network: "udp4", RequestedPort: 12345}); e == nil {
		t.Fatal("requested port bypassed the range")
	}
	if _, _, e := g.AllocateListener(turn.AllocateListenerConfig{}); e == nil {
		t.Fatal("arbitrary TCP relaying enabled")
	}
	a, _, e := g.AllocatePacketConn(turn.AllocateListenerConfig{Network: "udp4"})
	if e != nil {
		t.Fatal(e)
	}
	defer a.Close()
	b, _, e := g.AllocatePacketConn(turn.AllocateListenerConfig{Network: "udp4"})
	if e != nil {
		t.Fatal(e)
	}
	defer b.Close()
	if _, _, e := g.AllocatePacketConn(turn.AllocateListenerConfig{Network: "udp4"}); e == nil {
		t.Fatal("allocation limit bypassed")
	}
	if _, e := a.WriteTo([]byte("blocked"), &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 53}); e == nil {
		t.Fatal("packet bypassed destination filter")
	}
}

func TestRelayValidation(t *testing.T) {
	o := Options{Listen: "127.0.0.1:0", PublicIP: "127.0.0.1", Secret: strings.Repeat("x", 32), MinPort: 25160, MaxPort: 25161, SFUPort: 50000}
	o.Secret = "short"
	if _, err := Start(o); err == nil {
		t.Fatal("weak secret accepted")
	}
	o.Secret = strings.Repeat("x", 32)
	o.MaxPort = 65535
	if _, err := Start(o); err == nil {
		t.Fatal("overflowing port bound accepted")
	}
}
