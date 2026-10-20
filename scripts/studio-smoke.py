"""Live network/battery stats, touch ordering, clean stage and OBS quality/recovery."""
import argparse
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument('--url',default='http://localhost:18443')
parser.add_argument('--browser')
parser.add_argument('--screenshots')
args=parser.parse_args()
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path=args.browser,args=[
        '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required'])
    context=browser.new_context(permissions=['camera','microphone'],service_workers='block')
    keys=context.request.post(args.url+'/api/rooms',data={'room':'studio-'+str(time.time_ns()),'lobby':False,'password':'smoke-password'}).json()
    errors=[]
    host=context.new_page();host.on('pageerror',lambda e:errors.append(str(e)))
    host.goto(args.url+'/studio?room='+keys['room']+'#key='+keys['hostKey'])
    expect(host.locator('#status')).to_have_text('conectado',timeout=20000)
    host.locator('#addCam').click()
    expect(host.locator('#backstage .tile')).to_have_count(1,timeout=20000)
    mobile=browser.new_context(permissions=['camera','microphone'],service_workers='block',has_touch=True,is_mobile=True,viewport={'width':851,'height':393})
    guest=mobile.new_page();guest.on('pageerror',lambda e:errors.append(str(e)))
    guest.add_init_script("window.__battery={level:.63,charging:true};navigator.getBattery=async()=>__battery")
    guest.goto(args.url+'/guest?room='+keys['room']+'&label=Panelista&password=smoke-password&autostart=1#invite='+keys['inviteKey'])
    expect(guest.locator('#call')).to_be_visible(timeout=20000)
    expect(guest.locator('#connection')).to_be_hidden(timeout=20000)
    expect(host.locator('#backstage .tile')).to_have_count(2,timeout=20000)
    expect(guest.locator('#roomPing')).to_contain_text('ms',timeout=15000)
    expect(host.locator('#roomPing')).to_contain_text('ms',timeout=15000)
    host_guest=host.locator('#backstage .tile').filter(has=host.locator('.name').filter(has_text='Panelista'))
    expect(host_guest.locator('.tile-latency')).to_contain_text('63%',timeout=20000)
    expect(guest.locator('[data-id="me"] .tile-latency')).to_contain_text('63%',timeout=20000)
    guest.evaluate('__battery.level=.41;__battery.charging=false')
    expect(host_guest.locator('.tile-latency')).to_contain_text('41%',timeout=12000)
    assert '⚡' not in host_guest.locator('.tile-latency').inner_text()

    # Hiding a camera must also hide its backstage picture without stopping audio.
    host_guest.locator('button[title="Ocultar video en escenario y backstage (mantiene el audio)"]').click()
    expect(host_guest).to_have_class(__import__('re').compile('video-hidden'))
    expect(host_guest.locator('video')).to_have_css('opacity','0')
    expect(guest.locator('[data-id="me"]')).to_have_class(__import__('re').compile('video-hidden'))
    host_guest.locator('button[title="Mostrar video"]').click()
    expect(host_guest.locator('video')).to_have_css('opacity','1')
    # Persist actual UI options and confirm stored roster links survive a reload.
    host.locator('[data-tab="brand"]').click()
    host.locator('#persistentRoom summary').click()
    host.locator('#persistDays').select_option('90')
    host.locator('#persistSave').click()
    expect(host.locator('#persistStatus')).to_contain_text('Guardada hasta',timeout=10000)
    expect(host.locator('#persistentParticipants')).to_contain_text('Panelista')
    expect(host.locator('#persistentParticipants button').filter(has_text='Link OBS guardado').first).to_be_visible()
    guest.wait_for_function('room=>!!localStorage.getItem("swr.rejoin."+room)',arg=keys['room'])
    # Reordering moves existing media nodes; rotation must retain that order.
    before=guest.locator('#grid .tile').evaluate_all('(els)=>els.map(e=>e.dataset.id)')
    guest.locator('#reorderGrid').tap()
    guest.locator('#grid .tile').last.locator('[data-move="prev"]').tap()
    guest.wait_for_function('first=>document.querySelector("#grid .tile").dataset.id!==first',arg=before[0])
    order=guest.locator('#grid .tile').evaluate_all('(els)=>els.map(e=>e.dataset.id)')
    guest.set_viewport_size({'width':393,'height':851});guest.set_viewport_size({'width':851,'height':393})
    assert guest.locator('#grid .tile').evaluate_all('(els)=>els.map(e=>e.dataset.id)')==order
    guest.locator('#reorderGrid').tap()
    guest.locator('#callFullscreen').tap()
    expect(guest.locator('#call')).to_have_class('call cinema')
    guest.wait_for_function("()=>{const r=document.querySelector('#grid').getBoundingClientRect();return r.height>=innerHeight-2&&r.width>=innerWidth-2}")
    assert guest.locator('#grid .tile').evaluate_all('els=>els.every(e=>{const r=e.getBoundingClientRect();return Math.abs(r.width/r.height-16/9)<.025})')
    if args.screenshots:
        folder=Path(args.screenshots);folder.mkdir(parents=True,exist_ok=True)
        guest.screenshot(path=str(folder/'mobile-landscape-fullscreen.png'))
    guest.locator('#exitFullscreen').tap();expect(guest.locator('#call')).not_to_have_class('call cinema')

    # Changing camera send quality modifies the publisher, not only CSS size.
    host_guest.hover();host_guest.get_by_role('combobox').select_option('360')
    guest.wait_for_function("()=>document.querySelector('[data-id=me] video').srcObject.getVideoTracks()[0].getSettings().height===360",timeout=15000)
    host_guest=host.locator('#backstage .tile').filter(has=host.locator('.name').filter(has_text='Panelista'))
    stream_id=host_guest.get_attribute('data-id')
    host_guest.locator('.stagebtn').click()
    host.locator('#stageView').click()
    expect(host.locator('#studioRoot')).to_have_class('studio cinema')
    expect(host.locator('.topbar')).to_be_hidden();expect(host.locator('.side')).to_be_hidden()
    expect(host.locator('#backstage')).to_be_hidden();expect(host.locator('.controlbar')).to_be_hidden()
    assert host.locator('#program').evaluate('e=>{const r=e.getBoundingClientRect();return Math.abs(r.width/r.height-16/9)<.025&&r.width>=innerWidth-2}')
    if args.screenshots:host.screenshot(path=str(Path(args.screenshots)/'host-stage-only.png'))
    host.locator('#exitFullscreen').click();expect(host.locator('#backstage')).to_be_visible()

    obs=context.new_page();obs.on('pageerror',lambda e:errors.append(str(e)))
    obs.add_init_script("window.__pcs=[];const P=RTCPeerConnection;window.RTCPeerConnection=class extends P{constructor(...a){super(...a);__pcs.push(this)}}")
    start=time.monotonic()
    obs.goto(args.url+'/view?room='+keys['room']+'&stream='+stream_id+'&quality=360&fps=15&mute=1#key='+keys['viewKey'])
    obs.wait_for_function("()=>{const v=document.querySelector('#single');return v.videoWidth>0&&v.readyState>=2}",timeout=15000)
    first_frame_ms=round((time.monotonic()-start)*1000)
    assert obs.locator('#singleOut').evaluate('e=>e.width===640&&e.height===360')
    # An ICE failure used to freeze the OBS source until its page was reloaded.
    obs.evaluate("const p=__pcs[0];p.close();Object.defineProperty(p,'connectionState',{value:'failed'});p.dispatchEvent(new Event('connectionstatechange'))")
    obs.wait_for_function("()=>__pcs.length>=2&&__pcs.at(-1).connectionState==='connected'&&document.querySelector('#single').readyState>=2",timeout=15000)
    obs.goto(args.url+'/view?room='+keys['room']+'&scene=1&quality=720&fps=25&mute=1#key='+keys['viewKey'])
    expect(obs.locator('#out')).to_be_visible(timeout=15000)
    assert obs.locator('#out').evaluate('e=>e.width===1280&&e.height===720')
    if args.screenshots:obs.screenshot(path=str(Path(args.screenshots)/'obs-720p.png'))
    # Closing a tab and returning keeps the participant's OBS stream ID.
    guest_url=guest.url
    guest.close()
    expect(host_guest).to_have_count(0,timeout=10000)
    guest=mobile.new_page();guest.on('pageerror',lambda e:errors.append(str(e)))
    guest.goto(guest_url)
    expect(guest.locator('#connection')).to_be_hidden(timeout=20000)
    expect(host_guest).to_have_count(1,timeout=20000)
    assert host_guest.get_attribute('data-id')==stream_id
    # Host local output settings restore from the saved room, even after cache storage is cleared.
    host.locator('[data-tab="obs"]').click()
    host.locator('#obsQuality').select_option('540')
    host.wait_for_timeout(800)
    host.evaluate('sessionStorage.clear()')
    host.reload()
    expect(host.locator('#status')).to_have_text('conectado',timeout=15000)
    expect(host.locator('#obsQuality')).to_have_value('540')
    expect(host.locator('#persistStatus')).to_contain_text('Guardada hasta')
    assert not errors,errors
    print(json.dumps({'liveRTTAndRoomPing':True,'batteryChargingUpdates':True,'touchOrderSurvivesRotation':True,'fullScreen16by9':True,'hostStageOnly':True,'cameraSend360p':True,'obsFirstFrameMs':first_frame_ms,'obsMediaRecovers':True,'output360p720p':True,'persistentRoomRosterAndOptions':True,'hiddenBackstage':True,'pageErrors':errors}),flush=True)
    mobile.close();context.close();browser.close()
