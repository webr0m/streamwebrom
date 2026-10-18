// Command streamwebrom runs the whole studio - web app, signalling, SFU,
// WHIP/WHEP, recording and RTMP multistreaming - from one static binary.
package main

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/pion/webrtc/v4"
	"golang.org/x/crypto/acme/autocert"

	"github.com/webr0m/streamwebrom/internal/config"
	"github.com/webr0m/streamwebrom/internal/record"
	"github.com/webr0m/streamwebrom/internal/server"
	"github.com/webr0m/streamwebrom/internal/sfu"
	"github.com/webr0m/streamwebrom/internal/studio"
	"github.com/webr0m/streamwebrom/internal/tlsutil"
	"github.com/webr0m/streamwebrom/internal/turnrelay"
	"github.com/webr0m/streamwebrom/web"
)

// version is set with -ldflags "-X main.version=v1.2.3".
var version = "dev"

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "streamwebrom:", err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) > 1 && (os.Args[1] == "version" || os.Args[1] == "-version" || os.Args[1] == "--version") {
		fmt.Println("streamwebrom", version, runtime.GOOS+"/"+runtime.GOARCH)
		return nil
	}
	cfg, err := config.Load(os.Args[1:], os.Getenv)
	if err != nil {
		return err
	}
	cfg.Version = version
	var h slog.Handler = slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})
	if cfg.LogJSON {
		h = slog.NewJSONHandler(os.Stderr, nil)
	}
	log := slog.New(h)
	slog.SetDefault(log)

	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	ice := []webrtc.ICEServer{}
	if len(cfg.STUN) > 0 {
		ice = append(ice, webrtc.ICEServer{URLs: cfg.STUN})
	}
	if len(cfg.TURN) > 0 {
		ice = append(ice, webrtc.ICEServer{URLs: cfg.TURN, Username: cfg.TURNUser, Credential: cfg.TURNPass})
	}
	var localRelay *turnrelay.Server
	if cfg.RelayListen != "" {
		peers := []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP(cfg.RelayPublicIP)}
		if addrs, e := net.InterfaceAddrs(); e == nil {
			for _, addr := range addrs {
				if ip, _, e := net.ParseCIDR(addr.String()); e == nil && ip.To4() != nil {
					peers = append(peers, ip)
				}
			}
		}
		localRelay, err = turnrelay.Start(turnrelay.Options{Listen: cfg.RelayListen, URLs: cfg.RelayURLs, TCPAlternate: cfg.RelayTCPAlternate, PublicIP: cfg.RelayPublicIP, Secret: cfg.RelaySecret, MinPort: cfg.RelayMin, MaxPort: cfg.RelayMax, SFUPort: cfg.UDPPort, PeerIPs: peers})
		if err != nil {
			return fmt.Errorf("local TURN: %w", err)
		}
		defer localRelay.Close()
		log.Info("local TURN ready", "listen", cfg.RelayListen, "relay_min", cfg.RelayMin, "relay_max", cfg.RelayMax)
	}
	var cloudRelay *turnrelay.Cloudflare
	if cfg.CFAccount != "" {
		cloudRelay, err = turnrelay.NewCloudflare(turnrelay.CloudflareOptions{AccountID: cfg.CFAccount, KeyID: cfg.CFKeyID, KeyToken: cfg.CFKeyToken, AnalyticsToken: cfg.CFAnalyticsToken, BudgetBytes: cfg.CFBudget, StateFile: filepath.Join(cfg.DataDir, "turn-quota.json")})
		if err != nil {
			return err
		}
		cloudRelay.Check(ctx, time.Now().UTC())
		log.Info("TURN provider", "provider", cloudRelay.Status().Provider, "reason", cloudRelay.Status().Reason)
	}
	serverICE := func() webrtc.Configuration {
		out := append([]webrtc.ICEServer(nil), ice...)
		policy := webrtc.ICETransportPolicyAll
		if cloudRelay != nil {
			cloud := cloudRelay.ICE()
			out = append(out, cloud...)
			// This installation can be behind NAT without usable port forwarding.
			// A Cloudflare relay on the SFU side guarantees a public media route;
			// early private host candidates must not race late relay candidates.
			if len(cloud) > 0 {
				policy = webrtc.ICETransportPolicyRelay
			}
		}
		return webrtc.Configuration{ICEServers: out, ICETransportPolicy: policy}
	}
	clientICE := func() []webrtc.ICEServer {
		out := append([]webrtc.ICEServer(nil), ice...)
		var cloud []webrtc.ICEServer
		if cloudRelay != nil {
			cloud = cloudRelay.ICE()
			out = append(out, cloud...)
		}
		if localRelay != nil && len(cloud) == 0 {
			out = append(out, localRelay.ICE()...)
		}
		return out
	}
	var recordTraffic func(int)
	var localICE func() []webrtc.ICEServer
	var localServerICE func() webrtc.Configuration
	if localRelay != nil {
		localICE = localRelay.ICE
		// The authenticated local relay reaches this SFU directly. Do not force
		// a Cloudflare allocation on the server side of this alternative route.
		localServerICE = func() webrtc.Configuration { return webrtc.Configuration{} }
	}
	if cloudRelay != nil {
		recordTraffic = cloudRelay.RecordMedia
	}
	engine, err := sfu.NewEngine(sfu.Options{RecordTraffic: recordTraffic, ICEServers: ice, ICEConfiguration: serverICE, LocalICEConfiguration: localServerICE, PublicIPs: cfg.PublicIPs, UDPPort: cfg.UDPPort,
		UDPPortMin: uint16(cfg.UDPPortMin), UDPPortMax: uint16(cfg.UDPPortMax), Logger: log})
	if err != nil {
		return err
	}
	defer engine.Close()

	hub := studio.NewHub(ctx, studio.Options{
		Engine: engine, Recorder: record.New(cfg.DataDir, cfg.FFmpeg), FFmpeg: cfg.FFmpeg, ICE: ice, ICEProvider: clientICE, LocalICEProvider: localICE,
		MaxRooms: cfg.MaxRooms, MaxPeers: cfg.MaxPeers, MaxMsgBytes: cfg.MaxMsgBytes,
		MsgRate: cfg.MsgRate, MsgBurst: cfg.MsgBurst, RoomTTL: cfg.IdleRoomTTL, RejoinGrace: 30 * time.Second,
		CheckOrigin: server.CheckOrigin(cfg), Logger: log,
	})

	static, err := fs.Sub(web.Files, ".")
	if err != nil {
		return err
	}
	front := server.New(cfg, hub, static, log, clientICE)
	front.LocalICEProvider = localICE
	if cloudRelay != nil {
		front.RelayStatus = func() map[string]string {
			st := cloudRelay.Status()
			return map[string]string{"provider": st.Provider, "reason": st.Reason}
		}
		go cloudRelay.Run(ctx, func() {
			log.Info("TURN route changed", "provider", cloudRelay.Status().Provider, "reason", cloudRelay.Status().Reason)
			hub.RefreshRoutes()
			front.RefreshRoutes()
		})
	} else if localRelay != nil {
		front.RelayStatus = func() map[string]string { return map[string]string{"provider": "local", "reason": "configured"} }
	}
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           front.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    64 << 10,
	}

	ln, err := net.Listen("tcp", cfg.Addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", cfg.Addr, err)
	}
	scheme := "http"
	switch {
	case cfg.AutocertDomain != "":
		m := &autocert.Manager{Prompt: autocert.AcceptTOS, HostPolicy: autocert.HostWhitelist(cfg.AutocertDomain),
			Cache: autocert.DirCache(filepath.Join(cfg.DataDir, "acme"))}
		srv.TLSConfig = m.TLSConfig()
		go func() { _ = http.ListenAndServe(":80", m.HTTPHandler(nil)) }()
		scheme = "https"
	case cfg.SelfSigned:
		cert, err := tlsutil.SelfSigned(filepath.Join(cfg.DataDir, "certs"))
		if err != nil {
			return err
		}
		srv.TLSConfig = &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}
		scheme = "https"
	case cfg.TLSCert != "":
		cert, err := tls.LoadX509KeyPair(cfg.TLSCert, cfg.TLSKey)
		if err != nil {
			return err
		}
		srv.TLSConfig = &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}
		scheme = "https"
	}
	if srv.TLSConfig != nil {
		ln = tls.NewListener(ln, srv.TLSConfig)
	}
	_, port, _ := net.SplitHostPort(ln.Addr().String())
	local := scheme + "://localhost:" + port
	log.Info("StreamWebRom ready", "version", version, "studio", local, "lan", tlsutil.LANURL(scheme, port))
	if scheme == "http" {
		log.Warn("serving plain HTTP: cameras only work on localhost. Use -self-signed for other devices on your network.")
	}
	if cfg.OpenBrowser {
		openBrowser(local)
	}

	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()
	select {
	case <-ctx.Done():
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	}
	log.Info("shutting down")
	sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return srv.Shutdown(sctx)
}

func openBrowser(u string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", u)
	case "darwin":
		cmd = exec.Command("open", u)
	default:
		cmd = exec.Command("xdg-open", u)
	}
	_ = cmd.Start()
}
