// Package server wires HTTP routes: the web app, the signalling WebSocket,
// the JSON API and standards based WHIP (ingest) / WHEP (playback) endpoints
// that OBS Studio 30+ and any WHEP player speak natively.
package server

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/webrtc/v4"
	"golang.org/x/time/rate"

	"github.com/webr0m/streamwebrom/internal/config"
	"github.com/webr0m/streamwebrom/internal/studio"
)

// Server is the HTTP front.
type Server struct {
	cfg              config.Config
	hub              *studio.Hub
	static           fs.FS
	log              *slog.Logger
	start            time.Time
	iceProvider      func() []webrtc.ICEServer
	RelayStatus      func() map[string]string
	LocalICEProvider func() []webrtc.ICEServer

	mu       sync.Mutex
	sessions map[string]session // WHIP/WHEP resource id -> scoped resource
	reqs     atomic.Uint64

	ipMu    sync.Mutex
	ipRate  map[string]*rate.Limiter // room creation per client IP
	ipConns map[string]int           // open WebSockets per client IP
}

// MaxWSPerIP bounds simultaneous signalling connections from one address.
const MaxWSPerIP = 30

type session struct {
	path  string
	close func()
}

// ClientIP returns the caller address. Proxy headers (Cloudflare Tunnel,
// a local reverse proxy) are trusted only when the TCP peer is loopback,
// so a remote client cannot spoof its address.

// Windows takes MIME types from the registry, where .mjs/.wasm are often
// missing or text/plain; browsers refuse modules and streaming WebAssembly
// served like that. Pin the types the web app needs on every OS.
func init() {
	for ext, typ := range map[string]string{
		".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
		".wasm": "application/wasm", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml",
		".webmanifest": "application/manifest+json", ".tflite": "application/octet-stream",
	} {
		_ = mime.AddExtensionType(ext, typ)
	}
}

func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		for _, h := range []string{"CF-Connecting-IP", "X-Real-IP", "X-Forwarded-For"} {
			if v := strings.TrimSpace(strings.Split(r.Header.Get(h), ",")[0]); v != "" && net.ParseIP(v) != nil {
				return v
			}
		}
	}
	return host
}

func (s *Server) allowCreate(ip string) bool {
	s.ipMu.Lock()
	defer s.ipMu.Unlock()
	l, ok := s.ipRate[ip]
	if !ok {
		if len(s.ipRate) > 50000 {
			s.ipRate = map[string]*rate.Limiter{}
		}
		l = rate.NewLimiter(rate.Every(6*time.Second), 5)
		s.ipRate[ip] = l
	}
	return l.Allow()
}

func (s *Server) serveWS(w http.ResponseWriter, r *http.Request) {
	ip := ClientIP(r)
	s.ipMu.Lock()
	if s.ipConns[ip] >= MaxWSPerIP {
		s.ipMu.Unlock()
		http.Error(w, "too many connections", http.StatusTooManyRequests)
		return
	}
	s.ipConns[ip]++
	s.ipMu.Unlock()
	defer func() {
		s.ipMu.Lock()
		if s.ipConns[ip]--; s.ipConns[ip] <= 0 {
			delete(s.ipConns, ip)
		}
		s.ipMu.Unlock()
	}()
	s.hub.ServeWS(w, r)
}

// New creates the server.
func New(cfg config.Config, hub *studio.Hub, static fs.FS, log *slog.Logger, iceProvider ...func() []webrtc.ICEServer) *Server {
	s := &Server{cfg: cfg, hub: hub, static: static, log: log, start: time.Now(), sessions: map[string]session{},
		ipRate: map[string]*rate.Limiter{}, ipConns: map[string]int{}}
	if len(iceProvider) > 0 {
		s.iceProvider = iceProvider[0]
	}
	return s
}

// CheckOrigin returns the WebSocket origin policy for cfg.
func CheckOrigin(cfg config.Config) func(*http.Request) bool {
	return func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true // non-browser clients (OBS plugins, tests)
		}
		for _, o := range cfg.AllowedOrigins {
			if o == "*" || strings.EqualFold(o, origin) {
				return true
			}
		}
		u, err := url.Parse(origin)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			return false
		}
		return strings.EqualFold(u.Host, r.Host)
	}
}

