"""Real-browser regression checks. pip install playwright; playwright install chromium.
Run against a disposable local server: python scripts/browser-smoke.py --url http://localhost:18443
"""
import argparse
import json
import time
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://localhost:18443')
parser.add_argument('--browser', help='Optional Chromium executable')
args = parser.parse_args()

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path=args.browser, args=[
        '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
    ])
    context = browser.new_context(permissions=['camera', 'microphone'], service_workers='block')
    errors = []
    def page():
        p = context.new_page()
        p.on('pageerror', lambda error: errors.append(str(error)))
        return p
    host = page()
    host.goto(args.url)
    host.evaluate("localStorage.setItem('swr.rooms', '{broken'); localStorage.setItem('swr.dest', '{broken')")
    host.reload()
    expect(host.locator('#create')).to_be_enabled()
    room = f'browser-{int(time.time())}'
    response = context.request.post(args.url+'/api/rooms', data={'room':room, 'title':'Prueba del estudio', 'lobby':True})
    assert response.status == 201
    keys = response.json()
    host.goto(f"{args.url}/studio?room={room}#key={keys['hostKey']}")
    expect(host.locator('#status')).to_have_text('conectado', timeout=20000)
    host.locator('#addCam').click()
    expect(host.locator('#backstage .tile')).to_have_count(1, timeout=20000)
    guest = page()
    guest.goto(f'{args.url}/guest?room={room}&label=Invitada')
    guest.locator('#joinBtn').click()
    expect(guest.locator('#waiting')).to_be_visible(timeout=15000)
    host.locator('#waitroom').get_by_role('button', name='Pasar al backstage', exact=True).click()
    expect(guest.locator('#call')).to_be_visible(timeout=15000)
    expect(host.locator('#backstage .tile')).to_have_count(2, timeout=20000)
    host.locator('#backstage .stagebtn').filter(has_text='Al escenario').first.click(force=True)
    expect(host.locator('#backstage .stagebtn.on')).to_have_count(2)
    expect(guest.locator('#stageState')).to_contain_text('escenario', timeout=10000)
    viewer = page()
    viewer.add_init_script("""window.__sockets=[]; window.__pcs=[]; window.__start=0;
      const NativeSocket=WebSocket, NativePC=RTCPeerConnection;
      window.WebSocket=class extends NativeSocket { constructor(...args) { super(...args); window.__sockets.push(this); } };
      window.RTCPeerConnection=class extends NativePC { constructor(...args) { super(...args); window.__pcs.push(this); } };""")
    viewer.goto(f"{args.url}/view?room={room}&scene=1#key={keys['viewKey']}")
    decoded = """async () => {
      const pcs=window.__pcs.slice(window.__start).filter(pc=>pc.connectionState!=='closed');
      const reports=await Promise.all(pcs.map(pc=>pc.getStats()));
      return reports.some(r=>[...r.values()].some(s=>s.type==='inbound-rtp' && s.kind==='video' && s.framesDecoded>0));
    }"""
    viewer.wait_for_function(decoded, timeout=20000)
    # Break the viewer's real signalling connection without reloading its page.
    viewer.evaluate('window.__start=window.__pcs.length; window.__sockets[0].close()')
    viewer.wait_for_function('() => window.__sockets.length >= 2 && window.__sockets.at(-1).readyState === 1', timeout=15000)
    viewer.wait_for_function(decoded, timeout=20000)
    diagnostics = page()
    diagnostics.goto(args.url+'/diagnostics')
    expect(diagnostics.locator('#checks')).to_contain_text('Conectado', timeout=10000)
    diagnostics.locator('#media').click()
    expect(diagnostics.locator('#mediaResult')).to_contain_text('liberado', timeout=10000)
    # Safari's engine catches unsupported syntax and DOM assumptions.
    webkit = pw.webkit.launch(headless=True)
    safari = webkit.new_page()
    safari.on('pageerror', lambda error: errors.append('WebKit: '+str(error)))
    safari.goto(args.url+'/diagnostics')
    expect(safari.locator('#checks')).to_contain_text('Conectado', timeout=10000)
    safari.close(); webkit.close()
    assert not errors, errors
    print(json.dumps({'ok':True, 'checks':['corrupt storage', 'host camera', 'lobby admission', 'guest publication', 'stage', 'OBS media', 'signalling reconnect', 'preflight', 'WebKit diagnostics'], 'pageErrors':errors}, ensure_ascii=False))
    context.close(); browser.close()
