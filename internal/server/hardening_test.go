package server_test

import (
	"github.com/webr0m/streamwebrom/internal/config"
	"github.com/webr0m/streamwebrom/internal/server"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRejectAmbiguousAndOversizedRoomBodies(t *testing.T) {
	for _, body := range []string{`{} {}`, `{"title":"` + strings.Repeat("a", 9000) + `"}`, `{} ` + strings.Repeat(" ", 9000), `{`, `[]`} {
		e := newEnv(t)
		res, err := http.Post(e.ts.URL+"/api/rooms", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 400 {
			t.Fatalf("expected 400, got %d", res.StatusCode)
		}
		if e.hub.Stats()["rooms"].(int) != 0 {
			t.Fatal("bad request created a room")
		}
	}
}

func TestStrictOfferBody(t *testing.T) {
	e := newEnv(t)
	k := e.createRoom(t, `{"room":"offer-room"}`)
	for _, tc := range []struct {
		ct, body string
		status   int
	}{
		{"application/sdp-evil", "v=0", 415},
		{"application/sdp", strings.Repeat("x", (64<<10)+1), 413},
	} {
		req, _ := http.NewRequest("POST", e.ts.URL+"/whip/offer-room/test", strings.NewReader(tc.body))
		req.Header.Set("Content-Type", tc.ct)
		req.Header.Set("Authorization", "Bearer "+k.PushKey)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != tc.status {
			t.Fatalf("got %d, want %d", res.StatusCode, tc.status)
		}
		if res.Header.Get("Cache-Control") != "no-store" {
			t.Fatal("missing secret-response cache policy")
		}
	}
}

func TestSessionResourcesRequireAuthAndCorrectPath(t *testing.T) {
	e := newEnv(t)
	k := e.createRoom(t, `{"room":"scope-room"}`)
	_, _ = whipPublish(t, e.ts.URL+"/whip/scope-room/cam", k.PushKey)
	// A separate publisher response supplies the session URL.
	// Resource authorization is required even for nonexistent IDs.
	for _, method := range []string{"DELETE", "PATCH"} {
		req, _ := http.NewRequest(method, e.ts.URL+"/whip/scope-room/cam/unknown", nil)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 401 {
			t.Fatalf("%s unauthenticated: %d", method, res.StatusCode)
		}
		req.Header.Set("Authorization", "Bearer "+k.ViewKey)
		res, err = http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 401 {
			t.Fatalf("view key modified ingest: %d", res.StatusCode)
		}
	}
}

func TestMalformedOriginDenied(t *testing.T) {
	r := httptest.NewRequest("GET", "https://studio.local/ws", nil)
	for _, origin := range []string{"ftp://studio.local", "https://studio.local/path", "https://user@studio.local", "null"} {
		r.Header.Set("Origin", origin)
		if server.CheckOrigin(config.Default())(r) {
			t.Fatalf("accepted %q", origin)
		}
	}
}
