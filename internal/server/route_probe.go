package server

import (
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
	keys, err := s.hub.CreateRouteProbe()
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 201, keys)
}

func (s *Server) releaseRouteCheck(w http.ResponseWriter, r *http.Request) {
	if !s.hub.ReleaseRouteProbe(r.PathValue("room"), bearer(r)) {
		writeJSON(w, 403, map[string]string{"error": "invalid network check key"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