// Handler returns the root handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws", s.serveWS)
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("GET /api/config", s.clientConfig)
	mux.HandleFunc("POST /api/rooms", s.createRoom)
	mux.HandleFunc("GET /api/rooms/{room}", s.roomInfo)
	mux.HandleFunc("GET /api/admin/stats", s.admin(s.stats))
	mux.HandleFunc("GET /metrics", s.admin(s.metrics))

	// WHIP: OBS → Settings → Stream → Service "WHIP"
	//   Server:      https://host:8443/whip/<room>/<stream>
	//   Bearer:      the room push key
	mux.HandleFunc("POST /whip/{room}/{stream}", s.whip)
	mux.HandleFunc("POST /whep/{room}/{stream}", s.whep)
	mux.HandleFunc("DELETE /whip/{room}/{stream}/{id}", s.deleteSession)
	mux.HandleFunc("DELETE /whep/{room}/{stream}/{id}", s.deleteSession)
	mux.HandleFunc("PATCH /whip/{room}/{stream}/{id}", s.patchSession)
	mux.HandleFunc("PATCH /whep/{room}/{stream}/{id}", s.patchSession)
	mux.HandleFunc("OPTIONS /whip/", s.options)
	mux.HandleFunc("OPTIONS /whep/", s.options)

	files := http.FileServer(http.FS(s.static))
	mux.Handle("GET /", s.pages(files))
	return s.middleware(mux)
}

