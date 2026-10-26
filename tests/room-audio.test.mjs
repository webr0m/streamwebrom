import {test} from 'node:test';
import assert from 'node:assert/strict';
import {moduleURL} from './module-url.mjs';

class Stream extends EventTarget {
  constructor(tracks=[]){super();this.tracks=tracks} getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio')}
  addTrack(t){this.tracks.push(t);this.dispatchEvent(new Event('addtrack'))}
}
class Audio extends EventTarget {
  constructor(){super();this.dataset={};this.paused=true;this.muted=false;this.volume=1;this.block=false;this.calls=0}
  play(){this.calls++;if(this.block)return Promise.reject(new Error('gesture required'));this.paused=false;return Promise.resolve()}
  pause(){this.paused=true} remove(){this.removed=true}
}
const doc=new EventTarget();doc.visibilityState='visible';doc.body={append(){}};doc.createElement=()=>new Audio();
globalThis.document=doc;globalThis.window=new EventTarget();globalThis.MediaStream=Stream;
Object.defineProperty(globalThis,'navigator',{value:{audioSession:{type:'auto'}},configurable:true});
const {RoomAudio}=await import(await moduleURL('room-audio.js'));
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('late audio tracks start on a separate media element and keep playing when video is hidden',async()=>{
 const playback=new RoomAudio();const stream=new Stream();const audio=playback.add('guest',stream);
 assert.equal(audio.calls,0);stream.addTrack({kind:'audio',readyState:'live'});await settle();
 assert.equal(audio.paused,false);assert.equal(audio.srcObject.getAudioTracks().length,1);
 doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));
 assert.equal(audio.paused,false);assert.equal(playback.get('guest'),audio);
 playback.close();assert.equal(audio.srcObject,null);assert.equal(navigator.audioSession.type,'auto');doc.visibilityState='visible';
});
test('blocked playback is recovered by an actual user gesture without permanently muting participants',async()=>{
 let blocked=false;const playback=new RoomAudio(v=>blocked=v);const stream=new Stream([{kind:'audio'}]);
 const audio=playback.add('guest',stream);await settle();audio.pause();audio.block=true;playback.resume();await settle();
 assert.equal(blocked,true);assert.equal(audio.muted,false);
 audio.block=false;doc.dispatchEvent(new Event('pointerdown'));await settle();
 assert.equal(blocked,false);assert.equal(audio.paused,false);playback.close();
});
test('replacing a source detaches old listeners and does not retain old audio',async()=>{
 const playback=new RoomAudio();const oldStream=new Stream([{kind:'audio'}]);const old=playback.add('same-id',oldStream);await settle();
 const fresh=playback.add('same-id',new Stream([{kind:'audio'}]));await settle();
 assert.equal(old.srcObject,null);assert.equal(old.paused,true);assert.equal(old.removed,true);
 const calls=old.calls;oldStream.addTrack({kind:'audio'});assert.equal(old.calls,calls);
 fresh.volume=.35;fresh.muted=true;playback.resume();assert.equal(fresh.volume,.35);assert.equal(fresh.muted,true);playback.close();
});
