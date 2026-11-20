"""Mobile guest grid, real media, transient loss and capture cleanup regressions."""
import argparse
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument('--url',default='http://localhost:18443')
parser.add_argument('--browser')
parser.add_argument('--screenshots',help='Optional directory for visual inspection')
args=parser.parse_args()
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path=args.browser,args=[
        '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required'])
    host_context=browser.new_context(locale='es-ES',service_workers='block')
    keys=host_context.request.post(args.url+'/api/rooms',data={'room':'layout-'+str(time.time_ns()),'lobby':False}).json()
    host=host_context.new_page();host.goto(args.url+'/diagnostics')
    host.evaluate("""async keys=>{
      const rtc=await import('/js/rtc.js');window.rtc=rtc;window.sig=new rtc.Signal();window.pubs=[];
      await sig.connect({type:'join',role:'host',room:keys.room,key:keys.hostKey});
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
      const ctx=canvas.getContext('2d');let frame=0;
      window.draw=setInterval(()=>{ctx.fillStyle=`hsl(${frame++%360} 55% 30%)`;ctx.fillRect(0,0,320,180);ctx.fillStyle='white';ctx.font='24px sans-serif';ctx.fillText('StreamWebRom',65,95);},200);
      window.source=canvas.captureStream(5);
    }""",keys)
    mobile=browser.new_context(locale='es-ES',permissions=['camera','microphone'],service_workers='block',has_touch=True,is_mobile=True,viewport={'width':393,'height':851})
    guest=mobile.new_page();errors=[];guest.on('pageerror',lambda e:errors.append(str(e)))
    guest.add_init_script("""window.__pcs=[];window.__owned=[];window.__sockets=[];
      const NativePC=RTCPeerConnection,NativeWS=WebSocket;
      window.RTCPeerConnection=class extends NativePC {constructor(...args){super(...args);window.__pcs.push(this)}};
      window.WebSocket=class extends NativeWS {constructor(...args){super(...args);window.__sockets.push(this)}};
      const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);let first=true;
      navigator.mediaDevices.getUserMedia=async constraints=>{
        if(first){first=false;await new Promise(r=>setTimeout(r,1500))}
        if(constraints.video?.deviceId?.exact==='test-second')delete constraints.video.deviceId;
        const stream=await gum(constraints);window.__owned.push(...stream.getTracks());return stream;
      };
      const devices=navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
      navigator.mediaDevices.enumerateDevices=async()=>[...await devices(),{kind:'videoinput',deviceId:'test-second',label:'Segunda cámara de prueba',groupId:'test'}];
      navigator.mediaDevices.getDisplayMedia=async()=>{
        const track=document.querySelector('[data-id="me"] video').srcObject.getVideoTracks()[0].clone();
        window.__owned.push(track);return new MediaStream([track]);
      };
    """)
    guest.goto(args.url+'/guest?room='+keys['room']+'&label=Mi cámara&autostart=1#invite='+keys['inviteKey'])
    expect(guest.locator('#call')).to_be_visible(timeout=20000)
    expect(guest.locator('#connection')).to_be_hidden(timeout=20000)
    assert guest.evaluate("document.querySelector('[data-id=me] video').srcObject.getVideoTracks().length===1"),'autostart raced camera permission'
    expect(guest.locator('#retryMedia')).to_be_hidden()

    def geometry(page=guest):
        page.wait_for_function("""()=>{
          const grid=document.querySelector('#grid'),bar=document.querySelector('.call .bar').getBoundingClientRect();
          const rects=[...grid.children].map(e=>e.getBoundingClientRect());
          if(!rects.length||grid.scrollWidth>grid.clientWidth+1||document.documentElement.scrollWidth>innerWidth+1)return false;
          return rects.every((r,i)=>r.width>0&&r.height>0&&Math.abs(r.width/r.height-16/9)<.025&&r.left>=-1&&r.right<=innerWidth+1&&r.bottom<=bar.top+1&&rects.every((s,j)=>i===j||r.right<=s.left+1||s.right<=r.left+1||r.bottom<=s.top+1||s.bottom<=r.top+1));
        }""",timeout=5000)

    for count in range(1,10):
        if count>1:
            host.evaluate("""async n=>{pubs.push(await rtc.publish(sig,source,{stream:'layout-'+n,name:'Participante '+n,videoKbps:80,fps:5}));}""",count)
        expect(guest.locator('#grid .tile')).to_have_count(count,timeout=20000)
        for width,height in [(320,640),(393,851),(851,393),(1280,720)]:
            guest.set_viewport_size({'width':width,'height':height});geometry()
        guest.set_viewport_size({'width':393,'height':851});geometry()
        if count==6 and args.screenshots:
            folder=Path(args.screenshots);folder.mkdir(parents=True,exist_ok=True)
            guest.screenshot(path=str(folder/'mobile-grid.png'))
        if count>1:
            guest.locator('#grid .tile-focus').last.tap()
            expect(guest.locator('#grid .expanded')).to_have_count(1);geometry()
            for width,height in [(320,640),(851,393),(1280,720)]:
                guest.set_viewport_size({'width':width,'height':height});geometry()
            guest.set_viewport_size({'width':393,'height':851});geometry()
            assert guest.evaluate("""()=>{const selected=document.querySelector('.expanded').getBoundingClientRect();return [...document.querySelectorAll('#grid .tile:not(.expanded)')].every(t=>selected.height>t.getBoundingClientRect().height);}""")
            if count==6 and args.screenshots:guest.screenshot(path=str(Path(args.screenshots)/'mobile-expanded.png'))
            guest.locator('#restoreGrid').tap();expect(guest.locator('#grid .expanded')).to_have_count(0);geometry()

    guest.locator('#grid .tile-focus').last.tap();host.evaluate('pubs.pop().stop()')
    expect(guest.locator('#grid .tile')).to_have_count(8)
    expect(guest.locator('#restoreGrid')).to_be_hidden();geometry()
    # A transient mobile handover must never expose manual reconnect controls.
    guest.evaluate("""()=>{window.__publisher=__pcs.find(p=>p.connectionState==='connected'&&p.getSenders().some(s=>s.track));Object.defineProperty(__publisher,'connectionState',{value:'disconnected',configurable:true});__publisher.dispatchEvent(new Event('connectionstatechange'));}""")
    expect(guest.locator('#retryMedia')).to_be_hidden()
    guest.evaluate("Object.defineProperty(__publisher,'connectionState',{value:'connected',configurable:true});__publisher.dispatchEvent(new Event('connectionstatechange'))")
    expect(guest.locator('#connection')).to_be_hidden()
    # A second camera must have its own publication ID, not replace the main.
    guest.locator('#cam2Btn').tap();guest.get_by_role('button',name='Segunda cámara de prueba',exact=True).click()
    expect(guest.locator('#grid .tile')).to_have_count(9,timeout=20000);geometry()
    assert guest.evaluate('__publisher.signalingState!=="closed"'),'second camera replaced the main publisher'
    assert guest.evaluate("[...document.querySelectorAll('#grid .tile')].map(t=>t.dataset.id).filter((id,i,ids)=>ids.indexOf(id)!==i).length===0")
    # Screen sharing and its capture cleanup have their own host-approval
    # integration in screen-share-smoke.py; this guest stays in backstage.
    guest.locator('#leaveBtn').tap();expect(guest.get_by_role('heading',name='Saliste de la sala.')).to_be_visible()
    assert guest.evaluate('__owned.every(t=>t.readyState==="ended")'),'leaving leaked capture tracks'
    # The Linux WebKit build may omit MediaStream. Exercise the actual grid
    # module and CSS independently; this does not claim Safari media support.
    webkit=pw.webkit.launch(headless=True)
    safari_context=webkit.new_context(locale='es-ES',viewport={'width':393,'height':851},has_touch=True,service_workers='block')
    safari=safari_context.new_page();safari.on('pageerror',lambda e:errors.append('WebKit: '+str(e)))
    safari.goto(args.url+'/call-layout-test-not-found')
    safari.set_content('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="'+args.url+'/css/app.css"></head><body><section class="call"><div class="call-grid-tools"><button id="restoreGrid" class="hidden">Ver todos</button></div><div id="grid" class="grid"></div><div class="bar"><button>Salir</button></div></section></body></html>')
    safari.evaluate("""async()=>{
      const {callGrid}=await import('/js/call-grid.js');const grid=document.querySelector('#grid');
      callGrid(grid,document.querySelector('#restoreGrid'));
      for(let i=0;i<8;i++){const tile=document.createElement('div');tile.className='tile';tile.dataset.name='Safari '+i;tile.innerHTML='<video></video><button class="tile-focus"></button>';grid.append(tile)}
    }""")
    geometry(safari);safari.locator('#grid .tile-focus').last.tap()
    expect(safari.locator('#grid .expanded')).to_have_count(1);geometry(safari)
    safari.locator('#restoreGrid').tap();expect(safari.locator('#grid .expanded')).to_have_count(0)
    safari_context.close();webkit.close()
    assert not errors,errors
    print(json.dumps({'mobileGridCounts':'1-9','viewports':4,'allTiles16by9':True,'tapToExpand':True,'selectedDepartureRegroups':True,'transientLossNoReconnectPrompt':True,'delayedCameraAutostart':True,'independentSecondCamera':True,'captureTracksReleased':True,'webkitGridOnly':True,'pageErrors':errors}),flush=True)
    host.evaluate('pubs.forEach(p=>p.stop());source.getTracks().forEach(t=>t.stop());clearInterval(draw);sig.close()')
    mobile.close();host_context.close();browser.close()
