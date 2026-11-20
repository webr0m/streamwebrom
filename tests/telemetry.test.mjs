import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moduleURL } from './module-url.mjs';
const moduleAt=async path=>import(await moduleURL(path.replace('../web/js/','')));
const {transportMetrics,metricText}=await moduleAt('../web/js/telemetry.js');
const {outputSize,outputFPS}=await moduleAt('../web/js/output-quality.js');

test('RTT uses the selected ICE pair, not stale successful pairs; unavailable is not zero',()=>{
  const report=new Map([
    ['old',{type:'candidate-pair',nominated:true,state:'succeeded',currentRoundTripTime:9}],
    ['selected',{type:'candidate-pair',state:'succeeded',currentRoundTripTime:.084}],
    ['transport',{type:'transport',selectedCandidatePairId:'selected'}],
    ['video',{type:'remote-inbound-rtp',jitter:.012}]
  ]);
  assert.deepEqual(transportMetrics(report),{rtt:84,jitter:12});
  assert.deepEqual(transportMetrics(new Map()),{rtt:null,jitter:null});
  assert.equal(metricText({updated:Date.now(),rtt:0,batteryPercent:63,charging:true}),'RTT 0 ms · 🔋63% ⚡');
  assert.equal(metricText({updated:Date.now()-16000,rtt:5}),'RTT —');
  assert.equal(metricText({updated:Date.now(),rtt:null,batteryPercent:null}),'RTT — · 🔋—');
});

test('all advertised output rasters preserve 16:9 and invalid sizes/fps are bounded',()=>{
  for(const h of [360,540,720,1080,1440,2160]){
    const [w,height]=outputSize(h);assert.equal(height,h);assert.equal(w/height,16/9);
  }
  assert.deepEqual(outputSize('999999999'),[1920,1080]);
  assert.equal(outputFPS('999999'),30);assert.equal(outputFPS('15'),15);
});

const {effectBudget}=await moduleAt('../web/js/effect-budget.js');
test('effect processing budgets bound landscape and portrait while retaining even frame sizes',()=>{
  for (const [w,h] of [[3840,2160],[2160,3840],[1280,720],[720,1280]]) {
    const b=effectBudget('fast',w,h);
    assert.ok(b.height<=720&&b.width<=1280);
    assert.equal(b.width%2,0);assert.equal(b.height%2,0);
    assert.ok(Math.abs(b.width/b.height-w/h)<.01);
    assert.ok(b.maskInterval>=1000/12);
  }
});
