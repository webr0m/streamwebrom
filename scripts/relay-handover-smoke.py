"""Actual audio/video during provider changes. --fixture uses two independent
loopback TURN/TCP servers, not Cloudflare. Production accepts the master only
from a masked prompt or the explicitly named environment variable."""
import argparse, getpass, json, math, os, struct, tempfile, time, urllib.parse, urllib.request, wave
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

p=argparse.ArgumentParser()
p.add_argument('--url',default='http://localhost:18446');p.add_argument('--browser')
p.add_argument('--fixture',action='store_true');p.add_argument('--master-env')
p.add_argument('--public-relay-host');p.add_argument('--preview-js',help='Preview changed modules against an existing installation')
args=p.parse_args();origin=args.url.rstrip('/')
master='fixture-master-only' if args.fixture else os.environ[args.master_env] if args.master_env else getpass.getpass('Master password (masked): ')
flags=['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']
if args.public_relay_host:
    req=urllib.request.Request('https://cloudflare-dns.com/dns-query?'+urllib.parse.urlencode({'name':args.public_relay_host,'type':'A'}),headers={'accept':'application/dns-json'})
    with urllib.request.urlopen(req,timeout=15) as r:dns=json.load(r)
    ip=next(x['data'] for x in dns['Answer'] if x['type']==1)
    flags.append('--host-resolver-rules=MAP '+args.public_relay_host+' '+ip)

INIT='''
window.__pcs=[];window.__sockets=[];window.__providers=[];window.__delayPublisher=false;
const PC=window.RTCPeerConnection;
window.RTCPeerConnection=class extends PC {
 constructor(config){super({...config,iceTransportPolicy:'relay'});window.__pcs.push(this)}
 async createOffer(...args){if(window.__delayPublisher&&this.getSenders().some(s=>s.track))await new Promise(r=>setTimeout(r,1250));return super.createOffer(...args)}
};
const WS=window.WebSocket;
window.WebSocket=class extends WS {constructor(...args){super(...args);window.__sockets.push(this);this.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.type==='welcome')window.__providers.push(m.relayProvider)})}};
const enumerate=navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices),capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.enumerateDevices=async()=>[...await enumerate(),{kind:'videoinput',deviceId:'fixture-extra',groupId:'fixture',label:'Fixture extra'}];
navigator.mediaDevices.getUserMedia=c=>{if(c.video?.deviceId?.exact==='fixture-extra')c={...c,video:{...c.video,deviceId:undefined}};return capture(c)};
'''

AUDIO='''async selector=>{
 const track=document.querySelector(selector)?.srcObject?.getAudioTracks()[0];if(!track)return null;
 const pc=window.__pcs.find(p=>p.connectionState==='connected'&&p.getReceivers().some(r=>r.track?.id===track.id));if(!pc)return null;
 const report=await pc.getStats();let bytes=0,energy=0;
 for(const s of report.values())if(s.type==='inbound-rtp'&&(s.kind==='audio'||s.mediaType==='audio')){bytes+=s.bytesReceived||0;energy+=s.totalAudioEnergy||0}
 return {bytes,energy,live:track.readyState==='live'};
}'''

def audio_advances(page,selector):
    deadline=time.monotonic()+40;before=None;current=None
    while time.monotonic()<deadline:
        current=page.evaluate(AUDIO,selector)
        if current and current['live'] and current['bytes']>0 and current['energy']>0:
            if before and current['bytes']>before['bytes'] and current['energy']>before['energy']:return
            if before is None:before=current
        page.wait_for_timeout(150)
    raise AssertionError(('Audio did not advance',selector,current,page.evaluate('()=>__pcs.map(p=>({state:p.connectionState,receive:p.getReceivers().map(r=>r.track.kind)}))')))

