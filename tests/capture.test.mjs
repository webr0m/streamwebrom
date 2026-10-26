import {test} from 'node:test';
import assert from 'node:assert/strict';
import {moduleURL} from './module-url.mjs';
globalThis.location={search:'',hash:''};globalThis.document=new EventTarget();
Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{}},configurable:true});
const {openScreen,screenAudioNotice}=await import(await moduleURL('devices.js'));
test('unsupported display hints retry with audio instead of silently dropping it',async()=>{
 const calls=[];const result={getAudioTracks:()=>[{}]};
 navigator.mediaDevices.getDisplayMedia=async opts=>{calls.push(opts);if(calls.length===1)throw new TypeError('unsupported hint');return result};
 assert.equal(await openScreen(),result);assert.equal(calls[0].systemAudio,'include');assert.equal(calls[1].audio,true);
 assert.match(screenAudioNotice(result),/con audio/);
});
test('denial or a failed display device does not reopen a picker or hide the error',async()=>{
 for(const name of ['NotAllowedError','AbortError','NotReadableError']){
  let calls=0;navigator.mediaDevices.getDisplayMedia=async()=>{calls++;throw Object.assign(new Error('capture failed'),{name})};
  await assert.rejects(openScreen(),e=>e.name===name);assert.equal(calls,1);
 }
 assert.match(screenAudioNotice({getAudioTracks:()=>[]}),/no incluye audio/);
});
