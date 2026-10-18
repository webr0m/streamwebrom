"""End-to-end TURN/TCP regression; start scripts/turn-smoke-server.go first.
The disposable SFU must use -turn turn:127.0.0.1:13478?transport=tcp
-turn-user swr-test -turn-pass test-only -stun= and listen on the given URL.
"""
import argparse
import json
import time
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument('--url',default='http://localhost:18444')
parser.add_argument('--browser')
args=parser.parse_args()

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path=args.browser,args=['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required'])
    ctx=browser.new_context(permissions=['camera','microphone'],service_workers='block')
    ctx.add_init_script("""const NativePC=RTCPeerConnection;
      window.RTCPeerConnection=class extends NativePC {constructor(c){super({...c,iceTransportPolicy:'relay'});}};""")
    errors=[]
    host=ctx.new_page();host.on('pageerror',lambda e:errors.append(str(e)))
    host.goto(args.url+'/diagnostics');host.locator('#relay').click()
    expect(host.locator('#relayResult')).to_contain_text('Se obtuvo una ruta TURN',timeout=20000)
    keys=ctx.request.post(args.url+'/api/rooms',data={'room':f'relay-{int(time.time())}','lobby':False}).json()
    host.evaluate("""async keys=>{
      const rtc=await import('/js/rtc.js'); window.rtc=rtc;window.sig=new rtc.Signal();
      await sig.connect({type:'join',room:keys.room,role:'host',key:keys.hostKey});
      window.media=await navigator.mediaDevices.getUserMedia({audio:true,video:true});
      window.pub=await rtc.publish(sig,media,{name:'TURN host'});
    }""",keys)
    guest=ctx.new_page();guest.on('pageerror',lambda e:errors.append(str(e)));guest.goto(args.url+'/diagnostics')
    guest.evaluate("""async ({keys,stream})=>{
      const rtc=await import('/js/rtc.js');window.rtc=rtc;window.sig=new rtc.Signal();
      await sig.connect({type:'join',room:keys.room,role:'guest',name:'TURN guest'});
      window.media=await navigator.mediaDevices.getUserMedia({audio:true,video:true});
      window.pub=await rtc.publish(sig,media);
      window.sub=await rtc.subscribe(sig,stream);
      const video=document.createElement('video');video.autoplay=true;video.muted=true;video.srcObject=sub.stream;document.body.append(video);await video.play();
    }""",{'keys':keys,'stream':host.evaluate('pub.id')})
    guest.wait_for_function("""async()=>[... (await sub.pc.getStats()).values()].some(s=>s.type==='inbound-rtp'&&s.kind==='video'&&s.framesDecoded>0)""",timeout=20000)
    relay=guest.evaluate("""async()=>{
      const stats=await sub.pc.getStats();const t=[...stats.values()].find(s=>s.type==='transport'&&s.selectedCandidatePairId);
      const pair=stats.get(t.selectedCandidatePairId),local=stats.get(pair.localCandidateId);
      return {type:local.candidateType,relayProtocol:local.relayProtocol};
    }""")
    assert relay['type']=='relay' and relay['relayProtocol']=='tcp',relay
    assert not errors,errors
    print(json.dumps({'ok':True,'checks':['TURN allocation','relay-only publish','relay-only subscribe','decoded video over TURN/TCP'],'selectedCandidate':relay,'pageErrors':errors}))
    for page in [host,guest]:page.evaluate('pub.stop();media.getTracks().forEach(t=>t.stop());sig.close()')
    ctx.close();browser.close()
