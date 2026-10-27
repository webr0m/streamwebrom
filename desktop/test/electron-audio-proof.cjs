// Headless physical-PC audit of Chromium's audio process tree and the actual
// utility-process PCM path. Only spectral scores are printed; PCM is not saved.
const {app,BrowserWindow}=require('electron');const path=require('node:path');const assert=require('node:assert/strict');
const {NativeBackend}=require('../native-backend.cjs');
function db(samples,f){let a=0,b=0;const c=2*Math.cos(2*Math.PI*f/48000),n=samples.length;for(let i=0;i<n;i++){const q=samples[i]*(.5-.5*Math.cos(2*Math.PI*i/(n-1)))+c*a-b;b=a;a=q}return 20*Math.log10(Math.max(1e-12,4*Math.sqrt(Math.max(0,a*a+b*b-c*a*b))/n))}
let win;const backend=new NativeBackend();
const deadline=setTimeout(()=>{console.error('Audio audit timed out');backend.stop();app.exit(1)},18000);
app.whenReady().then(async()=>{
  win=new BrowserWindow({show:false,webPreferences:{offscreen:true,backgroundThrottling:false,nodeIntegration:false,contextIsolation:true,sandbox:true,autoplayPolicy:'no-user-gesture-required'}});
  await win.loadFile(path.join(__dirname,'electron-voice.html'));
  assert.equal(await win.webContents.executeJavaScript('window.voiceReady'),'running');
  const results=[];
  for(const include of [true,false]){
    const sample=await new Promise(async(resolve,reject)=>{
      const samples=new Float32Array(48000);let count=0,readyAt=Date.now();
      try{await backend.start({pid:process.pid,include},packet=>{
        backend.ack();if(Date.now()-readyAt<500)return;
        const data=new Float32Array(packet.pcm);for(let i=0;i<data.length&&count<samples.length;i+=2)samples[count++]=data[i];
        if(count===samples.length){backend.stop();resolve({voiceDB:db(samples,440),contentDB:db(samples,880)})}
      },reject)}catch(e){reject(e)}
    });
    const wanted=include?sample.voiceDB:sample.contentDB,other=include?sample.contentDB:sample.voiceDB;
    assert.ok(wanted>-70&&wanted-other>24,JSON.stringify({include,...sample}));results.push({includeCallTree:include,...sample});
  }
  const tab=new BrowserWindow({show:false,webPreferences:{offscreen:true,backgroundThrottling:false,nodeIntegration:false,contextIsolation:true,sandbox:true,autoplayPolicy:'no-user-gesture-required'}});
  await tab.loadFile(path.join(__dirname,'electron-voice.html'),{query:{frequency:'660'}});
  assert.equal(await tab.webContents.executeJavaScript('window.voiceReady'),'running');
  win.webContents.session.setPermissionRequestHandler((_wc,_permission,allow)=>allow(true));
  win.webContents.session.setPermissionCheckHandler(()=>true);
  win.webContents.session.setDisplayMediaRequestHandler((_request,allow)=>allow({video:tab.webContents.mainFrame,audio:tab.webContents.mainFrame,enableLocalEcho:true}));
  const tabResult=await win.webContents.executeJavaScript(`(async()=>{
    const media=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});
    const ctx=new AudioContext({sampleRate:48000}),src=ctx.createMediaStreamSource(new MediaStream(media.getAudioTracks())),an=ctx.createAnalyser();an.fftSize=8192;src.connect(an);await ctx.resume();await new Promise(r=>setTimeout(r,800));
    const bins=new Float32Array(an.frequencyBinCount);an.getFloatFrequencyData(bins);const power=f=>{const n=Math.round(f*8192/48000);return Math.max(...bins.slice(n-2,n+3))};
    const result={voiceDB:power(440),tabDB:power(660),externalDB:power(880)};src.disconnect();media.getTracks().forEach(t=>t.stop());await ctx.close();return result;
  })()`,true);
  assert.ok(tabResult.tabDB>-70&&tabResult.tabDB-tabResult.voiceDB>24&&tabResult.tabDB-tabResult.externalDB>24,JSON.stringify(tabResult));
  tab.destroy();
  console.log(JSON.stringify({physicalWindows:true,chromiumAudioTreeExcluded:true,actualUtilityProcessPCM:true,tabAudioIsolated:true,tabResult,noRawAudioSaved:true,results}));
  clearTimeout(deadline);backend.stop();win.destroy();app.exit(0);
}).catch(e=>{console.error(e);clearTimeout(deadline);backend.stop();if(win&&!win.isDestroyed())win.destroy();app.exit(1)});
