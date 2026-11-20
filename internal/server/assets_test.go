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
	"sync"
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

// A Vite-manifest regression writes something that is not an array of paths —
// `{}`, a BOM, a comment. Spliced into `const SHELL_ASSETS = …;` raw, that makes
// SHELL_ASSETS.map throw at worker top level (web/sw.js:10), so the service
// worker never registers and offline breaks for every user. Anything unusable
// must degrade to the empty list instead, and say so in the server log.
func TestMalformedAssetListDegradesToAnEmptyShell(t *testing.T) {
	for _, content := range []string{`{}`, "\xef\xbb\xbf[\"js/studio-abc.js\"]", "[\"js/a.js\"] // generated", `["js/a.js",42]`, `[`, ``} {
		label := content
		if label == "" {
			label = "<empty>"
		}
		files := fstest.MapFS{
			"js/sw-assets.json": {Data: []byte(content)},
			"sw.js":             {Data: []byte(`const SHELL_ASSETS = __SWR_SHELL__;`)},
		}
		mu := &sync.Mutex{}
		var lines []string
		s := New(config.Default(), nil, files, slog.New(slog.NewTextHandler(testWriter{mu, &lines}, nil)))
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/sw.js", nil))
		body := w.Body.String()
		if strings.Contains(body, "__SWR_SHELL__") || !strings.Contains(body, "= [];") {
			t.Errorf("content %q must degrade to `= [];`, got %s", label, body)
			continue
		}
		// What reaches the worker must stay a JSON array of quoted paths, or the
		// .map on web/sw.js:10 throws again.
		var injected []string
		literal := strings.TrimSuffix(strings.TrimPrefix(body, "const SHELL_ASSETS = "), ";")
		if err := json.Unmarshal([]byte(literal), &injected); err != nil {
			t.Errorf("content %q injected %q, which is not a JSON array of paths: %v", label, literal, err)
		} else if len(injected) != 0 {
			t.Errorf("content %q leaked %v into the precache list", label, injected)
		}
		mu.Lock()
		reported := len(lines) > 0
		mu.Unlock()
		if !reported {
			t.Errorf("content %q degraded silently: the incident must reach the server log", label)
		}
	}
}

// Degradation must be all-or-nothing per source: a valid manifest still injects
// every path verbatim, with no whitespace left over and no incident logged.
func TestValidAssetListIsReMarshalledWithoutLosses(t *testing.T) {
	files := fstest.MapFS{
		"js/sw-assets.json": {Data: []byte("\n  [\"css/studio-abc.css\", \"js/studio-abc.js\"]  \n")},
		"sw.js":             {Data: []byte(`const SHELL_ASSETS = __SWR_SHELL__;`)},
	}
	mu := &sync.Mutex{}
	var lines []string
	s := New(config.Default(), nil, files, slog.New(slog.NewTextHandler(testWriter{mu, &lines}, nil)))
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/sw.js", nil))
	const want = `["css/studio-abc.css","js/studio-abc.js"]`
	if got := w.Body.String(); !strings.Contains(got, want) {
		t.Fatalf("a valid list must inject exactly %q, got %s", want, got)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(lines) != 0 {
		t.Errorf("a valid list must not be logged as an incident: %v", lines)
	}
}

// Concurrency-safe sink so the log assertions above can read what the server
// reported without racing the handler.
type testWriter struct {
	mu    *sync.Mutex
	lines *[]string
}

func (w testWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	*w.lines = append(*w.lines, string(p))
	return len(p), nil
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

func embedded() fs.FS {
	sub, err := fs.Sub(web.Files, ".")
	if err != nil {
		panic(err)
	}
	return sub
}

func TestStudioHtmlLinksTheVersionedReactShellAndKeepsLegacyIdle(t *testing.T) {
	legacy, err := fs.ReadFile(embedded(), "studio.html")
	if err != nil {
		t.Fatal(err)
	}
	for _, marker := range []string{`id="program"`, `id="scenesRail"`, `id="backstage"`, `id="studioPanes"`} {
		if !strings.Contains(string(legacy), marker) {
			t.Fatalf("studio.html must keep the %s container for the legacy mode", marker)
		}
	}
	if strings.Contains(string(legacy), `src="/js/studio.js"`) {
		t.Fatal("the page must not load the legacy studio module eagerly: the boot switch owns it")
	}
}

// Keep a failure readable: the served worker is one long line per constant.
func firstLines(s string) string {
	return strings.Join(strings.SplitN(s, "\n", 9)[:8], "\n")
}
