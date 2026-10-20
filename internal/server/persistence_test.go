package server_test

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPersistenceHTTPAuthenticatesBeforeReadingPrivateLargeSettings(t *testing.T) {
	e := newEnv(t)
	k := e.createRoom(t, `{"room":"private-settings","password":"guest-password"}`)
	path := e.ts.URL + "/api/rooms/" + k.Room + "/persistence"
	post := func(key, body string) int {
		t.Helper()
		req, _ := http.NewRequest("POST", path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Content-Type", "application/json")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		io.Copy(io.Discard, res.Body)
		return res.StatusCode
	}
	for _, key := range []string{"", k.ViewKey, k.PushKey, "guest-password"} {
		if code := post(key, `{"days":30}`); code != 401 {
			t.Fatalf("non-host saved settings: %d", code)
		}
	}
	body := `{"days":30,"options":{"privateImage":"` + strings.Repeat("x", 300000) + `"}}`
	if code := post(k.HostKey, body); code != 200 {
		t.Fatalf("host could not save image settings: %d", code)
	}
	file, err := os.ReadFile(filepath.Join(e.dir, "rooms", k.Room+".json"))
	if err != nil || !strings.Contains(string(file), strings.Repeat("x", 300000)) {
		t.Fatal("large private options not retained")
	}
	res, err := http.Get(e.ts.URL + "/api/rooms/" + k.Room)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	public, _ := io.ReadAll(res.Body)
	if strings.Contains(string(public), "privateImage") || strings.Contains(string(public), k.HostKey) {
		t.Fatal("private settings leaked through public info")
	}
	if code := post(k.HostKey, strings.Repeat("x", (6<<20)+1)); code != 413 {
		t.Fatalf("unbounded settings body: %d", code)
	}
}
