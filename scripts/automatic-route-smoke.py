"""Verify automatic guest admission and real video without selecting a route."""
import argparse
import json
import os
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument('--url',required=True)
parser.add_argument('--browser')
parser.add_argument('--room',required=True,help='Disposable password-protected room with Cloudflare already enabled by its host. Set SWR_TEST_HOST_KEY and SWR_TEST_ROOM_PASSWORD in the environment, never command arguments.')
args=parser.parse_args()
host_key=os.environ.get('SWR_TEST_HOST_KEY','');room_password=os.environ.get('SWR_TEST_ROOM_PASSWORD','')
if not host_key or not room_password:parser.error('Set SWR_TEST_HOST_KEY and SWR_TEST_ROOM_PASSWORD for the disposable test room')

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path=args.browser,args=['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required'])
    for block_primary in [False, True]:
        context=browser.new_context(permissions=['camera','microphone'],service_workers='block')
        host=context.new_page();host.goto(args.url+'/diagnostics')
        cfg=host.evaluate("fetch('/api/config').then(r=>r.json())")
        assert cfg.get('relay',{}).get('provider')=='local' and cfg.get('localIce'), 'Public config must remain local'
        keys={'room':args.room,'hostKey':host_key}
        host.evaluate("""async keys=>{
          const rtc=await import('/js/rtc.js'); window.rtc=rtc; window.sig=new rtc.Signal();
          sig.on('stream-added',m=>{window.guestStream=m.info.id;});
          const welcome=await sig.connect({type:'join',role:'host',room:keys.room,key:keys.hostKey});
          if(welcome.relayProvider!=='cloudflare')throw Error('Enable Cloudflare on this protected test room first');
          window.inviteKey=welcome.keys.inviteKey;
        }""",keys)
        guest=context.new_page(); errors=[]
        guest.on('pageerror',lambda e:errors.append(str(e)))
        guest.add_init_script("""window.__joins=[];window.__pcs=[];
          const NativeWS=WebSocket,NativePC=RTCPeerConnection;
          window.WebSocket=class extends NativeWS {send(data){const m=JSON.parse(data);if(m.type==='join')window.__joins.push({room:m.room,role:m.role,route:m.route||''});return super.send(data);}};
          window.RTCPeerConnection=class extends NativePC {constructor(c){
            const urls=(c?.iceServers||[]).flatMap(s=>[s.urls].flat());
            if(BLOCK_PRIMARY&&urls.some(u=>u.includes('turn.cloudflare.com')))throw new Error('simulated primary transport failure');
            super(c);window.__pcs.push(this);
          }};""".replace('BLOCK_PRIMARY',str(block_primary).lower()))
        guest.goto(args.url+'/guest?room='+keys['room']+'&label=AutomaticTest#invite='+host.evaluate('window.inviteKey'))
        guest.locator('#pw').fill(room_password)
        expect(guest.locator('#networkMode')).to_have_value('auto')
        guest.locator('#joinBtn').click()
        expect(guest.locator('#call')).to_be_visible(timeout=45000)
        expect(guest.locator('#connection')).to_be_hidden(timeout=35000)
        joins=guest.evaluate('window.__joins')
        actual=[j for j in joins if j['role']=='guest' and j['room']==keys['room']]
        want='local' if block_primary else ''
        assert len(actual)==1 and actual[0]['route']==want,joins
        assert any(j['room']!=keys['room'] and j['role']=='host' for j in joins), 'No media check before actual admission'
        host.wait_for_function('() => !!window.guestStream',timeout=15000)
        host.evaluate("""async()=>{window.sub=await rtc.subscribe(sig,guestStream);const v=document.createElement('video');v.muted=true;v.srcObject=sub.stream;document.body.append(v);await v.play();}""")
        host.wait_for_function("""async()=>[...(await sub.pc.getStats()).values()].some(s=>s.type==='inbound-rtp'&&s.kind==='video'&&s.framesDecoded>0)""",timeout=20000)
        assert not errors,errors
        host.evaluate('sig.close()')
        print(json.dumps({'automaticAdmission':True,'primaryUnavailable':block_primary,'selectedRoute':'local' if block_primary else 'cloudflare-auto','decodedGuestVideo':True}),flush=True)
        context.close()
    browser.close()
