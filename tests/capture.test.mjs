import {test} from 'node:test';
import assert from 'node:assert/strict';
import {moduleURL} from './module-url.mjs';
globalThis.location={search:'',hash:'',pathname:'/guest',origin:'https://studio.test'};globalThis.document=new EventTarget();
let captureConfig;
Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{setCaptureHandleConfig:c=>captureConfig=c}},configurable:true});
const {openScreen,screenAudioNotice}=await import(await moduleURL('devices.js'));
class Track extends EventTarget {
 constructor(kind,settings={}){super();this.kind=kind;this.settings=settings;this.stopped=false;this.handle=null}
 getSettings(){return this.settings} getCaptureHandle(){return this.handle} stop(){this.stopped=true}
}
function capture(surface='browser',restricted=false){
 const video=new Track('video',{displaySurface:surface}),audio=new Track('audio',{restrictOwnAudio:restricted});
 const result={tracks:[video,audio],getVideoTracks(){return this.tracks.filter(t=>t.kind==='video')},getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio')},removeTrack(t){this.tracks=this.tracks.filter(x=>x!==t)}};
 return {result,video,audio};
}
test('unsupported display hints retry with audio instead of silently dropping it',async()=>{
 const calls=[];const {result}=capture();
 navigator.mediaDevices.getDisplayMedia=async opts=>{calls.push(opts);if(calls.length===1)throw new TypeError('unsupported hint');return result};
 assert.equal(await openScreen(),result);assert.equal(calls[0].systemAudio,'include');assert.equal(calls[1].audio,true);
 assert.equal(calls[0].windowAudio,'window');assert.equal(calls[0].audio.restrictOwnAudio,true);
 assert.equal(calls[0].selfBrowserSurface,'exclude');assert.equal(result.getAudioTracks().length,1);
 assert.deepEqual(captureConfig.permittedOrigins,['https://studio.test']);
 assert.match(screenAudioNotice(result),/con audio/);
});

test('unfiltered desktop/window or unknown audio cannot rebroadcast the participants voices',async()=>{
 for(const surface of ['monitor','window',undefined]){
  const {result,video,audio}=capture(surface);if(surface===undefined)video.settings={};
  navigator.mediaDevices.getDisplayMedia=async()=>result;
  assert.equal(await openScreen(),result);assert.deepEqual(result.getAudioTracks(),[]);
  assert.equal(audio.stopped,true);assert.equal(video.stopped,false);
  assert.match(screenAudioNotice(result),/Captura avanzada/);
 }
});

test('a browser-confirmed own-audio filter can preserve protected desktop audio',async()=>{
 const {result,audio}=capture('monitor',true);navigator.mediaDevices.getDisplayMedia=async()=>result;
 await openScreen();assert.equal(result.getAudioTracks()[0],audio);assert.equal(audio.stopped,false);
});

test('room self-capture remains video-only even when the browser ignores the exclusion hint',async()=>{
 const {result,video,audio}=capture();video.handle={handle:captureConfig.handle};
 navigator.mediaDevices.getDisplayMedia=async()=>result;await openScreen();
 assert.equal(audio.stopped,true);assert.equal(result.getVideoTracks()[0],video);
});

test('switching a captured tab to the room removes its return audio',async()=>{
 const {result,video,audio}=capture();
 navigator.mediaDevices.getDisplayMedia=async()=>result;
 await openScreen();assert.equal(audio.stopped,false);
 video.handle={handle:captureConfig.handle};video.dispatchEvent(new Event('capturehandlechange'));
 assert.equal(audio.stopped,true);assert.deepEqual(result.getAudioTracks(),[]);
});
test('denial or a failed display device does not reopen a picker or hide the error',async()=>{
 for(const name of ['NotAllowedError','AbortError','NotReadableError']){
  let calls=0;navigator.mediaDevices.getDisplayMedia=async()=>{calls++;throw Object.assign(new Error('capture failed'),{name})};
  await assert.rejects(openScreen(),e=>e.name===name);assert.equal(calls,1);
 }
 assert.match(screenAudioNotice({getAudioTracks:()=>[]}),/no incluye audio/);
});

test('window and full-screen requests keep source selection and request protected system audio',async()=>{
 for(const surface of ['window','monitor']){
  let options;const {result}=capture(surface,true);navigator.mediaDevices.getDisplayMedia=async value=>{options=value;return result};
  await openScreen({surface});assert.equal(options.video.displaySurface,surface);assert.equal(options.systemAudio,'include');assert.equal(options.windowAudio,'window');
  assert.equal(options.audio.restrictOwnAudio,true);assert.equal(result.getAudioTracks().length,1);
 }
});

test('no-audio selection cannot accidentally publish sound returned by an over-permissive picker',async()=>{
 const {result,audio}=capture('browser');let options;navigator.mediaDevices.getDisplayMedia=async value=>{options=value;return result};
 await openScreen({surface:'monitor',audio:false});assert.equal(options.audio,false);assert.equal(options.systemAudio,'exclude');
 assert.equal(result.getAudioTracks().length,0);assert.equal(audio.stopped,true);
});
