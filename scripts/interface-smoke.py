"""Discoverable room persistence, themes, responsive production workspace."""
import argparse
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

p=argparse.ArgumentParser();p.add_argument('--url',default='http://localhost:18443');p.add_argument('--browser');p.add_argument('--screenshots');args=p.parse_args()
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path=args.browser,args=['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required'])
    ctx=browser.new_context(locale='es-ES',viewport={'width':1440,'height':900},color_scheme='light',service_workers='block',permissions=['camera','microphone'])
    keys=ctx.request.post(args.url+'/api/rooms',data={'room':'interface-'+str(time.time_ns()),'title':'Estudio de prueba','password':'interface-password'}).json()
    page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(args.url+'/studio?room='+keys['room']+'#key='+keys['hostKey'])
    expect(page.locator('#status')).to_have_text('conectado',timeout=15000)
    expect(page.locator('html')).to_have_attribute('data-theme','light')
    expect(page.locator('#openRoomDialog')).to_be_visible()
    # A UI theme must not change the broadcast's rendered pixels.
    page.wait_for_timeout(300)
    before=page.locator('#program').evaluate('c=>c.toDataURL()')
    page.get_by_role('combobox',name='Tema visual',exact=True).select_option('dark')
    expect(page.locator('html')).to_have_attribute('data-theme','dark')
    assert before==page.locator('#program').evaluate('c=>c.toDataURL()')
    page.reload();expect(page.locator('#status')).to_have_text('conectado')
    expect(page.locator('html')).to_have_attribute('data-theme','dark')
    # Direct entry: no brand tab and no hidden disclosure is needed to save.
    page.locator('#openRoomDialog').click();expect(page.locator('#roomDialog')).to_be_visible()
    page.locator('#persistDays').select_option('60');page.locator('#persistSave').click()
    expect(page.locator('#persistStatus')).to_contain_text('Guardada hasta')
    expect(page.locator('#roomSavedState')).to_have_text('Sala persistente')
    if args.screenshots:
        folder=Path(args.screenshots);folder.mkdir(parents=True,exist_ok=True)
        page.screenshot(path=str(folder/'guardar-sala-noche.png'))
    page.keyboard.press('Escape');expect(page.locator('#roomDialog')).to_be_hidden()
    expect(page.locator('#openRoomDialog')).to_be_focused()
    expect(page.locator('#roomActionLabel')).to_have_text('Sala guardada')
    # Panels collapse independently, restore on tab activation and retain choices.
    page.locator('#collapseScenes').click()
    expect(page.locator('#scenesRail')).to_be_hidden()
    expect(page.locator('#restoreScenes')).to_be_visible()
    page.locator('#closePanel').click();expect(page.locator('#studioPanes')).to_be_hidden()
    page.locator('#tabs [data-tab="obs"]').click();expect(page.locator('#studioPanes')).to_be_visible()
    page.locator('#restoreScenes').click()
    expect(page.locator('#scenesRail')).to_be_visible()
    page.locator('#addCam').click();expect(page.locator('#backstage .tile')).to_have_count(1,timeout=15000)
    page.locator('#tabs [data-tab="brand"]').click()
    # Screenshot and overflow checks at desktop, laptop, tablet and phone sizes.
    tested=[]
    for w,h in [(1440,900),(1280,720),(1024,768),(768,1024),(390,844),(320,740)]:
        page.set_viewport_size({'width':w,'height':h})
        for theme in ['light','dark']:
            page.get_by_role('combobox',name='Tema visual',exact=True).select_option(theme)
            page.wait_for_timeout(120)
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),(w,h,theme,'overflow',page.evaluate('Array.from(document.querySelectorAll("body *")).map(e=>({tag:e.tagName,id:e.id,c:e.className,r:e.getBoundingClientRect().right})).filter(e=>e.r>innerWidth+1).slice(0,15)'))
            rect=page.locator('#program').bounding_box();assert abs(rect['width']/rect['height']-16/9)<.025,(w,h,rect)
            expect(page.locator('#openRoomDialog')).to_be_visible()
            assert page.locator('#openRoomDialog').evaluate('e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0}'),(w,h,'hidden save action')
            if args.screenshots and w in [1440,390]:page.screenshot(path=str(folder/f'estudio-{theme}-{w}.png'),full_page=w<1000)
        page.locator('#openRoomDialog').click();expect(page.locator('#persistSave')).to_be_visible();page.keyboard.press('Escape')
        tested.append([w,h])
    page.set_viewport_size({'width':1440,'height':900})
    home=ctx.new_page();home.goto(args.url+'/')
    expect(home.locator('#savedStudios')).to_contain_text('Estudio de prueba')
    page.get_by_role('combobox',name='Tema visual',exact=True).select_option('auto')
    page.emulate_media(color_scheme='dark');expect(page.locator('html')).to_have_attribute('data-theme','dark')
    home.get_by_role('combobox',name='Tema visual',exact=True).select_option('light')
    expect(page.locator('html')).to_have_attribute('data-theme','light')
    if args.screenshots:home.screenshot(path=str(folder/'inicio-dia.png'),full_page=True)
    no_pw=ctx.request.post(args.url+'/api/rooms',data={'room':'temporary-'+str(time.time_ns())}).json()
    home.goto(args.url+'/studio?room='+no_pw['room']+'#key='+no_pw['hostKey']);expect(home.locator('#status')).to_have_text('conectado')
    home.locator('#openRoomDialog').click();expect(home.locator('#persistSave')).to_be_disabled();expect(home.locator('#persistStatus')).to_contain_text('no tiene contraseña')
    # Localisation: ?lang wins, the picker switches live and the choice sticks.
    i18n=ctx.new_page();i18n.goto(args.url+'/?lang=ru')
    expect(i18n.locator('html')).to_have_attribute('lang','ru')
    cyrillic=[c for c in i18n.locator('body').inner_text() if '\u0400'<=c<='\u04FF']
    assert len(cyrillic)>=20,('russian copy missing',len(cyrillic))
    i18n.locator('[data-lang-picker]').first.select_option('en')
    expect(i18n.locator('html')).to_have_attribute('lang','en')
    i18n.reload();expect(i18n.locator('html')).to_have_attribute('lang','en')
    i18n.locator('[data-lang-picker]').first.select_option('es')
    expect(i18n.locator('html')).to_have_attribute('lang','es')
    i18n.close()
    assert not errors,errors
    print(json.dumps({'directSaveMenu':True,'passwordRequirementVisible':True,'savedRoomShownOnHome':True,'themesPersistAndSync':True,'programPixelsUnchanged':True,'panelsCollapseAndRestore':True,'localisationSwitchesAndPersists':True,'responsiveSizes':tested,'pageErrors':errors}),flush=True)
    ctx.close();browser.close()
