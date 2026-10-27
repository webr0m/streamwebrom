const {_electron}=require('playwright');const {expect}=require('@playwright/test');
const http=require('node:http');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{
  const content=http.createServer((_q,r)=>{r.setHeader('Content-Type','text/html');r.end('<!doctype html><title>Contenido de prueba</title><body style="background:#258;color:white"><h1>Contenido de prueba</h1><canvas id="c" width="640" height="360"></canvas><script>const x=c.getContext("2d");let n=0;setInterval(()=>{x.fillStyle=`hsl(${n++%360} 80% 50%)`;x.fillRect(0,0,640,360)},30)</script>')});
  await new Promise(resolve=>content.listen(0,'127.0.0.1',resolve));
  const base=process.env.SWR_DESKTOP_TEST_URL||'http://127.0.0.1:18443';
  const keys=await fetch(base+'/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:'desktop-'+Date.now(),lobby:false})}).then(r=>r.json());
  const packaged=process.env.SWR_CAPTURE_EXECUTABLE;
  const app=await _electron.launch({executablePath:packaged||require('electron'),args:[...(packaged?[]:[path.resolve(__dirname,'..')]),'--url='+base+'/studio?room='+keys.room+'#key='+keys.hostKey,'--capture-test','--use-fake-device-for-media-stream']});
  const diagnostic=[];app.process().stderr.on('data',data=>{diagnostic.push(String(data));if(diagnostic.length>30)diagnostic.shift()});
  let room;
  try{
    const errors=[];room=await app.firstWindow();room.on('pageerror',e=>errors.push(e.message));
    await expect(room.locator('#status')).toHaveText('conectado',{timeout:30000});
    assert.equal(await room.evaluate(()=>window.StreamWebRomCapture.version),1);
    await assert.rejects(room.evaluate(()=>window.StreamWebRomCapture.start('not-authorized')));
    await room.locator('#addScreen').click();
    let picker;await expect.poll(()=>{picker=app.windows().find(p=>p.url().endsWith('/picker.html'));return !!picker},{timeout:15000}).toBe(true);
    await expect(picker.locator('#audio option[value="application"]')).toBeEnabled();
    await picker.locator('[data-type="browser"]').click();
    await picker.locator('#contentURL').fill('http://127.0.0.1:'+content.address().port);
    await picker.locator('#openContent').click();
    let tab;await expect.poll(()=>{tab=app.windows().find(p=>p.url().startsWith('http://127.0.0.1:'+content.address().port));return !!tab}).toBe(true);
    assert.equal(await tab.evaluate(()=>typeof window.StreamWebRomCapture),'undefined','content tabs must not receive the native bridge');
    await picker.locator('#audio').selectOption('none');
    await picker.locator('.capture-source').filter({hasText:'Contenido de prueba'}).click();
    await expect(room.locator('#backstage [data-id="host-screen"]')).toBeVisible({timeout:45000});
    const video=room.locator('#backstage [data-id="host-screen"] video').first();
    await expect.poll(()=>video.evaluate(v=>v.videoWidth),{timeout:15000}).toBeGreaterThan(0);
    assert.equal(await room.evaluate(()=>typeof require),'undefined');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({sameStudioInterface:true,nativeModuleLoaded:true,unauthorizedCaptureRejected:true,contentTabSandboxed:true,selectedTabVideoPublished:true,pageErrors:errors}));
  }catch(e){console.error('Studio notices:',await room?.locator('#toasts').innerText().catch(()=>''));console.error(diagnostic.join(''));throw e}
  finally{await app.close();await new Promise(resolve=>content.close(resolve))}
})().catch(e=>{console.error(e);process.exitCode=1});
