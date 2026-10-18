// Package config loads StreamWebRom settings from flags and environment variables.
//
// Every flag has an environment variable equivalent (SWR_<FLAG_IN_UPPER_SNAKE>),
// so the same binary works on a desktop, in Docker or under systemd.
package config

import (
	"errors"
	"flag"
	"fmt"
	"math"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds every runtime setting.
type Config struct {
	Addr               string   // HTTP(S) listen address
	PublicURL          string   // URL advertised in OBS links (optional)
	TLSCert            string   // PEM certificate path
	TLSKey             string   // PEM key path
	SelfSigned         bool     // generate a self-signed cert for LAN use
	AutocertDomain     string   // Let's Encrypt domain (requires :443)
	DataDir            string   // recordings, certs
	STUN               []string // STUN URLs handed to clients and server
	TURN               []string // TURN URLs (turn:host:port)
	TURNUser           string   // TURN username
	TURNPass           string   // TURN credential
	RelayListen        string   // optional native local TURN listener
	RelayTCPAlternate  string
	RelayPublicIP      string
	RelaySecret        string
	RelayURLs          []string
	RelayMin, RelayMax int
	CFAccount          string
	CFKeyID            string
	CFKeyToken         string
	CFAnalyticsToken   string
	CFBudget           uint64
	PublicIPs          []string      // NAT 1:1 public IPs for the SFU
	UDPPort            int           // single UDP port for all media (0 = ephemeral range)
	UDPPortMin         int           // ephemeral range min
	UDPPortMax         int           // ephemeral range max
	FFmpeg             string        // ffmpeg binary for restreaming
	AdminToken         string        // protects /api/admin/*
	AllowedOrigins     []string      // WebSocket origins allowed ("*" = any)
	MaxRooms           int           // hard cap on concurrent rooms
	MaxPeers           int           // per room
	MaxMsgBytes        int64         // max signalling message size
	MsgRate            float64       // signalling messages per second per peer
	MsgBurst           int           // burst for MsgRate
	IdleRoomTTL        time.Duration // empty rooms are reaped after this long
	OpenBrowser        bool          // open the studio in the default browser at start
	LogJSON            bool          // structured JSON logs
	Version            string
}

// Default returns a configuration that is safe to run on a desktop.
func Default() Config {
	return Config{
		Addr:        ":8443",
		DataDir:     "streamwebrom-data",
		STUN:        []string{"stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"},
		UDPPortMin:  0,
		UDPPortMax:  0,
		FFmpeg:      "ffmpeg",
		MaxRooms:    500,
		MaxPeers:    64,
		MaxMsgBytes: 256 << 10,
		MsgRate:     30,
		MsgBurst:    60,
		IdleRoomTTL: 10 * time.Minute,
	}
}

// Load parses args (without program name) and the environment.
func Load(args []string, getenv func(string) string) (Config, error) {
	c := Default()
	fs := flag.NewFlagSet("streamwebrom", flag.ContinueOnError)
	var stun, turn, pubIPs, origins, relayURLs string
	fs.StringVar(&c.Addr, "addr", c.Addr, "listen address")
	fs.StringVar(&c.PublicURL, "public-url", "", "public base URL used in generated links, e.g. https://live.example.com")
	fs.StringVar(&c.TLSCert, "tls-cert", "", "TLS certificate (PEM)")
	fs.StringVar(&c.TLSKey, "tls-key", "", "TLS private key (PEM)")
	fs.BoolVar(&c.SelfSigned, "self-signed", false, "serve HTTPS with an auto-generated self-signed certificate (LAN)")
	fs.StringVar(&c.AutocertDomain, "autocert", "", "obtain a Let's Encrypt certificate for this domain")
	fs.StringVar(&c.DataDir, "data", c.DataDir, "data directory (recordings, certificates)")
	fs.StringVar(&stun, "stun", strings.Join(c.STUN, ","), "comma separated STUN URLs")
	fs.StringVar(&turn, "turn", "", "comma separated TURN URLs")
	fs.StringVar(&c.TURNUser, "turn-user", "", "TURN username")
	fs.StringVar(&c.TURNPass, "turn-pass", "", "TURN password")
	fs.StringVar(&c.RelayListen, "relay-listen", "", "native local TURN listen address (empty disables it)")
	fs.StringVar(&c.RelayTCPAlternate, "relay-tcp-alternate", "", "optional additional local TURN TCP listener")
	fs.StringVar(&c.RelayPublicIP, "relay-public-ip", "", "public IPv4 announced by the local TURN server")
	fs.StringVar(&c.RelaySecret, "relay-secret", "", "local TURN shared secret (use SWR_RELAY_SECRET)")
	fs.IntVar(&c.RelayMin, "relay-min", 49160, "first local TURN relay UDP port")
	fs.IntVar(&c.RelayMax, "relay-max", 49223, "last local TURN relay UDP port")
	fs.StringVar(&relayURLs, "relay-urls", "", "optional advertised TURN URLs for an external TCP/TLS proxy")
	fs.StringVar(&c.CFAccount, "cf-account", "", "Cloudflare account ID for guarded TURN")
	fs.StringVar(&c.CFKeyID, "cf-turn-key-id", "", "Cloudflare TURN key ID")
	fs.StringVar(&c.CFKeyToken, "cf-turn-key-token", "", "Cloudflare TURN API token (use SWR_CF_TURN_KEY_TOKEN)")
	fs.StringVar(&c.CFAnalyticsToken, "cf-analytics-token", "", "Cloudflare Account Analytics Read token (use SWR_CF_ANALYTICS_TOKEN)")
	fs.Uint64Var(&c.CFBudget, "cf-turn-budget", 900000000000, "preventive monthly account TURN cutoff in bytes (not a billing cap)")
	fs.StringVar(&pubIPs, "public-ip", "", "comma separated public IPs announced by the SFU (NAT 1:1)")
	fs.IntVar(&c.UDPPort, "udp-port", 0, "single UDP port for all WebRTC media (recommended behind firewalls/Docker)")
	fs.IntVar(&c.UDPPortMin, "udp-min", 0, "minimum ephemeral UDP port")
	fs.IntVar(&c.UDPPortMax, "udp-max", 0, "maximum ephemeral UDP port")
	fs.StringVar(&c.FFmpeg, "ffmpeg", c.FFmpeg, "ffmpeg binary used for RTMP multistreaming")
	fs.StringVar(&c.AdminToken, "admin-token", "", "token for /api/admin endpoints (empty disables them)")
	fs.StringVar(&origins, "origins", "", "comma separated allowed WebSocket origins; empty = same host only; * = any")
	fs.IntVar(&c.MaxRooms, "max-rooms", c.MaxRooms, "maximum concurrent rooms")
	fs.IntVar(&c.MaxPeers, "max-peers", c.MaxPeers, "maximum peers per room")
	fs.Int64Var(&c.MaxMsgBytes, "max-msg", c.MaxMsgBytes, "maximum signalling message size in bytes")
	fs.Float64Var(&c.MsgRate, "msg-rate", c.MsgRate, "signalling messages per second per peer")
	fs.IntVar(&c.MsgBurst, "msg-burst", c.MsgBurst, "signalling burst size")
	fs.DurationVar(&c.IdleRoomTTL, "room-ttl", c.IdleRoomTTL, "how long an empty room is kept")
	fs.BoolVar(&c.OpenBrowser, "open", false, "open the studio in the default browser")
	fs.BoolVar(&c.LogJSON, "log-json", false, "JSON logs")

	// Environment first, flags override.
	var envErrs []error
	fs.VisitAll(func(f *flag.Flag) {
		key := "SWR_" + strings.ToUpper(strings.ReplaceAll(f.Name, "-", "_"))
		if v := getenv(key); v != "" {
			if err := f.Value.Set(v); err != nil {
				envErrs = append(envErrs, fmt.Errorf("invalid %s", key))
			}
		}
	})
	if len(envErrs) > 0 {
		return c, errors.Join(envErrs...)
	}
	if err := fs.Parse(args); err != nil {
		return c, err
	}
	c.STUN = splitList(stun)
	c.RelayURLs = splitList(relayURLs)
	c.TURN = splitList(turn)
	c.PublicIPs = splitList(pubIPs)
	c.AllowedOrigins = splitList(origins)
	return c, c.Validate()
}

// Validate checks the configuration for contradictions.
func (c Config) Validate() error {
	var errs []error
	if c.CFAccount != "" || c.CFKeyID != "" || c.CFKeyToken != "" || c.CFAnalyticsToken != "" {
		if c.CFAccount == "" || c.CFKeyID == "" || c.CFKeyToken == "" || c.CFAnalyticsToken == "" || c.CFBudget == 0 || c.RelayListen == "" {
			errs = append(errs, errors.New("guarded Cloudflare TURN requires all Cloudflare settings and an enabled local relay"))
		}
	}
	if c.RelayListen != "" {
		if net.ParseIP(c.RelayPublicIP).To4() == nil || len(c.RelaySecret) < 32 || c.UDPPort == 0 || c.RelayMin < 1024 || c.RelayMax > 65534 || c.RelayMax < c.RelayMin || c.RelayMax-c.RelayMin > 1023 {
			errs = append(errs, errors.New("local TURN requires public IPv4, secret >=32 bytes, fixed udp-port and a valid relay port range"))
		}
	}
	if (c.TLSCert == "") != (c.TLSKey == "") {
		errs = append(errs, errors.New("tls-cert and tls-key must be set together"))
	}
	modes := 0
	if c.TLSCert != "" {
		modes++
	}
	if c.SelfSigned {
		modes++
	}
	if c.AutocertDomain != "" {
		modes++
	}
	if modes > 1 {
		errs = append(errs, errors.New("choose only one of tls-cert, self-signed, autocert"))
	}
	if c.UDPPort < 0 || c.UDPPort > 65535 {
		errs = append(errs, fmt.Errorf("invalid udp-port %d", c.UDPPort))
	}
	if c.UDPPortMin < 0 || c.UDPPortMax > 65535 || (c.UDPPortMin == 0) != (c.UDPPortMax == 0) || c.UDPPortMin > c.UDPPortMax {
		errs = append(errs, errors.New("udp-min and udp-max must both be set and min <= max"))
	}
	if c.MaxPeers < 2 {
		errs = append(errs, errors.New("max-peers must be >= 2"))
	}
	if c.MaxRooms < 1 {
		errs = append(errs, errors.New("max-rooms must be >= 1"))
	}
	if math.IsNaN(c.MsgRate) || math.IsInf(c.MsgRate, 0) || c.MsgRate <= 0 || c.MsgBurst < 1 {
		errs = append(errs, errors.New("msg-rate and msg-burst must be positive"))
	}
	if c.MaxMsgBytes < 4096 {
		errs = append(errs, errors.New("max-msg must be >= 4096"))
	}
	if c.IdleRoomTTL <= 0 {
		errs = append(errs, errors.New("room-ttl must be positive"))
	}
	if c.UDPPort != 0 && c.UDPPortMin != 0 {
		errs = append(errs, errors.New("choose udp-port or udp-min/udp-max"))
	}
	for _, ip := range c.PublicIPs {
		if net.ParseIP(ip) == nil {
			errs = append(errs, errors.New("public-ip must contain IP addresses"))
		}
	}
	if c.PublicURL != "" {
		u, err := url.Parse(c.PublicURL)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
			errs = append(errs, errors.New("public-url must be an http(s) origin without credentials, path, query or fragment"))
		}
	}
	for _, u := range append(append([]string(nil), c.TURN...), c.RelayURLs...) {
		if !strings.HasPrefix(u, "turn:") && !strings.HasPrefix(u, "turns:") {
			errs = append(errs, fmt.Errorf("TURN url %q must start with turn: or turns:", u))
		}
	}
	return errors.Join(errs...)
}

// TLSEnabled reports whether the server terminates TLS itself.
func (c Config) TLSEnabled() bool {
	return c.TLSCert != "" || c.SelfSigned || c.AutocertDomain != ""
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// EnvInt is a helper for tests and tools.
func EnvInt(key string, def int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil {
		return v
	}
	return def
}