func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.reqs.Add(1)
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/whip/") || strings.HasPrefix(r.URL.Path, "/whep/") {
			h.Set("Cache-Control", "no-store")
		}
		h.Set("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self), autoplay=(self)")
		// Pages are embeddable by OBS (which is not a browser frame), but
		// not by arbitrary websites: protects against clickjacking.
		h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob: mediastream:; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'")
		if r.TLS != nil {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		if strings.HasPrefix(r.URL.Path, "/whip/") || strings.HasPrefix(r.URL.Path, "/whep/") {
			h.Set("Access-Control-Allow-Origin", "*")
			h.Set("Access-Control-Allow-Methods", "POST, PATCH, DELETE, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, If-Match")
			h.Set("Access-Control-Expose-Headers", "Location, Link, ETag")
		}
		defer func() {
			if v := recover(); v != nil {
				s.log.Error("panic", "path", r.URL.Path, "err", v)
				http.Error(w, "internal error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// pages maps pretty URLs (/studio, /guest, /view) to their HTML files.
func (s *Server) pages(files http.Handler) http.Handler {
	routes := map[string]string{"/": "/index.html", "/studio": "/studio.html", "/guest": "/guest.html", "/view": "/view.html", "/join": "/guest.html", "/diagnostics": "/diagnostics.html"}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if p, ok := routes[r.URL.Path]; ok {
			w.Header().Set("Cache-Control", "no-cache")
			http.ServeFileFS(w, r, s.static, strings.TrimPrefix(p, "/"))
			return
		}
		if strings.HasSuffix(r.URL.Path, ".html") { // canonical pretty URLs only
			http.NotFound(w, r)
			return
		}
		if strings.HasSuffix(r.URL.Path, ".js") || strings.HasSuffix(r.URL.Path, ".css") {
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, map[string]any{"ok": true, "version": s.cfg.Version, "uptime": int(time.Since(s.start).Seconds())})
}

func (s *Server) iceServers() []webrtc.ICEServer {
	if s.iceProvider != nil {
		return s.iceProvider()
	}
	var out []webrtc.ICEServer
	if len(s.cfg.STUN) > 0 {
		out = append(out, webrtc.ICEServer{URLs: s.cfg.STUN})
	}
	if len(s.cfg.TURN) > 0 {
		out = append(out, webrtc.ICEServer{URLs: s.cfg.TURN, Username: s.cfg.TURNUser, Credential: s.cfg.TURNPass})
	}
	return out
}

func (s *Server) clientConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	_, ffmpegErr := exec.LookPath(s.cfg.FFmpeg)
	var relay map[string]string
	if s.RelayStatus != nil {
		relay = s.RelayStatus()
	}
	var localICE []webrtc.ICEServer
	if s.LocalICEProvider != nil {
		localICE = s.LocalICEProvider()
	}
	writeJSON(w, 200, map[string]any{"ice": s.iceServers(), "publicURL": s.cfg.PublicURL, "version": s.cfg.Version, "layouts": studio.Layouts,
		"localIce": localICE, "relay": relay, "capabilities": map[string]bool{"multistream": ffmpegErr == nil, "recording": true, "trickleICE": true}})
}

// WHIP/WHEP transports must also release allocations on a provider cutoff.
// Their clients reconnect according to their own retry policy.
func (s *Server) RefreshRoutes() {
	s.mu.Lock()
	sessions := s.sessions
	s.sessions = map[string]session{}
	s.mu.Unlock()
	for _, session := range sessions {
		session.close()
	}
}

type createReq struct {
	Room     string `json:"room"`
	Password string `json:"password"`
	Title    string `json:"title"`
	Lobby    bool   `json:"lobby"`
}

func (s *Server) createRoom(w http.ResponseWriter, r *http.Request) {
	if !s.allowCreate(ClientIP(r)) {
		writeJSON(w, 429, map[string]string{"error": "demasiadas salas creadas, espera un momento"})
		return
	}
	var req createReq
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		writeJSON(w, 400, map[string]string{"error": "bad json"})
		return
	}
	if err := dec.Decode(new(any)); !errors.Is(err, io.EOF) {
		writeJSON(w, 400, map[string]string{"error": "body must contain one JSON object (max 8192 bytes)"})
		return
	}
	keys, err := s.hub.CreateRoom(req.Room, req.Password, req.Title, req.Lobby)
	if err != nil {
		writeJSON(w, 409, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 201, keys)
}

func (s *Server) roomInfo(w http.ResponseWriter, r *http.Request) {
	room := s.hub.Room(r.PathValue("room"))
	if room == nil {
		writeJSON(w, 404, map[string]string{"error": "room not found"})
		return
	}
	st := room.Snapshot()
	// Public info only: lets the guest page know whether a password/lobby applies.
	writeJSON(w, 200, map[string]any{"room": room.ID, "title": st.Title, "lobby": st.Lobby, "live": st.Live, "password": !room.CheckGuest("")})
}

func (s *Server) admin(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.cfg.AdminToken == "" || subtle.ConstantTimeCompare([]byte(bearer(r)), []byte(s.cfg.AdminToken)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		h(w, r)
	}
}

func (s *Server) stats(w http.ResponseWriter, _ *http.Request) {
	st := s.hub.Stats()
	st["requests"] = s.reqs.Load()
	writeJSON(w, 200, st)
}

func (s *Server) metrics(w http.ResponseWriter, _ *http.Request) {
	st := s.hub.Stats()
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	for _, k := range []string{"rooms", "peers", "streams"} {
		_, _ = io.WriteString(w, "streamwebrom_"+k+" "+itoa(st[k].(int))+"\n")
	}
	_, _ = io.WriteString(w, "streamwebrom_http_requests_total "+itoa(int(s.reqs.Load()))+"\n")
}

func itoa(i int) string { return strconv.Itoa(i) }

func bearer(r *http.Request) string {
	if a := r.Header.Get("Authorization"); strings.HasPrefix(a, "Bearer ") {
		return strings.TrimSpace(a[7:])
	}
	return r.URL.Query().Get("key")
}

func (s *Server) options(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Accept-Post", "application/sdp")
	w.WriteHeader(http.StatusNoContent)
}

func readOffer(w http.ResponseWriter, r *http.Request) (webrtc.SessionDescription, bool) {
	if ct, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || ct != "application/sdp" {
		http.Error(w, "Content-Type must be application/sdp", http.StatusUnsupportedMediaType)
		return webrtc.SessionDescription{}, false
	}
	b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		http.Error(w, "offer too large", http.StatusRequestEntityTooLarge)
		return webrtc.SessionDescription{}, false
	}
	if err != nil || len(b) == 0 {
		http.Error(w, "empty offer", http.StatusBadRequest)
		return webrtc.SessionDescription{}, false
	}
	return webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: string(b)}, true
}

func (s *Server) writeAnswer(w http.ResponseWriter, r *http.Request, ans *webrtc.SessionDescription, closeFn func(), done <-chan struct{}) {
	id := studio.NewRoomID() + studio.NewRoomID()
	s.mu.Lock()
	s.sessions[id] = session{path: r.URL.Path + "/" + id, close: closeFn}
	s.mu.Unlock()
	// Forget the session when the media ends on its own (OBS quit without
	// sending DELETE, network loss): otherwise the map grows forever.
	go func() { <-done; s.forget(id) }()
	w.Header().Set("Content-Type", "application/sdp")
	w.Header().Set("Location", r.URL.Path+"/"+id)
	w.Header().Set("ETag", `"`+id+`"`)
	for _, ice := range s.iceServers() {
		for _, u := range ice.URLs {
			link := "<" + u + `>; rel="ice-server"`
			if ice.Username != "" {
				link += `; username="` + ice.Username + `"; credential="` + ice.Credential.(string) + `"; credential-type="password"`
			}
			w.Header().Add("Link", link)
		}
	}
	w.WriteHeader(http.StatusCreated)
	_, _ = io.WriteString(w, ans.SDP)
}

func (s *Server) forget(id string) {
	s.mu.Lock()
	delete(s.sessions, id)
	s.mu.Unlock()
}

func (s *Server) whip(w http.ResponseWriter, r *http.Request) {
	room := s.hub.Room(r.PathValue("room"))
	if room == nil {
		http.Error(w, "room not found", http.StatusNotFound)
		return
	}
	key := bearer(r)
	if !room.CheckPush(key) && !room.CheckHost(key) {
		http.Error(w, "invalid bearer token (use the room push key)", http.StatusUnauthorized)
		return
	}
	if r.PathValue("stream") == "program" && !room.CheckHost(key) {
		http.Error(w, "program stream requires the host key", http.StatusForbidden)
		return
	}
	offer, ok := readOffer(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	st, ans, err := s.hub.PublishWHIP(ctx, room, r.PathValue("stream"), offer)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	s.writeAnswer(w, r, ans, st.Close, st.Done())
	s.log.Info("whip publish", "room", room.ID, "stream", st.ID)
}

func (s *Server) whep(w http.ResponseWriter, r *http.Request) {
	room := s.hub.Room(r.PathValue("room"))
	if room == nil {
		http.Error(w, "room not found", http.StatusNotFound)
		return
	}
	key := bearer(r)
	if !room.CheckView(key) && !room.CheckHost(key) {
		http.Error(w, "invalid bearer token (use the room view key)", http.StatusUnauthorized)
		return
	}
	offer, ok := readOffer(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	sub, ans, err := s.hub.SubscribeWHEP(ctx, room, r.PathValue("stream"), offer)
	if err != nil {
		code := http.StatusBadRequest
		if strings.Contains(err.Error(), "not found") {
			code = http.StatusNotFound
		}
		http.Error(w, err.Error(), code)
		return
	}
	s.writeAnswer(w, r, ans, sub.Close, sub.Done())
}

func (s *Server) deleteSession(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeSession(w, r) {
		return
	}
	id := r.PathValue("id")
	s.mu.Lock()
	resource, ok := s.sessions[id]
	if ok && resource.path == r.URL.Path {
		delete(s.sessions, id)
	} else {
		ok = false
	}
	s.mu.Unlock()
	if !ok {
		http.Error(w, "unknown session", http.StatusNotFound)
		return
	}
	resource.close()
	w.WriteHeader(http.StatusOK)
}

// Non-trickle only: never claim to have applied candidates that were ignored.
func (s *Server) patchSession(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeSession(w, r) {
		return
	}
	s.mu.Lock()
	resource, ok := s.sessions[r.PathValue("id")]
	s.mu.Unlock()
	if !ok || resource.path != r.URL.Path {
		http.Error(w, "unknown session", http.StatusNotFound)
		return
	}
	http.Error(w, "trickle ICE is not supported; send a complete SDP offer", http.StatusNotImplemented)
}

func (s *Server) authorizeSession(w http.ResponseWriter, r *http.Request) bool {
	room := s.hub.Room(r.PathValue("room"))
	if room == nil {
		http.NotFound(w, r)
		return false
	}
	key := bearer(r)
	allowed := room.CheckView(key)
	if strings.HasPrefix(r.URL.Path, "/whip/") {
		allowed = room.CheckPush(key)
	}
	if !allowed && !room.CheckHost(key) {
		http.Error(w, "invalid bearer token", http.StatusUnauthorized)
		return false
	}
	return true
}
