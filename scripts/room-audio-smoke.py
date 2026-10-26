"""Real multiparty RTP/energy, stale controls, late screen audio and tab recovery.
The fixture uses two local TURN services. Without --fixture the operator master
is read only through a masked prompt; no credentials are printed or saved.
"""
import argparse,getpass,json,math,struct,tempfile,time,urllib.parse,urllib.request,wave
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--url',default='http://localhost:18446');p.add_argument('--browser');p.add_argument('--fixture',action='store_true');p.add_argument('--public-relay-host');p.add_argument('--screenshots');a=p.parse_args()
master='fixture-master-only' if a.fixture else getpass.getpass('Master password (masked): ')
flags=['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']
if a.public_relay_host:
    req=urllib.request.Request('https://cloudflare-dns.com/dns-query?'+urllib.parse.urlencode({'name':a.public_relay_host,'type':'A'}),headers={'accept':'application/dns-json'})
    with urllib.request.urlopen(req,timeout=15) as r:ip=next(x['data'] for x in json.load(r)['Answer'] if x['type']==1)
    flags.append('--host-resolver-rules=MAP '+a.public_relay_host+' '+ip)
INIT='''
window.__pcs=[];window.__sockets=[];window.__sources={};window.__updates=[];window.__providers=[];window.__holdUnsubscribe=false;window.__held=[];window.__answers={};window.__delayScreenAudio=false;window.__audios=[];
const NativeAudio=window.Audio;window.Audio=function(...args){const audio=new NativeAudio(...args);__audios.push(audio);return audio};window.Audio.prototype=NativeAudio.prototype;
const PC=window.RTCPeerConnection;
window.RTCPeerConnection=class extends PC {
 constructor(c){super({...c,iceTransportPolicy:'relay'});__pcs.push(this)}
 async setLocalDescription(sdp){
  if(__delayScreenAudio&&this.getSenders().some(s=>s.track?.kind==='audio')){
   __delayScreenAudio=false;const sender=this.getSenders().find(s=>s.track?.kind==='audio'),track=sender.track;
   await sender.replaceTrack(null);setTimeout(()=>sender.replaceTrack(track).catch(()=>{}),4500);
  }
  return super.setLocalDescription(sdp);
 }
};
const WS=window.WebSocket;
window.WebSocket=class extends WS {
 constructor(...args){super(...args);__sockets.push(this);this.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.type==='welcome')__providers.push(m.relayProvider);for(const s of m.streams||[])__sources[s.id]=s;if(m.info){__sources[m.info.id]=m.info;if(m.type==='stream-updated')__updates.push(m.info.id)}})}
 send(data){const m=JSON.parse(data);if(m.type==='answer')__answers[m.stream]=m;if(m.type==='unsubscribe'&&__holdUnsubscribe){__held.push([this,data]);return}return super.send(data)}
};
window.__flush=()=>{__holdUnsubscribe=false;for(const [ws,data] of __held.splice(0))if(ws.readyState===1)WS.prototype.send.call(ws,data)};
navigator.mediaDevices.getDisplayMedia=async()=>{
 const media=document.querySelector('[data-id="me"] video, #backstage [data-id="host-camera"] video').srcObject;
 return new MediaStream(media.getTracks().filter(t=>!window.__screenNoAudio||t.kind==='video').map(t=>t.clone()));
};
'''
AUDIO='''async selector=>{
 const track=document.querySelector(selector)?.srcObject?.getAudioTracks()[0];if(!track)return null;
 const pc=__pcs.find(p=>p.connectionState==='connected'&&p.getReceivers().some(r=>r.track.id===track.id));if(!pc)return null;
 let bytes=0,energy=0;for(const s of(await pc.getStats()).values())if(s.type==='inbound-rtp'&&s.kind==='audio'){bytes+=s.bytesReceived||0;energy+=s.totalAudioEnergy||0}
 return {bytes,energy};
}'''
def advancing(page,selector):
    limit=time.monotonic()+40;before=None
    while time.monotonic()<limit:
        now=page.evaluate(AUDIO,selector)
        if now and now['bytes']>0 and now['energy']>0:
            if before and now['bytes']>before['bytes'] and now['energy']>before['energy']:return
            before=before or now
        page.wait_for_timeout(150)
    raise AssertionError('Received audio did not advance: '+selector)

