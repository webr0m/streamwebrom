package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"golang.org/x/time/rate"
)

func (s *Server) createRouteCheck(w http.ResponseWriter, r *http.Request) {
	s.ipMu.Lock()
	ip := ClientIP(r)
	l := s.probeRate[ip]
	if l == nil {
		if len(s.probeRate) >= 50000 {
			s.probeRate = map[string]*rate.Limiter{}
		}
		l = rate.NewLimiter(rate.Every(time.Second), 10)
		s.probeRate[ip] = l
	}
	allowed := l.Allow()
	s.ipMu.Unlock()
	if !allowed {
		writeJSON(w, 429, map[string]string{"error": "Espera un momento para comprobar la conexión."})
		return
	}
	var req struct {
		Room     string `json:"room"`
		Password string `json:"password"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2048)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		writeJSON(w, 400, map[string]string{"error": "Solicitud inválida"})
		return
	}
	keys, err := s.hub.CreateRoomRouteProbe(req.Room, req.Password)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	ice, provider := s.hub.RoomICE(s.hub.Room(keys.Room), "")
	writeJSON(w, 201, struct {
		Room    string `json:"room"`
		HostKey string `json:"hostKey"`
		ICE     any    `json:"ice"`
		Relay   any    `json:"relay"`
	}{keys.Room, keys.HostKey, ice, map[string]string{"provider": provider}})
}

func (s *Server) releaseRouteCheck(w http.ResponseWriter, r *http.Request) {
	if !s.hub.ReleaseRouteProbe(r.PathValue("room"), bearer(r)) {
		writeJSON(w, 403, map[string]string{"error": "invalid network check key"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
