import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moduleURL } from './module-url.mjs';
const { senderProfile, needsOutputSource } = await import(await moduleURL('bandwidth.js'));
const { relayMessage } = await import(await moduleURL('relay-status.js'));

test('room profiles cap camera rate/fps/raster in either orientation and preserve lower requests', () => {
  const opts={videoKbps:6000,audioKbps:128,fps:60};
  for (const size of [{width:1920,height:1080},{width:1080,height:1920}]) {
    assert.deepEqual(senderProfile('balanced',opts,size),{videoKbps:1500,audioKbps:64,fps:24,scale:1.5});
    assert.deepEqual(senderProfile('eco',opts,size),{videoKbps:900,audioKbps:48,fps:20,scale:2});
  }
  assert.equal(senderProfile('balanced',{videoKbps:500,fps:15},{width:640,height:360}).videoKbps,500);
  assert.equal(senderProfile('balanced',{videoKbps:500,fps:15},{width:640,height:360}).scale,1);
});
test('program quality is preserved; screen detail and stereo have separate budgets', () => {
  assert.equal(senderProfile('eco',{kind:'program',videoKbps:4500,fps:60},{width:1920,height:1080}).videoKbps,4500);
  assert.equal(senderProfile('balanced',{kind:'screen',stereo:true,fps:60},{width:1920,height:1080}).scale,1);
  assert.equal(senderProfile('balanced',{kind:'screen',stereo:true,fps:60}).audioKbps,128);
  assert.equal(senderProfile('eco',{kind:'screen',fps:60}).fps,8);
  assert.equal(senderProfile('quality',{videoKbps:16000,fps:60},{width:3840,height:2160}).scale,1);
});
test('OBS subscribes only the selected live scene, preserving hidden-source audio and individual links', () => {
  const state={stage:['a'],hidden:{a:true},outputs:{'2':{stage:['b']}}};
  assert.equal(needsOutputSource({id:'a',kind:'camera'},state,null,'1'),true);
  assert.equal(needsOutputSource({id:'b',kind:'camera'},state,null,'1'),false);
  assert.equal(needsOutputSource({id:'b',kind:'camera'},state,null,'2'),true);
  assert.equal(needsOutputSource({id:'a',kind:'camera'},state,null,'2'),false);
  assert.equal(needsOutputSource({id:'a',kind:'camera'},state,'a','2'),true);
  assert.equal(needsOutputSource({id:'program',kind:'program'},{stage:['program']},null,'1'),false);
});
test('host receives early usage warning, countdown and local confirmation without claiming billing cap', () => {
  const st={provider:'cloudflare',warning:false,usageBytes:44000000000,estimatedBytes:94000000000,budgetBytes:900000000000};
  assert.equal(relayMessage(st).warning,false);
  assert.equal(relayMessage({...st,warning:true}).warning,true);
  assert.match(relayMessage({...st,switchAt:16000},1000).text,/15 s/);
  assert.match(relayMessage({...st,provider:'local',reason:'quota'}).text,/corte preventivo/);
  assert.match(relayMessage({...st,provider:'local',reason:'state-unavailable'}).text,/no se pudo verificar/);
});