with tempfile.TemporaryDirectory(prefix='swr-audio-') as folder, sync_playwright() as pw:
    wav=Path(folder)/'tone.wav'
    with wave.open(str(wav),'wb') as w:
        w.setparams((1,2,48000,0,'NONE','not compressed'))
        w.writeframes(b''.join(struct.pack('<h',int(8000*math.sin(2*math.pi*440*i/48000))) for i in range(48000*3)))
    browser=pw.chromium.launch(headless=True,executable_path=args.browser,args=flags+['--use-file-for-fake-audio-capture='+str(wav)])
    ctx=browser.new_context(locale='es-ES',permissions=['camera','microphone'],service_workers='block',viewport={'width':1440,'height':1000})
    ctx.add_init_script(INIT)
    if args.preview_js:
        for name in ['studio.js','guest.js','rtc.js','connection-health.js']:
            ctx.route('**/js/'+name,lambda r,request,name=name:r.fulfill(content_type='text/javascript',body=Path(args.preview_js,name).read_text(encoding='utf8')))
    keys=ctx.request.post(origin+'/api/rooms',data={'room':'handover-'+str(time.time_ns()),'password':'FixtureRoomOnly','title':'Prueba interna de audio'}).json()
    errors=[];host=ctx.new_page();guest=ctx.new_page()
    for page in [host,guest]:page.on('pageerror',lambda e:errors.append(str(e)))
    host.goto(origin+'/studio?room='+keys['room']+'#key='+keys['hostKey']);expect(host.locator('#status')).to_have_text('conectado',timeout=30000)
    host.locator('#addCam').click();expect(host.locator('#backstage [data-id="host-camera"]')).to_be_visible(timeout=35000)
    host.evaluate('()=>{const s=document.querySelector("#backstage [data-id=host-camera] video").srcObject;window.__camera=s.getVideoTracks()[0];window.__mic=s.getAudioTracks()[0]}')
    guest.goto(origin+'/guest?room='+keys['room']+'&label=Panelista#invite='+keys['inviteKey']);guest.locator('#pw').fill('FixtureRoomOnly');guest.locator('#joinBtn').click()
    expect(guest.locator('#connection')).to_be_hidden(timeout=45000)
    expect(host.locator('#backstage .tile')).to_have_count(2,timeout=35000)
    guest_id=host.locator('#backstage .tile:not([data-id="host-camera"])').get_attribute('data-id')
    audio_advances(guest,'[data-id="host-camera"] video');audio_advances(host,'[data-id="'+guest_id+'"] video')

    # Delay new guest publication so the host stream arrives during that await.
    guest.evaluate('window.__delayPublisher=true')
    guest.locator('#cam2Btn').click();guest.get_by_role('button',name='Fixture extra',exact=True).click()
    expect(guest.locator('#grid .tile')).to_have_count(3,timeout=35000)
    extra=guest.locator('#grid .tile:not([data-id="me"]):not([data-id="host-camera"])').get_attribute('data-id')
    guest.evaluate('id=>window.__extraTrack=document.querySelector(`[data-id="${id}"] video`).srcObject.getVideoTracks()[0]',extra)
    # Reproduce a late stream-removed for the old host transport deterministically.
    host.evaluate('()=>__sockets.at(-1).dispatchEvent(new MessageEvent("message",{data:JSON.stringify({type:"stream-removed",stream:"host-camera"})}))')
    expect(host.locator('#backstage [data-id="host-camera"]')).to_be_visible()
    guest.evaluate('''()=>{window.__retryPrompts=0;new MutationObserver(()=>{if(!document.querySelector('#connection').classList.contains('hidden'))window.__retryPrompts++}).observe(document.querySelector('#connection'),{attributes:true,subtree:true})}''')
    for provider in ['cloudflare','local','cloudflare']:
        host.locator('#studioViewMenu summary').click();host.locator('#relayInfo').click()
        if provider=='cloudflare':host.locator('#cloudflareMaster').fill(master);host.locator('#useCloudflare').click()
        else:host.locator('#useLocalRelay').click()
        host.locator('#closeRelayDialog').click()
        for page in [host,guest]:page.wait_for_function('p=>__providers.at(-1)===p',arg=provider,timeout=45000)
        expect(host.locator('#status')).to_have_text('conectado',timeout=45000)
        audio_advances(guest,'[data-id="host-camera"] video');audio_advances(host,'[data-id="'+guest_id+'"] video')
        assert host.evaluate('()=>{const s=document.querySelector("[data-id=host-camera] video").srcObject;return s.getVideoTracks()[0]===__camera&&s.getAudioTracks()[0]===__mic&&__mic.enabled&&__mic.readyState==="live"}')
        assert guest.evaluate('id=>document.querySelector(`[data-id="${id}"] video`)?.srcObject?.getVideoTracks()[0]===__extraTrack&&__extraTrack.readyState==="live"',extra)
        assert guest.evaluate('window.__retryPrompts')==0
    # Removing an additional camera after recovery must stop its new publication.
    guest.locator('[data-id="'+extra+'"] .tileclose').click()
    expect(host.locator('#backstage [data-id="'+extra+'"]')).to_have_count(0,timeout=15000)
    # The transport remains real and carries packets while reported states are
    # deliberately made pessimistic; this must not show a reconnect prompt.
    guest.evaluate('''()=>{const pc=__pcs.find(p=>p.connectionState==='connected'&&p.getSenders().some(s=>s.track));window.__suspectPC=pc;Object.defineProperty(pc,'connectionState',{configurable:true,value:'disconnected'});Object.defineProperty(pc,'iceConnectionState',{configurable:true,value:'disconnected'});pc.dispatchEvent(new Event('connectionstatechange'))}''')
    guest.wait_for_timeout(12000);assert guest.evaluate('window.__retryPrompts')==0
    guest.evaluate('()=>{delete __suspectPC.connectionState;delete __suspectPC.iceConnectionState;__suspectPC.dispatchEvent(new Event("connectionstatechange"))}')
    audio_advances(host,'[data-id="'+guest_id+'"] video')
    assert not errors,errors
    print(json.dumps({'fixture':args.fixture,'independentLocalTURNProviders':args.fixture,'providerSwitches':3,'bidirectionalAudioPacketsAndEnergy':True,'sameHostCameraAndMic':True,'lateHostStreamSurvivesGuestResume':True,'extraCameraRestoredAndClosed':True,'noFalseReconnectPrompts':True,'pageErrors':errors}),flush=True)
    ctx.close();browser.close()
