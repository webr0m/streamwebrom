import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
let Processor;
globalThis.sampleRate=48000;
globalThis.AudioWorkletProcessor=class{constructor(){this.port={}}};
globalThis.registerProcessor=(name,ctor)=>{assert.equal(name,'swr-native-audio');Processor=ctor};
await import('data:text/javascript;base64,'+Buffer.from(await readFile(new URL('../web/js/native-audio-worklet.js',import.meta.url),'utf8')).toString('base64'));
test('native PCM stays stereo without adding microphone/room audio; underflow is silence',()=>{
  const p=new Processor(),out=[new Float32Array(128),new Float32Array(128)];p.process([],[out]);assert.ok(out.every(c=>c.every(x=>x===0)));
  const samples=new Float32Array(1024);for(let i=0;i<512;i++){samples[i*2]=.25;samples[i*2+1]=-.5}
  p.port.onmessage({data:{samples,rate:48000,channels:2}});p.process([],[out]);
  assert.ok(out[0].every(x=>x===.25));assert.ok(out[1].every(x=>x===-.5));
});
test('a stalled renderer cannot build an unbounded audio queue or replay old content',()=>{
  const p=new Processor(),samples=new Float32Array(48000*2).fill(.25);
  p.port.onmessage({data:{samples,rate:48000,channels:2}});
  assert.equal(p.write-p.read,4800);assert.ok(p.left.length<=4800);
  const fresh=new Float32Array(4800*2).fill(.75);p.port.onmessage({data:{samples:fresh,rate:48000,channels:2}});
  const out=[new Float32Array(128),new Float32Array(128)];p.process([],[out]);assert.ok(out[0].every(x=>x===.75));
});
test('invalid PCM is rejected or sanitized; sample rates are converted without runaway memory',()=>{
  const p=new Processor();p.port.onmessage({data:{samples:new Float32Array(10),channels:99,rate:48000}});assert.equal(p.write,0);
  const samples=new Float32Array(1024).fill(Infinity);p.port.onmessage({data:{samples,channels:2,rate:24000}});
  const out=[new Float32Array(128),new Float32Array(128)];p.process([],[out]);assert.equal(p.read,64);assert.ok(out.every(c=>c.every(x=>x===0)));
});
