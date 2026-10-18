//go:build ignore

// Disposable, loopback-only TURN/TCP fixture. Never expose this test server.
package main

import (
	"github.com/pion/turn/v5"
	"log"
	"net"
	"os"
	"os/signal"
)

func main() {
	listener, err := net.Listen("tcp4", "127.0.0.1:13478")
	if err != nil {
		log.Fatal(err)
	}
	server, err := turn.NewServer(turn.ServerConfig{
		Realm: "swr-test",
		AuthHandler: func(r *turn.RequestAttributes) (string, []byte, bool) {
			return r.Username, turn.GenerateAuthKey("swr-test", "swr-test", "test-only"), r.Username == "swr-test"
		},
		ListenerConfigs: []turn.ListenerConfig{{Listener: listener, RelayAddressGenerator: &turn.RelayAddressGeneratorStatic{RelayAddress: net.ParseIP("127.0.0.1"), Address: "127.0.0.1"}}},
	})
	if err != nil {
		log.Fatal(err)
	}
	defer server.Close()
	log.Print("Loopback TURN/TCP fixture ready")
	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt)
	<-done
}
