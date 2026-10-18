package server

import (
	"context"
	"github.com/webr0m/streamwebrom/internal/config"
	"github.com/webr0m/streamwebrom/internal/studio"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestSessionScopeAndDeletion(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	hub := studio.NewHub(ctx, studio.Options{MaxRooms: 2})
	keys, err := hub.CreateRoom("scope-room", "", "", false)
	if err != nil {
		t.Fatal(err)
	}
	s := New(config.Default(), hub, fstest.MapFS{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	closed := false
	s.sessions["resource"] = session{path: "/whip/scope-room/cam/resource", close: func() { closed = true }}
	for _, tc := range []struct {
		method, path, key string
		status            int
	}{
		{"DELETE", "/whip/scope-room/cam/resource", "", 401},
		{"DELETE", "/whip/scope-room/cam/resource", keys.ViewKey, 401},
		{"DELETE", "/whip/scope-room/other/resource", keys.PushKey, 404},
		{"DELETE", "/whep/scope-room/cam/resource", keys.ViewKey, 404},
		{"PATCH", "/whip/scope-room/cam/resource", keys.PushKey, 501},
		{"DELETE", "/whip/scope-room/cam/resource", keys.PushKey, 200},
	} {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		req.Header.Set("Authorization", "Bearer "+tc.key)
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
		if rec.Code != tc.status {
			t.Fatalf("%s %s: %d, want %d", tc.method, tc.path, rec.Code, tc.status)
		}
		if tc.status != 200 && closed {
			t.Fatal("invalid resource request closed media")
		}
	}
	if !closed || len(s.sessions) != 0 {
		t.Fatal("valid DELETE did not release resource")
	}
}
