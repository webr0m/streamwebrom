"""First-party UI/RTC regression. Official VDO frames are stubbed deliberately;
this verifies interoperability URLs and permissions, not external TURN latency."""
import argparse, json, time, urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

p=argparse.ArgumentParser();p.add_argument('--url',default='http://localhost:18443');p.add_argument('--browser');p.add_argument('--screenshots');p.add_argument('--css',help='Preview a working-tree stylesheet against an existing disposable server');args=p.parse_args()
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path=args.browser,args=['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required'])
    ctx=browser.new_context(viewport={'width':1440,'height':1000},permissions=['camera','microphone'],service_workers='block')
    if args.css:ctx.route('**/css/app.css',lambda route:route.fulfill(content_type='text/css',body=Path(args.css).read_text(encoding='utf8')))
    ctx.route('https://vdo.ninja/**',lambda route:route.fulfill(content_type='text/html',body='<title>Official app fixture</title><body style="margin:0;background:#182233;color:white">External application fixture</body>'))
    page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    creates=[];page.on('request',lambda r:creates.append(r.url) if r.method=='POST' and r.url.endswith('/api/rooms') else None)
    page.goto(args.url+'/');page.locator('#roomEngine').select_option('vdo');expect(page.locator('#lobby')).to_be_disabled()
    page.locator('#title').fill('Producción independiente');page.locator('#pw').fill('VdoTestOnly')
    page.locator('#room').fill('a'*32)
    page.locator('#create').click();expect(page.locator('#vdoDirectorMount iframe')).to_be_attached()
    assert '/vdo?room=' in page.url and not creates,'VDO mode created a local SFU room'
    assert len(page.locator('iframe').all())==2
    src=page.locator('#vdoDirectorMount iframe').get_attribute('src')
    assert src.startswith('https://vdo.ninja/?director=') and '#p=' in src and 'codirector=' in src
    room=urllib.parse.parse_qs(urllib.parse.urlsplit(src).query)['director'][0]
    assert room.isalnum() and len(room)<=30,'Official application would trim the room name'
    assert urllib.parse.parse_qs(urllib.parse.urlsplit(page.locator('#vdoSceneMount iframe').get_attribute('src')).query)['room']==[room]
    for w,h in [(1440,1000),(1024,768),(390,844),(844,390)]:
        page.set_viewport_size({'width':w,'height':h});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),(w,h,page.evaluate('Array.from(document.querySelectorAll("body *")).filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({id:e.id,tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right})).slice(0,10)'))
        rect=page.locator('#vdoStage').bounding_box();assert abs(rect['width']/rect['height']-16/9)<.02
    page.locator('#vdoRoomSidebar').click();expect(page.locator('#vdoRoomSide')).to_be_hidden()
    page.locator('#vdoRoomFullscreen').click();expect(page.locator('#vdoStage')).to_have_class('vdo-room-stage cinema')
    page.locator('#vdoExitFullscreen').click()

    # A v1.11.0 room could exceed the upstream limit before its random suffix.
    # Both the saved host and an old guest invitation must recover the same ID.
    legacy={'room':'a'*32+'-'+'0123456789abcdef0123456789abcdef','password':'VdoTestOnly','directorKey':'f'*32,'title':'Previous room'}
    page.evaluate('r=>sessionStorage.setItem("swr.vdoRooms",JSON.stringify({[r.room]:r}))',legacy)
    page.goto(args.url+'/vdo?room='+legacy['room'])
    expect(page.locator('#vdoDirectorMount iframe')).to_be_attached()
    repaired=urllib.parse.parse_qs(urllib.parse.urlsplit(page.locator('#vdoDirectorMount iframe').get_attribute('src')).query)['director'][0]
    assert repaired.isalnum() and len(repaired)<=30
    assert urllib.parse.parse_qs(urllib.parse.urlsplit(page.url).query)['room']==[repaired]
    assert page.evaluate('old=>!JSON.parse(sessionStorage.getItem("swr.vdoRooms"))[old]',legacy['room'])
    page.reload();expect(page.locator('#vdoDirectorMount iframe')).to_be_attached()
    page.goto(args.url+'/vdo?room='+legacy['room']+'&role=guest#p=VdoTestOnly')
    expect(page.locator('#vdoSceneMount iframe')).to_be_attached()
    assert page.locator('#vdoDirectorMount iframe').count()==0
    assert urllib.parse.parse_qs(urllib.parse.urlsplit(page.locator('#vdoSceneMount iframe').get_attribute('src')).query)['room']==[repaired]
    page.evaluate('()=>sessionStorage.setItem("swr.vdoRooms",JSON.stringify({broken:{room:"bad room",password:"test",directorKey:"test"}}))')
    page.goto(args.url+'/');expect(page.locator('#create')).to_be_enabled()

    k=ctx.request.post(args.url+'/api/rooms',data={'room':'options-'+str(time.time_ns()),'password':'RoomTestOnly'}).json()
    page.set_viewport_size({'width':1440,'height':1000})
    page.add_init_script('window.__pcs=[];const PC=window.RTCPeerConnection;window.RTCPeerConnection=class extends PC{constructor(...args){super(...args);window.__pcs.push(this)}}')
    page.goto(args.url+'/studio?room='+k['room']+'#key='+k['hostKey']);expect(page.locator('#status')).to_have_text('conectado')
    page.locator('#addCam').click();expect(page.locator('#backstage .tile')).to_have_count(1,timeout=15000)
    assert page.locator('#backstage .tile button').count()==2
    small=page.locator('#backstage .tile video').bounding_box()
    page.locator('#backstage .source-options').click();expect(page.locator('#sourceSettings')).to_be_visible()
    large=page.locator('#sourceSettingsVideo').bounding_box();assert large['width']>small['width']*2
    for w,h in [(1440,1000),(1024,768),(390,844),(320,740),(844,390)]:
        page.set_viewport_size({'width':w,'height':h})
        assert page.locator('#sourceSettings').evaluate('e=>e.scrollWidth<=e.clientWidth+1'),(w,h,page.locator('#sourceSettings').evaluate('e=>({scroll:e.scrollWidth,client:e.clientWidth,children:[...e.querySelectorAll("*")].filter(c=>c.getBoundingClientRect().right>e.getBoundingClientRect().right).map(c=>({tag:c.tagName,id:c.id,cls:c.className}))})'))
        rects=page.locator('#sourceSettingsActions button').evaluate_all('es=>es.map(e=>{let r=e.getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom}})')
        for i,a in enumerate(rects):
            for b in rects[i+1:]:assert not (min(a['r'],b['r'])>max(a['l'],b['l'])+1 and min(a['b'],b['b'])>max(a['t'],b['t'])+1),'overlapping source controls'
    if args.screenshots:
        folder=Path(args.screenshots);folder.mkdir(parents=True,exist_ok=True)
        page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(folder/'opciones-camara-movil.png'))
    page.locator('#sourceSettings button[title="Ocultar video en escenario y backstage (mantiene el audio)"]').click()
    expect(page.locator('#sourceSettingsVideo')).to_have_css('opacity','0')
    page.locator('#sourceSettings button[title="Mostrar video"]').click();page.locator('#closeSourceSettings').click()
    page.wait_for_function('()=>document.querySelector("#sourceSettingsVideo").srcObject===null')
    page.set_viewport_size({'width':1440,'height':1000})
    page.locator('#studioViewMenu summary').click();page.locator('#relayInfo').click()
    expect(page.locator('#cloudflareControls')).to_be_hidden();expect(page.locator('#relayChoiceStatus')).to_contain_text('local')
    page.locator('#bandwidthMode').select_option('eco')
    page.wait_for_function('()=>__pcs.some(pc=>pc.getSenders().some(s=>s.track?.kind==="video"&&s.getParameters().encodings?.[0]?.maxFramerate===20))')
    page.locator('#bandwidthMode').select_option('quality')
    page.wait_for_function('()=>__pcs.some(pc=>pc.getSenders().some(s=>s.track?.kind==="video"&&s.getParameters().encodings?.[0]?.maxFramerate===30))')
    page.locator('#closeRelayDialog').click()
    # Additional publications let us verify actual OBS subscriptions, not CSS.
    page.evaluate('''async key=>{
      const url=document.querySelector('script[src$="/js/studio.js"]').src.replace('studio.js','rtc.js');const m=await import(url);
      const sig=new m.Signal();await sig.connect({type:'join',room:new URL(location.href).searchParams.get('room'),role:'host',key});
      const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');let f=0;
      const timer=setInterval(()=>{x.fillStyle=`hsl(${f++%360} 70% 50%)`;x.fillRect(0,0,320,180)},100);
      const media=c.captureStream(10);const pubs=[];for(let i=0;i<2;i++)pubs.push(await m.publish(sig,media,{stream:'external-'+i,name:'External '+i,videoKbps:100,fps:10}));
      window.__producer={sig,pubs,media,timer};
    }''',k['hostKey'])
    expect(page.locator('#backstage .tile')).to_have_count(3,timeout=15000)
    obs=ctx.new_page();obs.add_init_script('window.__pcs=[];const PC=window.RTCPeerConnection;window.RTCPeerConnection=class extends PC{constructor(...args){super(...args);window.__pcs.push(this)}}')
    obs.goto(args.url+'/view?room='+k['room']+'&scene=1#key='+k['viewKey'])
    obs.wait_for_function('()=>__pcs.some(pc=>pc.connectionState==="connected")')
    assert obs.evaluate('()=>__pcs.filter(pc=>pc.connectionState!=="closed").length')==1
    page.evaluate('()=>__producer.sig.send({type:"state",value:{stage:[__producer.pubs[1].id]}})')
    obs.wait_for_function('()=>__pcs.length>=2&&__pcs[0].connectionState==="closed"&&__pcs.at(-1).connectionState==="connected"')
    assert obs.evaluate('()=>__pcs.filter(pc=>pc.connectionState!=="closed").length')==1
    assert not errors,errors
    print(json.dumps({'independentVdoRoomNoLocalCreation':True,'officialIframeFixture':True,'privateVdoFragments':True,'responsive16by9':True,'enlargedCameraControlsNoOverlap':True,'modalVideoReleased':True,'liveBandwidthProfiles':True,'obsOnlySelectedScene':True,'pageErrors':errors}),flush=True)
    ctx.close();browser.close()