with tempfile.TemporaryDirectory(prefix='swr-multiparty-') as folder,sync_playwright() as pw:
    tone=Path(folder)/'tone.wav'
    with wave.open(str(tone),'wb') as w:
        w.setparams((1,2,48000,0,'NONE','not compressed'));w.writeframes(b''.join(struct.pack('<h',int(8000*math.sin(2*math.pi*440*i/48000))) for i in range(144000)))
    browser=pw.chromium.launch(headless=True,executable_path=a.browser,args=flags+['--use-file-for-fake-audio-capture='+str(tone)])
    ctx=browser.new_context(permissions=['camera','microphone'],service_workers='block',viewport={'width':1440,'height':1000});ctx.add_init_script(INIT)
    keys=ctx.request.post(a.url+'/api/rooms',data={'room':'audio-'+str(time.time_ns()),'password':'InternalTestOnly'}).json()
    errors=[]
    def page():
        item=ctx.new_page();item.on('pageerror',lambda e:errors.append(str(e)));return item
    host=page();host.goto(a.url+'/studio?room='+keys['room']+'#key='+keys['hostKey']);expect(host.locator('#status')).to_have_text('conectado',timeout=30000)
    host.locator('#addCam').click();expect(host.locator('#backstage [data-id="host-camera"]')).to_be_visible(timeout=40000)
    host.locator('#studioViewMenu summary').click();host.locator('#relayInfo').click();host.locator('#cloudflareMaster').fill(master);host.locator('#useCloudflare').click();host.locator('#closeRelayDialog').click();expect(host.locator('#status')).to_have_text('conectado',timeout=45000)
    host.wait_for_function('()=>__providers.at(-1)==="cloudflare"',timeout=45000)
    guests=[]
    for label in ['A','B','C']:
        g=page();g.goto(a.url+'/guest?room='+keys['room']+'&label=Panelista-'+label+'#invite='+keys['inviteKey']);g.locator('#pw').fill('InternalTestOnly');g.locator('#joinBtn').click();expect(g.locator('#connection')).to_be_hidden(timeout=45000);guests.append(g)
    expect(host.locator('#backstage .tile')).to_have_count(4,timeout=45000)
    ids=['host-camera']+[host.locator('#backstage .tile').filter(has_text='Panelista-'+label).get_attribute('data-id') for label in ['A','B','C']]
    participants=[host]+guests
    def all_audio():
        for receiver,item in enumerate(participants):
            assert item.evaluate('__providers.at(-1)')=='cloudflare'
            if receiver:assert item.locator('audio[data-room-audio="'+ids[receiver]+'"]').count()==0
            for sender,source in enumerate(ids):
                if receiver==sender:continue
                selector=('[data-id="'+source+'"] video')
                advancing(item,selector)
                if receiver:
                    assert item.locator('audio[data-room-audio="'+source+'"]').evaluate('e=>!e.paused&&!e.muted&&e.srcObject.getAudioTracks().length>0')
    all_audio()
    for repeat in range(3):
        victim,observer=guests[0],guests[1]
        observer.evaluate('id=>{window.__oldInfo=__sources[id];window.__oldAnswer=__answers[id];__holdUnsubscribe=true}',ids[1])
        victim.evaluate('()=>__sockets.at(-1).close()')
        victim.wait_for_function('()=>__sockets.at(-1).readyState===1&&__pcs.some(p=>p.connectionState==="connected"&&p.getSenders().some(s=>s.track))',timeout=45000)
        all_audio()
        observer.evaluate('''id=>{__flush();if(__oldAnswer)__sockets.at(-1).send(JSON.stringify(__oldAnswer));__sockets.at(-1).dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'stream-removed',stream:id,revision:__oldInfo.revision})}));__sockets.at(-1).dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'stream-added',info:__oldInfo})}))}''',ids[1])
        all_audio()
    # Video may be paused by Android while its separate audio remains audible.
    mobile=guests[2]
    mobile.evaluate('''()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));for(const v of document.querySelectorAll('#grid video'))v.pause()}''')
    all_audio()
    mobile.evaluate('''()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))}''')
    all_audio()
    # A real delayed audio RTP track reaches the SFU after the initial offer.
    host.evaluate('__delayScreenAudio=true');host.locator('#addScreen').click();expect(host.locator('#backstage [data-id="host-screen"]')).to_be_visible(timeout=30000)
    expect(host.locator('#backstage [data-id="host-screen"] .stagebtn.on')).to_be_visible(timeout=15000)
    for g in guests:advancing(g,'[data-id="host-screen"] video')
    guests[1].wait_for_function('()=>__updates.includes("host-screen")',timeout=20000)
    obs=page();obs.goto(a.url+'/view?room='+keys['room']+'&stream=host-screen#key='+keys['viewKey']);advancing(obs,'#single')
    scene=page();scene.goto(a.url+'/view?room='+keys['room']+'&scene=1#key='+keys['viewKey'])
    scene_ready=False;scene_deadline=time.monotonic()+40
    while time.monotonic()<scene_deadline:
        scene_ready=scene.evaluate('''async()=>{for(const pc of __pcs){if(pc.connectionState!=='connected'||!pc.remoteDescription?.sdp.includes('host-screen'))continue;const track=pc.getReceivers().find(r=>r.track.kind==='audio')?.track;if(!track)continue;const stats=await pc.getStats();const received=[...stats.values()].some(s=>s.type==='inbound-rtp'&&s.kind==='audio'&&s.totalAudioEnergy>0);if(received&&__audios.some(a=>!a.paused&&!a.muted&&a.volume>0&&a.srcObject?.getAudioTracks().some(t=>t.id===track.id)))return true}return false}''')
        if scene_ready:break
        scene.wait_for_timeout(150)
    assert scene_ready,'Screen audio was not audible in the OBS scene'
    # An authorized panelist also shares audio to the host and other panelists.
    host.locator('#backstage [data-id="'+ids[1]+'"] .stagebtn').click()
    guests[0].locator('#screenBtn').click();host.get_by_role('button',name='Autorizar pantalla',exact=True).click();guests[0].locator('#startScreen').click()
    guest_screen=host.locator('#backstage [data-kind="screen"]:not([data-id="host-screen"])');expect(guest_screen).to_have_count(1,timeout=30000);screen_id=guest_screen.get_attribute('data-id')
    advancing(host,'[data-id="'+screen_id+'"] video')
    for g in guests[1:]:advancing(g,'[data-id="'+screen_id+'"] video')
    if a.screenshots:
        Path(a.screenshots).mkdir(parents=True,exist_ok=True);host.screenshot(path=str(Path(a.screenshots)/'audio-recovery-host.png'));guests[1].screenshot(path=str(Path(a.screenshots)/'audio-recovery-guest.png'))
    assert not errors,errors
    print(json.dumps({'fixture':a.fixture,'participants':4,'reconnections':3,'allDirectedAudioPairs':12,'staleControlsIgnored':True,'staleSourceEventsIgnored':True,'videoPausedAudioContinues':True,'lateHostScreenAudio':True,'guestScreenAudio':True,'obsScreenAudio':True,'pageErrors':errors}),flush=True)
    ctx.close();browser.close()
