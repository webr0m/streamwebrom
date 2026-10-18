"""End-to-end TURN/TCP regression; start scripts/turn-smoke-server.go first.
The disposable SFU must use -turn turn:127.0.0.1:13478?transport=tcp
-turn-user swr-test -turn-pass test-only -stun= and listen on the given URL.
"""
import argparse
import json
import os
import time
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument('--url',default='http://localhost:18444')
parser.add_argument('--browser')
parser.add_argument('--tcp-only', action='store_true', help='Filter native relay URLs to test TURN/TCP explicitly')
parser.add_argument('--expect-provider', choices=['cloudflare','local'])
parser.add_argument('--expect-cutoff',action='store_true',default=os.getenv('EXPECT_CUTOFF')=='true',help='Keep media active and require automatic Cloudflare-to-local reconnection')
args=parser.parse_args()

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path=args.browser,args=['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required'])
    ctx=browser.new_context(permissions=['camera','microphone'],service_workers='block')
    ctx.add_init_script("""const NativePC=RTCPeerConnection;
      window.RTCPeerConnection=class extends NativePC {constructor(c){super({...c,iceTransportPolicy:'relay',
        iceServers:(c?.iceServers||[]).map(s=>({...s,urls:(Array.isArray(s.urls)?s.urls:[s.urls]).filter(u=>!TCP_ONLY||u.includes('transport=tcp'))})).filter(s=>s.urls.length)});
        this.addEventListener('icecandidate',({candidate:c})=>{if(c)console.info('[relay-check] local',c.type,c.protocol,c.relayProtocol||'');});
        this.addEventListener('iceconnectionstatechange',()=>console.info('[relay-check] ICE',this.iceConnectionState));
      }};""".replace('TCP_ONLY',str(args.tcp_only).lower()))
    errors=[]
    host=ctx.new_page();host.on('pageerror',lambda e:errors.append(str(e)))
    host.on('console',lambda m:print(m.text,flush=True) if m.text.startswith('[relay-check]') else None)
    response=host.goto(args.url+'/diagnostics')
    if not response.ok: raise RuntimeError(f'Diagnostics page returned HTTP {response.status}: {host.title()}')
    if args.expect_provider:
        actual=host.evaluate("fetch('/api/config').then(async r=>{if(!r.ok)throw Error('config HTTP '+r.status);return r.json()})").get('relay',{}).get('provider')
        assert actual == args.expect_provider,{'expected':args.expect_provider,'actual':actual}
    host.locator('#relay').click()
    expect(host.locator('#relayResult')).to_contain_text('Se obtuvo una ruta TURN',timeout=20000)
    keys=host.evaluate("""async body=>{const r=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('room HTTP '+r.status);return r.json()}""",{'room':f'relay-{int(time.time())}','lobby':False})
    host.evaluate("""async keys=>{
      const rtc=await import('/js/rtc.js'); window.rtc=rtc;window.sig=new rtc.Signal();
      sig.on('ice',m=>{const c=m.candidate?.candidate||'';console.info('[relay-check] remote',c.split(' typ ')[1]?.split(' ')[0]||'',c.split(' ')[2]||'');});
      await sig.connect({type:'join',room:keys.room,role:'host',key:keys.hostKey});
      window.media=await navigator.mediaDevices.getUserMedia({audio:true,video:true});
      window.pub=await rtc.publish(sig,media,{name:'TURN host'});
      if(pub.pc.canTrickleIceCandidates!==true)throw Error('SFU answer must advertise trickle ICE');
      window.hostStream=pub.id;
      sig.on('reconnected',async()=>{try{pub=await rtc.publish(sig,media,{name:'TURN host',stream:hostStream});window.relayRejoined=true;}catch(e){window.recoveryError=e.message;}});
    }""",keys)
    guest=ctx.new_page();guest.on('pageerror',lambda e:errors.append(str(e)));guest.goto(args.url+'/diagnostics')
    guest.evaluate("""async ({keys,stream})=>{
      const rtc=await import('/js/rtc.js');window.rtc=rtc;window.sig=new rtc.Signal();
      await sig.connect({type:'join',room:keys.room,role:'guest',name:'TURN guest'});
      window.media=await navigator.mediaDevices.getUserMedia({audio:true,video:true});
      window.pub=await rtc.publish(sig,media);
      window.sub=await rtc.subscribe(sig,stream);
      if(sub.pc.canTrickleIceCandidates!==true)throw Error('SFU offer must advertise trickle ICE');
      const video=document.createElement('video');video.autoplay=true;video.muted=true;video.srcObject=sub.stream;document.body.append(video);await video.play();
      sig.on('reconnected',async()=>{try{
        pub=await rtc.publish(sig,media,{stream:pub.id});
        for(let i=0;i<20;i++){try{sub=await rtc.subscribe(sig,stream);break;}catch(e){if(i===19)throw e;await new Promise(r=>setTimeout(r,500));}}
        video.srcObject=sub.stream;await video.play();window.relayRejoined=true;
      }catch(e){window.recoveryError=e.message;}});
    }""",{'keys':keys,'stream':host.evaluate('pub.id')})
    guest.wait_for_function("""async()=>[... (await sub.pc.getStats()).values()].some(s=>s.type==='inbound-rtp'&&s.kind==='video'&&s.framesDecoded>0)""",timeout=20000)
    relay=guest.evaluate("""async()=>{
      const stats=await sub.pc.getStats();const t=[...stats.values()].find(s=>s.type==='transport'&&s.selectedCandidatePairId);
      const pair=stats.get(t.selectedCandidatePairId),local=stats.get(pair.localCandidateId);
      return {type:local.candidateType,relayProtocol:local.relayProtocol};
    }""")
    assert relay['type']=='relay' and relay['relayProtocol'] in ('tcp','tls'),relay
    if args.expect_cutoff:
        for page in [host,guest]:
            page.wait_for_function('() => window.relayRejoined || window.recoveryError',timeout=150000)
            assert page.evaluate('window.relayRejoined===true'),page.evaluate('window.recoveryError')
        guest.wait_for_function("""async()=>[...(await sub.pc.getStats()).values()].some(s=>s.type==='inbound-rtp'&&s.kind==='video'&&s.framesDecoded>0)""",timeout=20000)
        assert host.evaluate("fetch('/api/config').then(r=>r.json()).then(c=>c.relay.provider==='local'&&c.relay.reason==='quota')")
        print(json.dumps({'automaticQuotaFailover':True,'decodedVideoAfterReconnect':True}),flush=True)
    assert not errors,errors
    print(json.dumps({'ok':True,'checks':['TURN allocation','relay-only publish','relay-only subscribe','decoded video over TURN/TCP'],'selectedCandidate':relay,'pageErrors':errors}))
    for page in [host,guest]:page.evaluate('pub.stop();media.getTracks().forEach(t=>t.stop());sig.close()')
    ctx.close();browser.close()
