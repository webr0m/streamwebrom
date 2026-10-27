"""Host-controlled guest display capture using real signalling and WebRTC."""
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
    keys=context.request.post(args.url+'/api/rooms',data={'room':'share-'+str(time.time_ns()),'lobby':False}).json()
    errors=[]
    host=context.new_page();host.on('pageerror',lambda e:errors.append(str(e)))
    host.goto(args.url+'/studio?room='+keys['room']+'#key='+keys['hostKey'])
    expect(host.locator('#status')).to_have_text('conectado',timeout=20000)
    guest=context.new_page();guest.on('pageerror',lambda e:errors.append(str(e)))
    guest.add_init_script("""window.__captures=[];window.__pickerCalls=0;window.__holdPicker=false;
      navigator.mediaDevices.getDisplayMedia=async()=>{
        window.__pickerCalls++;
        const track=document.querySelector('[data-id="me"] video').srcObject.getVideoTracks()[0].clone();
        window.__captures.push(track);
        if(window.__holdPicker)await new Promise(resolve=>window.__releasePicker=resolve);
        return new MediaStream([track]);
      };
    """)
    guest.goto(args.url+'/guest?room='+keys['room']+'&label=Panelista&autostart=1#invite='+keys['inviteKey'])
    expect(guest.locator('#call')).to_be_visible(timeout=20000)
    expect(guest.locator('#connection')).to_be_hidden(timeout=20000)
    expect(guest.locator('#screenBtn')).to_be_disabled()
    expect(host.locator('#backstage .tile')).to_have_count(1,timeout=20000)
    host.locator('#backstage .stagebtn').click()
    expect(guest.locator('#screenBtn')).to_be_enabled()

    # Requesting must never open a display picker or publish a screen.
    guest.locator('#screenBtn').click()
    expect(host.locator('#screenRequests')).to_be_visible()
    assert guest.evaluate('__pickerCalls===0')
    expect(host.locator('#backstage [data-kind="screen"]')).to_have_count(0)
    host.get_by_role('button',name='Rechazar pantalla',exact=True).click()
    expect(guest.locator('#screenShareText')).to_contain_text('rechazó')
    expect(host.locator('#screenRequests')).to_be_hidden()
    guest.locator('#screenBtn').click()
    expect(host.locator('#screenRequests')).to_be_visible()
    guest.locator('#cancelScreen').click()
    expect(host.locator('#screenRequests')).to_be_hidden()

    def authorize():
        guest.locator('#screenBtn').click()
        expect(host.locator('#screenRequests')).to_be_visible()
        host.get_by_role('button',name='Autorizar pantalla',exact=True).click()
        expect(guest.locator('#startScreen')).to_be_visible()

    authorize()
    assert guest.evaluate('__pickerCalls===0'), 'approval opened the picker without a guest click'
    guest.locator('#startScreen').click();guest.locator('#confirmShare').click()
    expect(guest.locator('#screenBtn')).to_have_class('icon on',timeout=20000)
    screen=host.locator('#backstage [data-kind="screen"]')
    expect(screen).to_have_count(1,timeout=20000)
    screen_id=screen.get_attribute('data-id')
    screen.locator('.stagebtn').click()
    obs=context.new_page();obs.on('pageerror',lambda e:errors.append(str(e)))
    obs.goto(args.url+'/view?room='+keys['room']+'&stream='+screen_id+'&mute=1#key='+keys['viewKey'])
    obs.wait_for_function("()=>{const v=document.querySelector('#single');return v.videoWidth>0&&v.readyState>=2}",timeout=20000)
    assert obs.locator('#single').evaluate('e=>getComputedStyle(e).objectFit')=='contain'
    # Stopping from the guest also removes the source from the scene lineup.
    guest.locator('#cancelScreen').click()
    expect(screen).to_have_count(0,timeout=15000)
    expect(host.locator('#sceneBar .scenecount').first).to_have_text('1 en escena')
    authorize();guest.locator('#startScreen').click();guest.locator('#confirmShare').click()
    expect(screen).to_have_count(1,timeout=20000)
    host.locator('[data-tab="people"]').click()
    host.get_by_role('button',name='Revocar pantalla',exact=True).click()
    expect(screen).to_have_count(0,timeout=15000)
    expect(guest.locator('#screenBtn')).not_to_have_class('icon on')
    assert guest.evaluate('__captures.every(t=>t.readyState==="ended")')

    # A pending OS picker must not leak a capture when approval is revoked.
    authorize();guest.evaluate('__holdPicker=true');guest.locator('#startScreen').click();guest.locator('#confirmShare').click()
    guest.wait_for_function('()=>typeof __releasePicker==="function"')
    host.get_by_role('button',name='Revocar pantalla',exact=True).click()
    guest.evaluate('__holdPicker=false;__releasePicker()')
    guest.wait_for_function('()=>__captures.every(t=>t.readyState==="ended")')
    expect(screen).to_have_count(0)

    # Removing the guest from all scenes automatically revokes the grant.
    authorize();guest.locator('#startScreen').click();guest.locator('#confirmShare').click()
    expect(screen).to_have_count(1,timeout=20000)
    host.locator('#backstage [data-kind="camera"] .stagebtn').click()
    expect(screen).to_have_count(0,timeout=15000)
    expect(guest.locator('#screenBtn')).to_be_disabled()
    assert guest.evaluate('__captures.every(t=>t.readyState==="ended")')

    # Restore stage membership and check that leaving releases an active share.
    host.locator('#backstage [data-kind="camera"] .stagebtn').click()
    authorize();guest.locator('#startScreen').click();guest.locator('#confirmShare').click()
    expect(screen).to_have_count(1,timeout=20000)
    if args.screenshots:
        folder=Path(args.screenshots);folder.mkdir(parents=True,exist_ok=True)
        host.screenshot(path=str(folder/'host-authorized-screen.png'))
    guest.locator('#leaveBtn').click()
    expect(guest.get_by_role('heading',name='Saliste de la sala.')).to_be_visible()
    assert guest.evaluate('__captures.every(t=>t.readyState==="ended")')
    expect(screen).to_have_count(0,timeout=15000)
    assert not errors,errors
    print(json.dumps({'hostApprovalBeforeCapture':True,'denyCancelRetry':True,'realScreenVideoToOBS':True,'guestStopClearsStage':True,'revokeStopsTracks':True,'latePickerReleased':True,'offstageRevokes':True,'leaveReleasesShare':True,'pageErrors':errors}),flush=True)
    context.close();browser.close()
