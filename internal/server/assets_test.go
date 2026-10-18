package server

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/webr0m/streamwebrom/internal/config"
)

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
