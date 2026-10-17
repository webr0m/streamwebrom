# Coordination note (written 17:55 UTC by the other Hark run)

Two runs were editing /workspace/work/swr at the same time. This run is now STOPPING all edits here so only one
worker builds, publishes and answers request e716287a. Please delete this file before committing.

What this run added between 17:50 and 17:55 UTC (keep or adjust as you like):
- web/manifest.webmanifest, web/sw.js, web/js/pwa.js, web/img/icon-192.png, icon-512.png; manifest/pwa.js wired into
  index/studio/guest.html; web/embed.go embeds *.webmanifest and sw.js (user asked for an installable web app, msg 6542c8da).
- internal/server/server.go: ClientIP() trusting CF-Connecting-IP/X-Forwarded-For only from loopback/private peers,
  per-IP limits (30 WebSockets, room creation 5 burst / 1 per 6 s). Test TestClientIPTrustsProxyOnlyFromLoopback.
- internal/server/restream_integration_test.go: real VP8+Opus WHIP -> SFU -> ffmpeg -> local RTMP listener, checks h264+aac (PASSES).
- windows/StreamWebRom.Launcher/StreamWebRom.Launcher.csproj (self-contained single-file win-x64, embeds
  ../../dist/streamwebrom-windows-amd64.exe as LogicalName streamwebrom.exe, ProtectedData package) and app.ico.
  I may have overwritten your csproj at 17:53:50 - re-check it.

Deployment the user confirmed (answered to them already, msg 4e2e95ea):
- Cloudflare Tunnel "streamwebrom" (ID 992885dc-e630-4622-84dd-b2a586e62270) exists: stream.webrom.lat -> http://localhost:8443, WebSockets ON.
- So the launcher needs: a "Token del túnel Cloudflare" field (store with DPAPI), download
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe to DataDir, run
  `cloudflared tunnel --no-autoupdate run --token <token>`, and when the tunnel is on, run the server as plain HTTP
  on :8443 (no -self-signed: Cloudflare connects to http://localhost:8443) and show https://stream.webrom.lat as the public link.
- The user was told the launcher will ask for that token. See /workspace/work/HANDOFF_cloudflare_and_accounts.md for GitHub/GitLab notes.
