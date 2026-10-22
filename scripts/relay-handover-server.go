//go:build ignore

// Loopback-only browser fixture. Both labelled providers use independent local
// TURN/TCP listeners; this does not exercise Cloudflare's external service.
package main

import (
	"context"
	"log"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/pion/turn/v5"
	"github.com/pion/webrtc/v4"
	"github.com/webr0m/streamwebrom/internal/config"
	"github.com/webr0m/streamwebrom/internal/server"
	"github.com/webr0m/streamwebrom/internal/sfu"
	"github.com/webr0m/streamwebrom/internal/studio"
	"github.com/webr0m/streamwebrom/web"
	"golang.org/x/crypto/bcrypt"
)

func relay(address string) *turn.Server {
	l, err := net.Listen("tcp4", address)
	if err != nil {
		log.Fatal(err)
	}
	s, err := turn.NewServer(turn.ServerConfig{
		Realm: "swr-handover",
		AuthHandler: func(r *turn.RequestAttributes) (string, []byte, bool) {
			return r.Username, turn.GenerateAuthKey("swr-test", "swr-handover", "test-only"), r.Username == "swr-test"
		},
		ListenerConfigs: []turn.ListenerConfig{{Listener: l, RelayAddressGenerator: &turn.RelayAddressGeneratorStatic{RelayAddress: net.ParseIP("127.0.0.1"), Address: "127.0.0.1"}}},
	})
	if err != nil {
		log.Fatal(err)
	}
	return s
}

func main() {
	a, b := relay("127.0.0.1:13480"), relay("127.0.0.1:13481")
	defer a.Close()
	defer b.Close()
	local := []webrtc.ICEServer{{URLs: []string{"turn:127.0.0.1:13480?transport=tcp"}, Username: "swr-test", Credential: "test-only"}}
	cloud := []webrtc.ICEServer{{URLs: []string{"turn:127.0.0.1:13481?transport=tcp"}, Username: "swr-test", Credential: "test-only"}}
	engine, err := sfu.NewEngine(sfu.Options{
		ICEConfiguration: func() webrtc.Configuration {
			return webrtc.Configuration{ICEServers: cloud, ICETransportPolicy: webrtc.ICETransportPolicyRelay}
		},
		LocalICEConfiguration: func() webrtc.Configuration {
			return webrtc.Configuration{ICEServers: local, ICETransportPolicy: webrtc.ICETransportPolicyRelay}
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	defer engine.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cfg := config.Default()
	cfg.STUN = nil
	hash, _ := bcrypt.GenerateFromPassword([]byte("fixture-master-only"), bcrypt.MinCost)
	hub := studio.NewHub(ctx, studio.Options{Engine: engine, LocalICEProvider: func() []webrtc.ICEServer { return local }, CloudflareICEProvider: func() []webrtc.ICEServer { return cloud }, CloudflareMasterHash: string(hash), MaxRooms: 20, MaxPeers: 8, MaxMsgBytes: 1 << 20, MsgRate: 100, MsgBurst: 100, RoomTTL: time.Minute, RejoinGrace: 30 * time.Second, CheckOrigin: server.CheckOrigin(cfg)})
	front := server.New(cfg, hub, web.Files, slog.Default(), func() []webrtc.ICEServer { return local })
	front.LocalICEProvider = func() []webrtc.ICEServer { return local }
	log.Fatal(http.ListenAndServe("127.0.0.1:18446", front.Handler()))
}
