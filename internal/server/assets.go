package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"
)

// Content-address the whole first-party module graph. Relative ESM imports then
// stay under the same prefix, even when a CDN/browser cached old /js/ URLs.
func shellPrefix(files fs.FS) string {
	h := sha256.New()
	_ = fs.WalkDir(files, ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if !(strings.HasPrefix(name, "js/") || strings.HasPrefix(name, "css/") || strings.HasSuffix(name, ".html") || name == "sw.js") {
			return nil
		}
		data, err := fs.ReadFile(files, name)
		if err != nil {
			return err
		}
		_, _ = h.Write([]byte(name + "\x00"))
		_, _ = h.Write(data)
		return nil
	})
	return "/assets/" + hex.EncodeToString(h.Sum(nil)[:12])
}

// The Vite build publishes the hashed bundle list; the offline shell must
// precache exactly those URLs, never a hand-maintained one. The file is raw
// output of a build tool, so it is only trusted once it parses as []string and
// is re-marshalled from there: splicing bytes that are not an array of paths
// makes SHELL_ASSETS.map throw at worker top level (web/sw.js), which aborts
// registration and breaks offline for every user. Anything unusable degrades to
// the empty list — the classic shell still precaches — and says so in the log.
func (s *Server) shellAssets() []byte {
	data, err := fs.ReadFile(s.static, "js/sw-assets.json")
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			s.log.Warn("shell asset list unreadable, precaching none", "err", err)
		}
		return []byte("[]")
	}
	var assets []string
	if err := json.Unmarshal(bytes.TrimSpace(data), &assets); err != nil || len(assets) == 0 {
		if err == nil {
			err = errors.New("empty asset list")
		}
		s.log.Warn("shell asset list invalid, precaching none", "err", err)
		return []byte("[]")
	}
	out, err := json.Marshal(assets)
	if err != nil {
		s.log.Warn("shell asset list unencodable, precaching none", "err", err)
		return []byte("[]")
	}
	return out
}

func noShellCache(w http.ResponseWriter) {
	for _, header := range []string{"Cache-Control", "CDN-Cache-Control", "Cloudflare-CDN-Cache-Control"} {
		w.Header().Set(header, "no-store")
	}
}

func (s *Server) serveShell(w http.ResponseWriter, r *http.Request, name string, immutable bool) {
	data, err := fs.ReadFile(s.static, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	switch path.Ext(name) {
	case ".html":
		data = []byte(strings.NewReplacer(`"/js/`, `"`+s.assetPrefix+`/js/`, `"/css/`, `"`+s.assetPrefix+`/css/`).Replace(string(data)))
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
	case ".js":
		if name == "sw.js" {
			data = bytes.ReplaceAll(data, []byte("__SWR_ASSET_PREFIX__"), []byte(s.assetPrefix))
			data = bytes.ReplaceAll(data, []byte("__SWR_SHELL__"), s.shellAssets())
		}
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	case ".css":
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
	}
	if immutable {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		noShellCache(w)
	}
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
}
