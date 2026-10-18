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

	ice := []webrtc.ICEServer{}
	if len(cfg.STUN) > 0 {
		ice = append(ice, webrtc.ICEServer{URLs: cfg.STUN})
	}
	if len(cfg.TURN) > 0 {
		ice = append(ice, webrtc.ICEServer{URLs: cfg.TURN, Username: cfg.TURNUser, Credential: cfg.TURNPass})
	}
	engine, err := sfu.NewEngine(sfu.Options{ICEServers: ice, PublicIPs: cfg.PublicIPs, UDPPort: cfg.UDPPort,
		UDPPortMin: uint16(cfg.UDPPortMin), UDPPortMax: uint16(cfg.UDPPortMax), Logger: log})
	if err != nil {
		return err
	}
	defer engine.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	hub := studio.NewHub(ctx, studio.Options{
		Engine: engine, Recorder: record.New(cfg.DataDir, cfg.FFmpeg), FFmpeg: cfg.FFmpeg, ICE: ice,
		MaxRooms: cfg.MaxRooms, MaxPeers: cfg.MaxPeers, MaxMsgBytes: cfg.MaxMsgBytes,
		MsgRate: cfg.MsgRate, MsgBurst: cfg.MsgBurst, RoomTTL: cfg.IdleRoomTTL, RejoinGrace: 30 * time.Second,
		CheckOrigin: server.CheckOrigin(cfg), Logger: log,
	})

	static, err := fs.Sub(web.Files, ".")
	if err != nil {
		return err
	}
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           server.New(cfg, hub, static, log).Handler(),
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
