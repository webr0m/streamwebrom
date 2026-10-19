import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const moduleAt=async path=>import('data:text/javascript;base64,'+Buffer.from(await readFile(new URL(path,import.meta.url),'utf8')).toString('base64'));
const {fitTiles}=await moduleAt('../web/js/call-grid.js');
const {watchConnection}=await moduleAt('../web/js/connection-health.js');

test('participant layouts fit phone portrait, landscape and desktop without overflow',()=>{
  for(const [w,h] of [[308,480],[381,650],[832,240],[1260,660]])for(let count=1;count<=32;count++)for(const aspect of [1,16/9]){
    const fit=fitTiles(count,w,h,6,aspect);
    assert.ok(fit.width>0&&fit.height>0);
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
  t.mock.timers.tick(5900);assert.equal(loss,0);
  pc.connectionState='connected';pc.dispatchEvent(new Event('connectionstatechange'));
  t.mock.timers.tick(10000);assert.equal(loss,0);assert.equal(healthy,1);stop();
});

test('persistent or failed media reports one real loss, and cleanup cancels old timers',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const pc=new EventTarget();let loss=0;const stop=watchConnection(pc,()=>loss++);
  pc.connectionState='disconnected';pc.dispatchEvent(new Event('connectionstatechange'));
  t.mock.timers.tick(6001);assert.equal(loss,1);
  pc.connectionState='failed';pc.dispatchEvent(new Event('connectionstatechange'));assert.equal(loss,1);
  pc.connectionState='connected';pc.dispatchEvent(new Event('connectionstatechange'));
  pc.connectionState='failed';pc.dispatchEvent(new Event('connectionstatechange'));assert.equal(loss,2);
  pc.connectionState='connected';pc.dispatchEvent(new Event('connectionstatechange'));
  pc.connectionState='disconnected';pc.dispatchEvent(new Event('connectionstatechange'));stop();
  t.mock.timers.tick(10000);assert.equal(loss,2);
});
