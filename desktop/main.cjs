'use strict';
const {app,BrowserWindow,desktopCapturer,ipcMain,Menu,shell,powerSaveBlocker}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {serverURL,trustedFrame,audioPlan,CaptureLease}=require('./policy.cjs');
const {NativeBackend}=require('./native-backend.cjs');
let native=null;
if(process.platform==='win32')try{native=require('./vendor/native-audio/build/Release/electron_native_screenshare.node')}catch(e){console.error('Native audio could not load:',e.message)}
const testMode=process.argv.includes('--capture-test');
let main=null,home=null,origin='',picker=null,pendingPicker=null,preferences={},blocker=null;
const contents=new Map();
const backend=new NativeBackend();
const lease=new CaptureLease(()=>{backend.stop();if(blocker!==null){powerSaveBlocker.stop(blocker);blocker=null}});
const opts=preload=>({contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,backgroundThrottling:false,preload:path.join(__dirname,preload)});
function safeOpen(url){try{if(new URL(url).protocol==='https:')shell.openExternal(url)}catch{}}
function roomEvent(e){if(!trustedFrame(e,main?.webContents,origin))throw new Error('La captura solo está disponible en la sala abierta');}
function localEvent(e,win,file){if(!win||win.isDestroyed()||e.sender!==win.webContents||e.senderFrame!==win.webContents.mainFrame||e.senderFrame.url!==pathToFileURL(path.join(__dirname,file)).href)throw new Error('Solicitud no válida');}
function closePicker(){const pending=pendingPicker;pendingPicker=null;if(pending)pending.callback(null);if(picker&&!picker.isDestroyed())picker.close();picker=null;}
function stopAll(){closePicker();lease.clear();}
function nativeWindowID(win){try{const b=win.getNativeWindowHandle();return (b.length>=8?b.readBigUInt64LE():BigInt(b.readUInt32LE())).toString()}catch{return ''}}
async function sourceList(){
  const all=await desktopCapturer.getSources({types:['window','screen'],thumbnailSize:{width:320,height:180},fetchWindowIcons:false});
  const own=new Set(BrowserWindow.getAllWindows().map(nativeWindowID));
  const sources=all.filter(s=>!s.id.startsWith('window:')||!own.has(s.id.split(':')[1])).map(s=>({...s,kind:s.id.startsWith('screen:')?'screen':'window'}));
  for(const [id,win] of contents){
    if(win.isDestroyed()){contents.delete(id);continue}
    sources.push({id:'tab:'+id,name:win.getTitle()||'Pestaña web',kind:'browser',frame:win.webContents.mainFrame,thumbnail:await win.webContents.capturePage().catch(()=>null)});
  }
  return sources;
}
function contentURL(value){
  const u=serverURL(value);
  if(u.origin===origin)throw new Error('Comparte una pestaña de contenido distinta de la sala para evitar el retorno de voces');
  return u;
}
async function openContent(value){
  const u=contentURL(value);
  const win=new BrowserWindow({width:1000,height:720,title:'Contenido · StreamWebRom',webPreferences:{...opts('content-preload.cjs'),partition:'persist:streamwebrom-content'}});
  contents.set(win.id,win);
  const guard=(event,target)=>{try{contentURL(target)}catch{event.preventDefault()}};
  win.webContents.on('will-navigate',guard);win.webContents.on('will-redirect',guard);
  win.webContents.setWindowOpenHandler(({url})=>{safeOpen(url);return {action:'deny'}});
  win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  win.webContents.session.setPermissionCheckHandler(()=>false);
  win.on('closed',()=>contents.delete(win.id));
  await win.loadURL(u.href);return true;
}
function showPicker(request,callback){
  if(pendingPicker||!main||request.frame!==main.webContents.mainFrame||!request.userGesture||new URL(request.securityOrigin).origin!==origin){callback(null);return}
  pendingPicker={request,callback,sources:new Map()};
  picker=new BrowserWindow({parent:main,width:840,height:700,minWidth:560,minHeight:450,modal:true,title:'Compartir · StreamWebRom',webPreferences:opts('picker-preload.cjs')});
  picker.setMenu(null);
  picker.on('closed',()=>{picker=null;const old=pendingPicker;pendingPicker=null;if(old)old.callback(null)});
  picker.loadFile('picker.html');
}
function createRoom(value){
  const u=serverURL(value);origin=u.origin;
  main=new BrowserWindow({width:1380,height:900,minWidth:720,minHeight:500,title:'StreamWebRom',webPreferences:{...opts('preload.cjs'),partition:'persist:streamwebrom-room'}});
  const wc=main.webContents;
  wc.session.setPermissionCheckHandler((contents,permission,requestingOrigin)=>contents===wc&&['media','display-capture','fullscreen','speaker-selection'].includes(permission)&&requestingOrigin===origin);
  wc.session.setPermissionRequestHandler((contents,permission,callback,details)=>{
    let allowed=false;try{allowed=contents===wc&&new URL(details.requestingUrl||wc.getURL()).origin===origin&&['media','display-capture','fullscreen','speaker-selection'].includes(permission)}catch{}
    callback(allowed);
  });
  wc.session.setDisplayMediaRequestHandler((request,callback)=>{try{showPicker(request,callback)}catch{callback(null)}});
  wc.on('will-navigate',(e,target)=>{try{if(serverURL(target).origin!==origin)e.preventDefault()}catch{e.preventDefault()}});
  wc.on('will-redirect',(e,target)=>{try{if(serverURL(target).origin!==origin)e.preventDefault()}catch{e.preventDefault()}});
  wc.setWindowOpenHandler(({url})=>{safeOpen(url);return {action:'deny'}});
  wc.on('did-start-navigation',(_e,_url,inPlace,isMain)=>{if(isMain&&!inPlace)stopAll()});
  wc.on('render-process-gone',stopAll);
  main.on('closed',()=>{stopAll();main=null;for(const win of contents.values())if(!win.isDestroyed())win.close();contents.clear()});
  main.loadURL(u.href);return main;
}
function showHome(){
  home=new BrowserWindow({width:800,height:620,title:'StreamWebRom · Captura avanzada',webPreferences:opts('home-preload.cjs')});
  home.setMenu(null);home.loadFile('home.html');
}
ipcMain.handle('app:connect',(e,url)=>{localEvent(e,home,'home.html');createRoom(url);home.close();home=null;return true});
ipcMain.handle('capture:preferences',(e,value)=>{roomEvent(e);preferences={theme:value?.theme==='light'?'light':'dark'};return true});
ipcMain.handle('picker:load',async e=>{
  localEvent(e,picker,'picker.html');const current=pendingPicker;if(!current)throw new Error('La selección terminó');
  const list=await sourceList();if(pendingPicker!==current)throw new Error('La selección terminó');
  current.sources=new Map(list.map(s=>[s.id,s]));
  return {theme:preferences.theme,nativeAudio:!!native,sources:list.map(s=>({id:s.id,kind:s.kind,name:s.name,thumbnail:s.thumbnail?.toDataURL?.()||''}))};
});
ipcMain.handle('picker:content',async(e,url)=>{localEvent(e,picker,'picker.html');return openContent(url)});
ipcMain.on('picker:cancel',e=>{localEvent(e,picker,'picker.html');closePicker()});
ipcMain.handle('picker:choose',async(e,choice)=>{
  localEvent(e,picker,'picker.html');const current=pendingPicker;if(!current)throw new Error('La selección terminó');
  const source=current.sources.get(choice?.id);if(!source)throw new Error('Actualiza la lista y elige una fuente disponible');
  let pid=0;
  if(source.kind==='window'&&choice.audio==='application'&&native)pid=native.getPidFromHwnd(Number(source.id.split(':')[1]));
  const plan=audioPlan({...source,pid},current.request.audioRequested?choice.audio:'none',process.pid);
  if(plan.mode==='native'&&!native)throw new Error('El audio nativo no está disponible. Elige Sin audio o una pestaña web');
  if(source.kind==='browser'&&(source.frame?.detached||!contents.has(Number(source.id.slice(4)))))throw new Error('La pestaña ya se cerró');
  const approved=lease.create({plan,kind:source.kind,name:source.name,owner:main.webContents,frames:0});
  const streams={video:source.kind==='browser'?source.frame:{id:source.id,name:source.name}};
  if(plan.mode==='tab'){streams.audio=source.frame;streams.enableLocalEcho=true}
  pendingPicker=null;
  try{current.callback(streams)}catch(e){lease.clear(approved.id);throw e}
  picker.close();picker=null;return true;
});
ipcMain.handle('capture:take',e=>{roomEvent(e);const s=lease.current;if(!s||s.owner!==e.sender)throw new Error('No hay una selección autorizada');return {id:s.id,kind:s.kind,name:s.name,mode:s.plan.mode}});
ipcMain.handle('capture:start',async(e,id)=>{
  roomEvent(e);const s=lease.get(id);if(!s||s.owner!==e.sender||s.plan.mode!=='native'||s.started)throw new Error('La selección de audio ya no está disponible');
  s.started=true;
  try{
    await backend.start(s.plan,packet=>{
      let authorized=false;try{authorized=lease.current===s&&!s.owner.isDestroyed()&&new URL(s.owner.getURL()).origin===origin}catch{}
      const {meta,pcm}=packet;
      if(!authorized||s.frames>=6||!meta.isFloat||meta.bitsPerSample!==32||meta.channels!==2||meta.sampleRate!==48000||pcm.byteLength>384000||pcm.byteLength%8){backend.ack();return}
      s.frames++;s.owner.send('capture:audio',{id:s.id,rate:48000,channels:2,pcm});
    },()=>{if(lease.current===s){s.owner.send('capture:error',{id:s.id,message:'La fuente de audio se detuvo. Vuelve a elegir qué compartir.'});lease.clear(s.id)}});
    if(lease.current!==s){backend.stop();throw new Error('La selección terminó')}
    blocker=powerSaveBlocker.start('prevent-app-suspension');return true;
  }catch(error){console.error('Native capture:',error.message);lease.clear(id);throw new Error('Windows no permitió capturar el audio. Elige otra aplicación o Sin audio.')}
});
ipcMain.on('capture:ack',(e,id)=>{if(trustedFrame(e,main?.webContents,origin)){const s=lease.get(id);if(s){s.frames=Math.max(0,s.frames-1);backend.ack()}}});
ipcMain.handle('capture:stop',(e,id)=>{roomEvent(e);return lease.clear(id)});
app.whenReady().then(()=>{
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'StreamWebRom',submenu:[{label:'Cambiar servidor',click:()=>{showHome();if(main)main.close()}},{role:'quit'}]},{label:'Vista',submenu:[{role:'reload'},{role:'togglefullscreen'},{role:'zoomIn'},{role:'zoomOut'},{role:'resetZoom'}]}]));
  const arg=process.argv.find(a=>a.startsWith('--url='));if(arg)createRoom(arg.slice(6));else showHome();
});
app.on('before-quit',stopAll);
app.on('window-all-closed',()=>app.quit());
module.exports={openContent,createRoom,nativeAvailable:()=>!!native,testMode};
