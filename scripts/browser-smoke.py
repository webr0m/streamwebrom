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
    context = browser.new_context(locale='es-ES',permissions=['camera', 'microphone'], service_workers='block')
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
    # Remove SDP-embedded candidates and delay BOTH trickle directions beyond
    # the old 2s/3s cutoffs. Media must still connect using the late candidates.
    ice_network = """({delay, blocked}) => {
      window.__delayICE=delay; window.__blockICE=blocked;
      window.__lateSent=0; window.__lateReceived=0; window.__pcs=[]; window.__sockets=[];
      const NativeSocket=WebSocket, NativePC=RTCPeerConnection;
      const clean=m=>{if(m.sdp) m.sdp.sdp=m.sdp.sdp.replace(/^a=(candidate:.*|end-of-candidates)\\r?\\n/gm,'');return m};
      window.RTCPeerConnection=class extends NativePC { constructor(...a) {super(...a);window.__pcs.push(this);} };
      window.WebSocket=class extends NativeSocket {
        constructor(...a) {super(...a);window.__sockets.push(this);}
        set onmessage(fn) {super.onmessage=ev=>{
          let m=clean(JSON.parse(ev.data));
          if(m.type==='ice') {
            if(window.__blockICE)return;
            setTimeout(()=>{window.__lateReceived++;fn.call(this,new MessageEvent('message',{data:JSON.stringify(m)}));},window.__delayICE);
          } else fn.call(this,new MessageEvent('message',{data:JSON.stringify(m)}));
        };}
        send(data) {let m=clean(JSON.parse(data));
          if(m.type==='ice') {
            if(window.__blockICE)return;
            setTimeout(()=>{if(this.readyState===1){window.__lateSent++;super.send(JSON.stringify(m));}},window.__delayICE);
          } else super.send(JSON.stringify(m));
        }
      };
    }"""
    guest.add_init_script(f'({ice_network})({{delay:3500,blocked:false}})')
    guest.goto(f'{args.url}/guest?room={room}&label=Invitada')
    guest.locator('#joinBtn').click()
    expect(guest.locator('#waiting')).to_be_visible(timeout=15000)
    host.locator('#waitroom').get_by_role('button', name='Pasar al backstage', exact=True).click()
    expect(guest.locator('#call')).to_be_visible(timeout=15000)
    expect(host.locator('#backstage .tile')).to_have_count(2, timeout=20000)
    expect(guest.locator('#connection')).to_be_hidden(timeout=20000)
    guest.wait_for_function('() => window.__lateSent>0 && window.__lateReceived>0')
    guest.wait_for_function("""async () => {
      const reports=await Promise.all(window.__pcs.filter(pc=>pc.connectionState==='connected').map(pc=>pc.getStats()));
      return reports.some(r=>[...r.values()].some(s=>s.type==='inbound-rtp' && s.kind==='video' && s.framesDecoded>0));
    }""", timeout=25000)
    host.locator('#backstage .stagebtn').filter(has_text='Al escenario').first.click()
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
    diagnostics.locator('#relay').click()
    expect(diagnostics.locator('#relayResult')).to_contain_text('no tiene TURN', timeout=10000)
    mobile_context=browser.new_context(locale='es-ES',permissions=['camera','microphone'],service_workers='block',has_touch=True,is_mobile=True,viewport={'width':393,'height':851})
    blocked=mobile_context.new_page()
    blocked.on('pageerror',lambda error: errors.append(str(error)))
    blocked.add_init_script(f'({ice_network})({{delay:0,blocked:true}})')
    blocked.goto(f"{args.url}/guest?room={room}&label=SinRuta#invite={keys['inviteKey']}")
    blocked.locator('#joinBtn').click()
    expect(blocked.locator('#call')).to_be_visible(timeout=15000)
    expect(blocked.locator('#connectionText')).to_contain_text('TURN', timeout=40000)
    assert blocked.locator('#retryMedia').count()==0
    assert blocked.evaluate('window.__sockets.length===1'), 'Failed entry must not loop or replace the live socket'
    # A failed initial entry can be retried by reopening the invitation.
    blocked.reload();expect(blocked.locator('#pre')).to_be_visible()
    blocked.evaluate('window.__blockICE=false');blocked.locator('#joinBtn').click()
    blocked.wait_for_function("()=>__pcs.some(pc=>pc.connectionState==='connected'&&pc.getSenders().some(s=>s.track))",timeout=30000)
    expect(blocked.locator('#connection')).to_be_hidden(timeout=20000)
    # Weak signal and Android background/foreground transitions must not
    # recreate any transport, even after the old ten-second warning interval.
    blocked.locator('#micBtn').click()
    blocked.evaluate("""() => {
      window.__camera=document.querySelector('[data-id="me"] video').srcObject.getVideoTracks()[0];
      window.__originalPCs=__pcs.length;
      window.__weak=__pcs.find(p=>p.connectionState==='connected'&&p.getSenders().some(s=>s.track));
      Object.defineProperty(__weak,'connectionState',{configurable:true,value:'disconnected'});
      __weak.dispatchEvent(new Event('connectionstatechange'));
      Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));
    }""")
    blocked.wait_for_timeout(12000)
    assert blocked.evaluate('__sockets.length===1&&__pcs.length===__originalPCs')
    expect(blocked.locator('#connection')).to_be_hidden()
    blocked.evaluate("""()=>{
      delete __weak.connectionState;
      delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('resume'));window.dispatchEvent(new Event('online'));
    }""")
    blocked.wait_for_timeout(1000)
    assert blocked.evaluate('__sockets.length===1&&__pcs.length===__originalPCs')
    assert blocked.evaluate("""() => {
      const media=document.querySelector('[data-id="me"] video').srcObject;
      return media.getVideoTracks()[0]===window.__camera&&window.__camera.readyState==='live'&&media.getAudioTracks().every(t=>!t.enabled);
    }""")
    # Only an actual closed signalling socket causes a silent rejoin.
    blocked.evaluate('window.__sockets.at(-1).close()')
    blocked.wait_for_function('() => window.__sockets.length===2 && window.__sockets.at(-1).readyState===1',timeout=15000)
    blocked.wait_for_function("()=>__pcs.some(pc=>pc.connectionState==='connected'&&pc.getSenders().some(s=>s.track))",timeout=30000)
    expect(blocked.locator('#connection')).to_be_hidden(timeout=20000)
    expect(blocked.locator('#waiting')).to_be_hidden()
    # Exit and return from a real invitation URL. A same-URL #invite link used
    # to leave the closed session and goodbye DOM in place, especially on phones.
    await_return = blocked.url
    for _ in range(2):
        blocked.locator('#leaveBtn').click()
        expect(blocked.get_by_role('heading',name='Saliste de la sala.')).to_be_visible()
        blocked.keyboard.press('m') # Goodbye screen must not use removed controls.
        back=blocked.get_by_role('link',name='Volver a entrar',exact=True)
        target=back.get_attribute('href')
        assert target!=await_return and '#invite=' in target
        back.tap()
        expect(blocked.locator('#pre')).to_be_visible(timeout=15000)
        expect(blocked.locator('#name')).to_have_value('SinRuta')
        blocked.evaluate('window.__blockICE=false')
        blocked.locator('#joinBtn').tap()
        expect(blocked.locator('#call')).to_be_visible(timeout=15000)
        expect(blocked.locator('#connection')).to_be_hidden(timeout=20000)
        assert blocked.evaluate("window.__pcs.some(pc=>pc.connectionState==='connected')")
        await_return=blocked.url
    # Allocation alone is insufficient: the diagnostic must decode generated
    # video after a full publish/subscribe round trip, without opening devices.
    # Emulate a stale CDN/browser copy at every old unversioned module URL.
    cache_context = browser.new_context(locale='es-ES',service_workers='block')
    cache_context.route(args.url+'/js/**', lambda route: route.fulfill(status=200,content_type='text/javascript',body='throw new Error("stale unversioned script");'))
    diagnostic = cache_context.new_page()
    diagnostic.on('pageerror',lambda error:errors.append(str(error)))
    diagnostic.goto(args.url+'/diagnostics')
    diagnostic.locator('#videoRoute').click()
    expect(diagnostic.locator('#videoRouteResult')).to_contain_text('Video enviado al servidor y recibido correctamente', timeout=45000)
    diagnostic.close(); cache_context.close()
    # Safari's engine catches unsupported syntax and DOM assumptions.
    webkit = pw.webkit.launch(headless=True)
    safari_context = webkit.new_context(locale='es-ES')
    safari = safari_context.new_page()
    safari.on('pageerror', lambda error: errors.append('WebKit: '+str(error)))
    safari.goto(args.url+'/diagnostics')
    expect(safari.locator('#checks')).to_contain_text('Conectado', timeout=10000)
    safari_context.close(); webkit.close()
    assert not errors, errors
    print(json.dumps({'ok':True, 'checks':['corrupt storage', 'host camera', 'lobby admission', 'late trickle ICE in both directions', 'guest publication', 'stage', 'OBS media', 'signalling reconnect', 'preflight', 'missing TURN detection', 'failed initial entry has no reconnect button', 'weak signal and background preserve all transports', 'real socket loss recovers silently', 'exit and return twice with invitation fragment', 'WebKit diagnostics'], 'pageErrors':errors}, ensure_ascii=False))
    mobile_context.close(); context.close(); browser.close()
