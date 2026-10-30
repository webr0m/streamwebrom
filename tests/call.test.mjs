import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moduleURL } from './module-url.mjs';
const moduleAt=async path=>import(await moduleURL(path.replace('../web/js/','')));
const {fitTiles,tileRects}=await moduleAt('../web/js/call-grid.js');
const {watchConnection}=await moduleAt('../web/js/connection-health.js');

test('participant layouts fit phone portrait, landscape and desktop without overflow',()=>{
  for(const [w,h] of [[308,480],[381,650],[832,240],[1260,660]])for(let count=1;count<=32;count++){
    const fit=fitTiles(count,w,h,6);
    assert.ok(fit.width>0&&fit.height>0);
    assert.ok(Math.abs(fit.width/fit.height-16/9)<.0001);
    assert.ok(fit.columns*fit.width+(fit.columns-1)*6<=w+.001);
    assert.ok(fit.rows*fit.height+(fit.rows-1)*6<=h+.001);
    assert.ok(fit.rows*fit.columns>=count);
  }
  assert.equal(fitTiles(0,300,500).rows,0);
});

test('a brief media interruption clears without asking to reconnect',t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});
  const pc=new EventTarget();let loss=0,healthy=0;
  const stop=watchConnection(pc,()=>loss++,()=>healthy++);
  pc.connectionState='disconnected';pc.dispatchEvent(new Event('connectionstatechange'));
  t.mock.timers.tick(9900);assert.equal(loss,0);
  pc.connectionState='connected';pc.dispatchEvent(new Event('connectionstatechange'));
  t.mock.timers.tick(10000);assert.equal(loss,0);assert.equal(healthy,1);stop();
});

test('persistent or failed media reports one real loss, and cleanup cancels old timers',t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});
  const pc=new EventTarget();let loss=0;const stop=watchConnection(pc,()=>loss++);
  pc.connectionState='disconnected';pc.dispatchEvent(new Event('connectionstatechange'));
  t.mock.timers.tick(10001);assert.equal(loss,1);
  pc.connectionState='failed';pc.dispatchEvent(new Event('connectionstatechange'));assert.equal(loss,1);
  pc.connectionState='connected';pc.dispatchEvent(new Event('connectionstatechange'));
  pc.connectionState='failed';pc.dispatchEvent(new Event('connectionstatechange'));assert.equal(loss,1);
  t.mock.timers.tick(10001);assert.equal(loss,2);
  pc.connectionState='connected';pc.dispatchEvent(new Event('connectionstatechange'));
  pc.connectionState='disconnected';pc.dispatchEvent(new Event('connectionstatechange'));stop();
  t.mock.timers.tick(10000);assert.equal(loss,2);
});

test('a reconnecting state or healthy ICE cancels a suspect-state deadline',t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});
  const pc=new EventTarget();let loss=0;const stop=watchConnection(pc,()=>loss++);
  pc.connectionState='disconnected';pc.dispatchEvent(new Event('connectionstatechange'));
  t.mock.timers.tick(9000);pc.connectionState='connecting';pc.dispatchEvent(new Event('connectionstatechange'));
  t.mock.timers.tick(20000);assert.equal(loss,0);
  pc.connectionState='disconnected';pc.iceConnectionState='connected';pc.dispatchEvent(new Event('iceconnectionstatechange'));
  t.mock.timers.tick(20000);assert.equal(loss,0);stop();
});

test('incoming consent/RTP activity prevents false loss; outgoing bytes alone do not',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});
  const pc=new EventTarget();pc.connectionState='disconnected';
  let received=1,sent=0,loss=0;
  pc.getStats=async()=>new Map([
    ['transport',{type:'transport',selectedCandidatePairId:'active'}],
    ['active',{id:'active',type:'candidate-pair',responsesReceived:received}],
    ['send',{id:'send',type:'outbound-rtp',bytesSent:sent}]
  ]);
  const stop=watchConnection(pc,()=>loss++);
  await Promise.resolve();
  for(let i=0;i<15;i++){received++;sent+=1000;t.mock.timers.tick(1000);await Promise.resolve();}
  assert.equal(loss,0);
  for(let i=0;i<11;i++){sent+=1000;t.mock.timers.tick(1000);await Promise.resolve();}
  assert.equal(loss,1);stop();
});

test('late statistics after recovery or cleanup cannot trigger a loss',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});
  const pc=new EventTarget();pc.connectionState='disconnected';let resolve,loss=0;
  pc.getStats=()=>new Promise(r=>resolve=r);
  const stop=watchConnection(pc,()=>loss++);
  pc.connectionState='connected';pc.dispatchEvent(new Event('connectionstatechange'));
  resolve(new Map());await Promise.resolve();t.mock.timers.tick(30000);
  assert.equal(loss,0);stop();
});

test('resumed packets clear an existing warning even before the browser updates its state',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});
  const pc=new EventTarget();pc.connectionState='failed';let bytes=1,loss=0,healthy=0;
  pc.getStats=async()=>new Map([['audio',{id:'audio',type:'inbound-rtp',bytesReceived:bytes}]]);
  const stop=watchConnection(pc,()=>loss++,()=>healthy++);await Promise.resolve();
  for(let i=0;i<11;i++){t.mock.timers.tick(1000);await Promise.resolve();}
  assert.equal(loss,1);bytes+=1000;t.mock.timers.tick(1000);await Promise.resolve();
  assert.equal(healthy,1);stop();
});

test('16:9 camera rectangles stay inside every screen, including focused side strips',()=>{
  for(const [w,h] of [[308,480],[381,650],[832,240],[1260,660]])for(let n=1;n<=32;n++)for(const focused of [-1,0,n-1]){
    const rects=tileRects(n,w,h,6,focused);
    assert.equal(rects.length,n);
    for(const [i,r] of rects.entries()){
      assert.ok(r.w>0&&r.h>0&&Math.abs(r.w/r.h-16/9)<.00001);
      assert.ok(r.x>=-.001&&r.y>=-.001&&r.x+r.w<=w+.001&&r.y+r.h<=h+.001);
      for(const [j,s] of rects.entries())if(i!==j)assert.ok(r.x+r.w<=s.x+.001||s.x+s.w<=r.x+.001||r.y+r.h<=s.y+.001||s.y+s.h<=r.y+.001);
    }
  }
  const focused=tileRects(6,900,350,6,0);
  assert.ok(focused[0].w>focused[1].w&&focused[1].x>=focused[0].x+focused[0].w);
});
