package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
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
