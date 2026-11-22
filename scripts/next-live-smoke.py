"""Exercise the beta against a disposable StreamWebRom server and a loopback RTMP sink."""
import argparse
import json
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://localhost:18443")
parser.add_argument("--browser")
parser.add_argument("--ffmpeg", default="ffmpeg")
parser.add_argument("--allow-stale", action="store_true")
parser.add_argument("--force-demo", action="store_true", help="prove a fixture cannot pass the live assertions")
args = parser.parse_args()

with sync_playwright() as pw, tempfile.TemporaryDirectory() as directory:
    browser = pw.chromium.launch(executable_path=args.browser, args=[
        "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required",
    ])
    ctx = browser.new_context(locale="es-ES", permissions=["camera", "microphone", "clipboard-read", "clipboard-write"], service_workers="block")
    report = ctx.request.get(args.url + "/api/health").json()
    if not args.allow_stale and report["uptime"] > 120:
        raise SystemExit("Use the freshly built disposable server, not an existing instance")
    errors = []
    room = f"next-smoke-{time.time_ns()}"
    host = ctx.new_page()
    host.on("pageerror", lambda error: errors.append(str(error)))
    host.add_init_script("""(() => {
      window.auditSockets = [];
      window.auditMessages = [];
      const Native = WebSocket;
      window.WebSocket = class extends Native {
        constructor(...args) {
          super(...args);
          window.auditSockets.push(this);
          this.addEventListener('message', e => window.auditMessages.push(JSON.parse(e.data)));
        }
      };
    })()""")
    host.goto(args.url)
    expect(host.locator("#studioMode")).to_have_value("legacy")
    host.locator("#studioMode").select_option("next")
    host.locator("#room").fill(room)
    host.locator("#title").fill("Beta con motor real")
    host.locator("#create").click()
    host.wait_for_url("**/studio?**")
    keys = host.evaluate("room => JSON.parse(localStorage.getItem('swr.rooms'))[room]", room)
    if args.force_demo:
        host.goto(f"{args.url}/studio?{urlencode({'room': room, 'ui': 'next', 'demo': 1})}#key={keys['hostKey']}")
    expect(host.locator("#studioRoot")).to_have_attribute("data-ui-mode", "next")
    banner = host.get_by_role("banner")
    expect(banner).to_contain_text("Beta con motor real", timeout=8000)
    expect(banner.get_by_text("conectado", exact=True)).to_be_visible()
    guest = ctx.new_page()
    guest.on("pageerror", lambda error: errors.append(str(error)))
    guest.goto(f"{args.url}/guest?{urlencode({'room': room, 'label': 'Ana'})}")
    guest.locator("#joinBtn").click()
    expect(guest.locator("#call")).to_be_visible(timeout=20000)
    card = host.locator("#backstage li[data-source]").filter(has_text="Ana")
    expect(card).to_have_count(1, timeout=20000)
    host.wait_for_function("() => [...document.querySelectorAll('#backstage video')].some(v => v.videoWidth > 0)")
    card.locator("[data-role=source-mute]").click()
    guest.wait_for_function("() => document.querySelector('[data-id=me] video').srcObject.getAudioTracks().some(t => !t.enabled)")
    card.locator("[data-role=source-stage]").click()
    host.wait_for_function("() => auditMessages.some(m => m.type === 'state' && m.state.stage?.length === 1)")
    host.locator("[data-action=camera]").click()
    expect(host.locator("[data-source=host-camera] video")).to_be_visible(timeout=30000)
    host.wait_for_function("() => auditMessages.findLast(m => m.type === 'state')?.state.stage.includes('host-camera')")
    host.evaluate("window.auditSockets[0].close()")
    host.wait_for_function("() => window.auditSockets.length >= 2 && window.auditSockets.at(-1).readyState === 1")
    expect(host.locator("[data-source=host-camera] video")).to_be_visible(timeout=30000)
    host.wait_for_function("() => [...document.querySelectorAll('#backstage video')].length === 2")
    host.wait_for_function("() => auditMessages.findLast(m => m.type === 'state' || m.type === 'welcome')?.state.stage.includes('host-camera')")
    host.wait_for_function("() => auditMessages.filter(m => m.type === 'stream-added' && m.info.id === 'host-camera').length === 2")
    host.locator("[data-action=record]").click()
    host.wait_for_function("() => window.auditMessages.some(m => m.type === 'state' && m.state.recording?.length > 0)")
    host.locator("[data-action=record]").click()
    host.wait_for_function("() => window.auditMessages.findLast(m => m.type === 'state')?.state.recording?.length === undefined || window.auditMessages.findLast(m => m.type === 'state')?.state.recording?.length === 0")
    host.get_by_role("button", name="Solo", exact=True).click()
    host.wait_for_function("() => window.auditMessages.some(m => m.type === 'state' && m.state.layout === 'solo')")
    host.locator("[data-action=obs-link]").click()
    obs_url = host.evaluate("navigator.clipboard.readText()")
    assert "scene=1" in obs_url and "key=" in obs_url and keys["hostKey"] not in obs_url
    viewer = ctx.new_page()
    viewer.add_init_script("""(() => {
      const Native = WebSocket;
      window.WebSocket = class extends Native {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', e => {
            const m = JSON.parse(e.data);
            if (m.state) window.obsLayout = m.state.layout;
          });
        }
      };
    })()""")
    viewer.goto(obs_url)
    expect(viewer.locator("#out")).to_be_visible(timeout=20000)
    viewer.wait_for_function("() => window.obsLayout === 'solo'")

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    endpoint = f"rtmp://127.0.0.1:{port}/live/fixture"
    recording = Path(directory) / "received.flv"
    with subprocess.Popen([args.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-listen", "1", "-timeout", "30",
                           "-i", endpoint, "-c", "copy", str(recording)], stderr=subprocess.DEVNULL) as sink:
        try:
            host.locator("[data-action=live]").click()
            modal = host.get_by_role("dialog")
            modal.locator("input[name=url]").fill(endpoint)
            modal.get_by_role("button", name="Agregar destino").click()
            expect(modal.get_by_role("checkbox")).to_be_checked()
            modal.get_by_role("button", name="Cerrar").click()
            host.locator("[data-action=live]").click()
            host.wait_for_function("() => window.auditMessages.some(m => m.type === 'stream-added' && m.info.id === 'program')")
            host.wait_for_function("() => window.auditMessages.some(m => m.type === 'state' && m.state.live)")
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline and (not recording.exists() or recording.stat().st_size < 20000):
                time.sleep(0.25)
            host.locator("[data-action=live]").click()
            host.get_by_role("dialog").get_by_role("button", name="Detener emisión").click()
            host.wait_for_function("() => window.auditMessages.findLast(m => m.type === 'state')?.state.live !== true")
            sink.wait(timeout=8)
            assert recording.stat().st_size >= 20000
        finally:
            if sink.poll() is None:
                sink.kill()
    assert not errors, errors
    host.get_by_role("button", name="Abrir Studio clásico").click()
    host.get_by_role("dialog").get_by_role("link", name="Abrir Studio clásico").click()
    expect(host.locator("#status")).to_have_text("conectado", timeout=15000)
    print(json.dumps({"liveHost": True, "guestVideo": True, "guestMute": True, "scene": True, "reconnect": True, "recording": True, "obs": True, "rtmp": True}))
    browser.close()
