package server

import (
	"encoding/json"
	"io/fs"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/webr0m/streamwebrom/internal/config"
	"github.com/webr0m/streamwebrom/web"
)

func TestShellAssetsReachTheServiceWorker(t *testing.T) {
	files := fstest.MapFS{
		"studio.html":      {Data: []byte(`<script type="module" src="/js/studio-abc.js"></script><link rel="stylesheet" href="/css/studio-abc.css">`)},
		"js/studio-abc.js": {Data: []byte(`console.log("shell")`)},
		"css/studio-abc.css": {Data: []byte(`body{color:red}`)},
		"js/sw-assets.json":  {Data: []byte(`["css/studio-abc.css","js/studio-abc.js"]`)},
		"sw.js":              {Data: []byte(`const SHELL_ASSETS = __SWR_SHELL__;const prefix="__SWR_ASSET_PREFIX__";`)},
	}
	s := New(config.Default(), nil, files, slog.Default())
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/sw.js?build=x", nil))
	body := w.Body.String()
	if w.Code != http.StatusOK {
		t.Fatalf("sw.js: %d", w.Code)
	}
	for _, want := range []string{`["css/studio-abc.css","js/studio-abc.js"]`, s.assetPrefix} {
		if !strings.Contains(body, want) {
			t.Fatalf("sw.js must contain %q, got %s", want, body)
		}
	}
	if strings.Contains(body, "__SWR_SHELL__") {
		t.Fatal("service worker kept the unexpanded shell placeholder")
	}
}

func TestMissingAssetListDoesNotBreakTheShell(t *testing.T) {
	files := fstest.MapFS{"sw.js": {Data: []byte(`const SHELL_ASSETS = __SWR_SHELL__;`)}}
	s := New(config.Default(), nil, files, slog.Default())
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/sw.js", nil))
	if !strings.Contains(w.Body.String(), "= [];") {
		t.Fatalf("missing sw-assets.json must degrade to an empty list, got %s", w.Body.String())
	}
}

func TestShellUpdateBypassesCachedModuleGraph(t *testing.T) {
	files := fstest.MapFS{
		"diagnostics.html":  {Data: []byte(`<script type="module" src="/js/diagnostics.js"></script><link href="/css/app.css">`)},
		"js/diagnostics.js": {Data: []byte(`import { version } from "./rtc.js";`)},
		"js/rtc.js":         {Data: []byte(`export const version = "old";`)},
		"css/app.css":       {Data: []byte(`body{color:white}`)},
		"sw.js":             {Data: []byte(`const prefix="__SWR_ASSET_PREFIX__";`)},
	}
	old := shellPrefix(files)
	files["js/rtc.js"].Data = []byte(`export const version = "new";`)
	s := New(config.Default(), nil, files, slog.Default())
	if s.assetPrefix == old {
		t.Fatal("nested module update reused a cached asset URL")
	}
	handler := s.Handler()
	for _, name := range []string{"/diagnostics", s.assetPrefix + "/js/diagnostics.js", s.assetPrefix + "/js/rtc.js", s.assetPrefix + "/css/app.css", "/sw.js?build=current", "/js/rtc.js"} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, name, nil))
		if w.Code != http.StatusOK {
			t.Fatalf("%s: %d", name, w.Code)
		}
		if name == "/diagnostics" && !strings.Contains(w.Body.String(), `src="`+s.assetPrefix+`/js/diagnostics.js"`) {
			t.Fatal("page linked an unversioned script")
		}
		if strings.HasPrefix(name, "/sw.js") && (strings.Contains(w.Body.String(), "__SWR_ASSET_PREFIX__") || !strings.Contains(w.Body.String(), s.assetPrefix)) {
			t.Fatal("offline shell uses a different build")
		}
		if !strings.HasPrefix(name, s.assetPrefix) && w.Header().Get("Cloudflare-CDN-Cache-Control") != "no-store" {
			t.Fatal("unversioned shell can be cached by CDN")
		}
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, old+"/js/rtc.js", nil))
	if w.Code != http.StatusNotFound {
		t.Fatal("old build URL returned a different module version")
	}
}

// The served worker against the real embedded tree, not a fixture: this stands
// in for a live `curl /sw.js`. The list it checks lives in git-ignored
// web/js/sw-assets.json, so a checkout without a UI build skips instead of
// turning red.
func TestServedServiceWorkerPrecachesTheBuiltBundle(t *testing.T) {
	static, err := fs.Sub(web.Files, ".")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := fs.ReadFile(static, "js/sw-assets.json")
	if err != nil {
		t.Skipf("no UI build in this checkout: %v — run node scripts/build-ui.mjs", err)
	}
	var list []string
	if err := json.Unmarshal(raw, &list); err != nil {
		t.Fatalf("js/sw-assets.json must be a JSON array of asset paths: %v", err)
	}
	if len(list) == 0 {
		t.Fatal("js/sw-assets.json lists nothing to precache")
	}
	s := New(config.Default(), nil, static, slog.Default())
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/sw.js?build=current", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("sw.js: %d", w.Code)
	}
	body := w.Body.String()
	for _, token := range []string{"__SWR_SHELL__", "__SWR_ASSET_PREFIX__"} {
		if strings.Contains(body, token) {
			t.Fatalf("served sw.js still holds %s:\n%s", token, firstLines(body))
		}
	}
	for _, file := range list {
		if !strings.Contains(body, `"`+file+`"`) {
			t.Errorf("precache list must contain %q", file)
		}
	}
}

// The repository's own web/sw.js, read from disk because go:embed freezes the
// copy compiled into this test binary. It must keep declaring both placeholders
// and resolve every injected path as ASSET_PREFIX + "/" + p, the contract Task 1
// documents: a hand-expanded worker would make the served output above look
// right while breaking the next build.
func TestShippedServiceWorkerKeepsTheInjectionContract(t *testing.T) {
	worker, err := os.ReadFile(filepath.Join("..", "..", "web", "sw.js"))
	if err != nil {
		t.Fatal(err)
	}
	source := string(worker)
	for _, token := range []string{"__SWR_SHELL__", "__SWR_ASSET_PREFIX__"} {
		if !strings.Contains(source, token) {
			t.Errorf("web/sw.js must keep %s for Go to expand", token)
		}
	}
	if !strings.Contains(source, `ASSET_PREFIX + "/" + p`) {
		t.Error(`web/sw.js must resolve the injected paths as ASSET_PREFIX + "/" + p`)
	}
}

// Keep a failure readable: the served worker is one long line per constant.
func firstLines(s string) string {
	return strings.Join(strings.SplitN(s, "\n", 9)[:8], "\n")
}
