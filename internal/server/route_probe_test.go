package server_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/webr0m/streamwebrom/internal/studio"
)

func TestRouteChecksAreTemporaryAndCannotDeleteShows(t *testing.T) {
	e := newEnv(t)
	show := e.createRoom(t, `{"room":"protected-show"}`)
	res, err := http.Post(e.ts.URL+"/api/route-check", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	var keys studio.Keys
	if err := json.NewDecoder(res.Body).Decode(&keys); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 201 || keys.HostKey == "" {
		t.Fatal("network check not created")
	}
	for _, attempt := range []struct {
		room, key string
		code      int
	}{
		{show.Room, show.HostKey, 403}, {keys.Room, "wrong", 403}, {keys.Room, keys.HostKey, 204},
	} {
		req, _ := http.NewRequest(http.MethodDelete, e.ts.URL+"/api/route-check/"+attempt.room, nil)
		req.Header.Set("Authorization", "Bearer "+attempt.key)
		r, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		if r.StatusCode != attempt.code {
			t.Fatalf("check cleanup: got %d, want %d", r.StatusCode, attempt.code)
		}
	}
	if e.hub.Room(show.Room) == nil || e.hub.Room(keys.Room) != nil {
		t.Fatal("network check cleanup affected a real show or leaked a temporary room")
	}
}
