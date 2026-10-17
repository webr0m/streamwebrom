// Package web embeds the browser application (no build step, no CDN).
package web

import "embed"

// Files holds every static asset served by StreamWebRom.
//
//go:embed *.html *.webmanifest sw.js css js img
var Files embed.FS
