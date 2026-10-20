import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const moduleAt=async path=>import('data:text/javascript;base64,'+Buffer.from(await readFile(new URL(path,import.meta.url),'utf8')).toString('base64'));
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
  t.mock.timers.enable({apis:['setTimeout']});
  const pc=new EventTarget();let loss=0,healthy=0;
  const stop=watchConnection(pc,()=>loss++,()=>healthy++);
  pc.connectionState='disconnected';pc.dispatchEvent(new Event('connectionstatechange'));
  t.mock.timers.tick(9900);assert.equal(loss,0);
  pc.connectionState='connected';pc.dispatchEvent(new Event('connectionstatechange'));
  t.mock.timers.tick(10000);assert.equal(loss,0);assert.equal(healthy,1);stop();
});

test('persistent or failed media reports one real loss, and cleanup cancels old timers',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const pc=new EventTarget();let loss=0;const stop=watchConnection(pc,()=>loss++);
  pc.connectionState='disconnected';pc.dispatchEvent(new Event('connectionstatechange'));
  t.mock.timers.tick(10001);assert.equal(loss,1);
  pc.connectionState='failed';pc.dispatchEvent(new Event('connectionstatechange'));assert.equal(loss,1);
  pc.connectionState='connected';pc.dispatchEvent(new Event('connectionstatechange'));
  pc.connectionState='failed';pc.dispatchEvent(new Event('connectionstatechange'));assert.equal(loss,2);
  pc.connectionState='connected';pc.dispatchEvent(new Event('connectionstatechange'));
  pc.connectionState='disconnected';pc.dispatchEvent(new Event('connectionstatechange'));stop();
  t.mock.timers.tick(10000);assert.equal(loss,2);
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
