"""Verify portrait camera framing through real WebRTC in studio, call and OBS."""
import argparse
import io
import json
import time
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://localhost:18443')
parser.add_argument('--browser')
parser.add_argument('--screenshots')
args = parser.parse_args()
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path=args.browser, args=[
        '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required'])
    context = browser.new_context(permissions=['camera', 'microphone'], service_workers='block')
    keys = context.request.post(args.url+'/api/rooms', data={'room':'frame-'+str(time.time_ns()), 'lobby':False}).json()
    errors = []
    def page():
        p = context.new_page()
        p.on('pageerror', lambda e: errors.append(str(e)))
        return p
    host = page()
    host.goto(args.url+'/studio?room='+keys['room']+'#key='+keys['hostKey'])
    expect(host.locator('#status')).to_have_text('conectado', timeout=20000)
    publisher = page()
    publisher.goto(args.url+'/diagnostics')
    publisher.evaluate("""async keys=>{
      const rtc=await import('/js/rtc.js');window.sig=new rtc.Signal();
      await sig.connect({type:'join',role:'guest',room:keys.room,invite:keys.inviteKey,name:'Vertical'});
      const c=document.createElement('canvas');c.width=180;c.height=320;
      const ctx=c.getContext('2d');
      const draw=()=>{ctx.fillStyle='#ff0000';ctx.fillRect(0,0,180,320);
        ctx.fillStyle='#00cc44';ctx.fillRect(0,100,180,120);
        ctx.fillStyle='#2244ff';ctx.fillRect(80,100,20,120)};
      draw();window.timer=setInterval(draw,100);window.media=c.captureStream(10);
      window.pub=await rtc.publish(sig,media,{stream:'portrait',name:'Vertical',videoKbps:200,fps:10});
      sig.send({type:'media',cam:true,mic:false});
    }""", keys)
    expect(host.locator('#backstage [data-id="portrait"] video')).to_be_visible(timeout=20000)
    host.locator('#backstage [data-id="portrait"] .stagebtn').click()
    host.locator('#status').click()
    host.mouse.move(0,0)
    host.wait_for_function("()=>getComputedStyle(document.querySelector('#backstage .tools')).opacity==='0'")
    guest = page()
    guest.goto(args.url+'/guest?room='+keys['room']+'&label=Prueba&autostart=1#invite='+keys['inviteKey'])
    expect(guest.locator('#call')).to_be_visible(timeout=20000)
    expect(guest.locator('#grid [data-id="portrait"] video')).to_be_visible(timeout=20000)
    obs = page()
    obs.goto(args.url+'/view?room='+keys['room']+'&stream=portrait&mute=1#key='+keys['viewKey'])
    program = page()
    program.goto(args.url+'/view?room='+keys['room']+'&scene=1&mute=1#key='+keys['viewKey'])
    for p, selector in [(host,'#backstage [data-id="portrait"] video'), (guest,'#grid [data-id="portrait"] video'), (obs,'#single')]:
        p.wait_for_function("s=>{const v=document.querySelector(s);return v?.videoWidth===180&&v?.videoHeight===320&&v.readyState>=2}", arg=selector, timeout=20000)
    expect(program.locator('#out')).to_be_visible(timeout=20000)
    assert host.evaluate("""async()=>{
      const {computeLayout}=await import('/js/compositor.js');
      return ['solo','split','grid','pip','sidebar','spotlight','screen','news'].every(layout=>
        [1,2,6,9].every(n=>[0,64].every(bottom=>computeLayout(layout,n,{bottom}).every(r=>Math.abs(r.w/r.h-16/9)<.0001))));
    }"""), 'program layouts changed source aspect ratio'

    def landscape(p, selector):
        p.wait_for_function("""s=>{const r=document.querySelector(s).getBoundingClientRect();
          return r.width>0&&r.height>0&&Math.abs(r.width/r.height-16/9)<.025&&r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1}""", arg=selector)

    def cropped(locator):
        # The portrait's red top and bottom must be cropped, not squeezed into
        # a landscape rectangle. Its central blue stripe keeps its width.
        im = Image.open(io.BytesIO(locator.screenshot())).convert('RGB')
        w,h = im.size
        for x,y in [(.25,.15),(.25,.5),(.75,.85)]:
            r,g,b = im.getpixel((int(w*x),int(h*y)))
            assert g>140 and r<70 and b<140, (im.size,(x,y),(r,g,b))
        r,g,b = im.getpixel((w//2,h//2))
        assert b>170 and r<100 and g<120, (im.size,(r,g,b))

    cropped(host.locator('#backstage [data-id="portrait"] video'))
    for width,height in [(393,851),(851,393),(1280,720)]:
        for p in [guest,obs,program]:p.set_viewport_size({'width':width,'height':height})
        landscape(guest,'#grid [data-id="portrait"]');landscape(obs,'#viewFrame');landscape(program,'#viewFrame')
        cropped(guest.locator('#grid [data-id="portrait"] video'));cropped(obs.locator('#single'))
        guest.locator('#grid [data-id="portrait"] .tile-focus').click()
        expect(guest.locator('#grid .expanded')).to_have_count(1)
        landscape(guest,'#grid .expanded');cropped(guest.locator('#grid [data-id="portrait"] video'))
        guest.locator('#restoreGrid').click()
    assert program.evaluate('document.querySelector("#out").width===1920&&document.querySelector("#out").height===1080')
    # Program output uses the very same compositor and state as the host.
    for p in [host,program]:
        p.wait_for_function("""()=>{const c=document.querySelector('#program, #out');const a=c.getContext('2d').getImageData(600,500,1,1).data;return a[1]>140&&a[0]<70}""")
    host_pixels=host.evaluate("[...document.querySelector('#program, #out').getContext('2d').getImageData(600,500,1,1).data]")
    obs_pixels=program.evaluate("[...document.querySelector('#program, #out').getContext('2d').getImageData(600,500,1,1).data]")
    assert all(abs(a-b)<12 for a,b in zip(host_pixels,obs_pixels)), (host_pixels,obs_pixels)
    # Existing fit links remain an explicit opt-out from the camera crop.
    obs.goto(args.url+'/view?room='+keys['room']+'&stream=portrait&cover=0&mute=1#key='+keys['viewKey'])
    obs.wait_for_function("()=>document.querySelector('#single').videoWidth===180")
    assert obs.locator('#single').evaluate("e=>getComputedStyle(e).objectFit")=='contain'
    if args.screenshots:
        folder=Path(args.screenshots);folder.mkdir(parents=True,exist_ok=True)
        guest.set_viewport_size({'width':393,'height':851});landscape(guest,'#grid [data-id="portrait"]')
        guest.screenshot(path=str(folder/'portrait-camera-mobile.png'))
        program.set_viewport_size({'width':393,'height':851});program.screenshot(path=str(folder/'program-mobile.png'))
    publisher.evaluate('pub.stop();media.getTracks().forEach(t=>t.stop());clearInterval(timer);sig.close()')
    assert not errors,errors
    print(json.dumps({'portraitCamera':'180x320','frames':'16:9','viewports':3,'studioGuestOBSCropMatches':True,'program':'1920x1080','explicitContainPreserved':True,'pageErrors':errors}),flush=True)
    context.close();browser.close()
