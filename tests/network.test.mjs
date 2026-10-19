import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.location={search:'',hash:''};
const rtc=await readFile(new URL('../web/js/rtc.js',import.meta.url),'utf8');
const rtcURL='data:text/javascript;base64,'+Buffer.from(rtc).toString('base64');
const source=(await readFile(new URL('../web/js/network.js',import.meta.url),'utf8')).replace('"./rtc.js"',JSON.stringify(rtcURL));
const {chooseRoute,routeCandidates}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const cfg={ice:[{urls:'turns:cloud.test:443?transport=tcp'}],localIce:[{urls:'turns:local.test:443?transport=tcp'}],relay:{provider:'cloudflare'}};

test('automatic route checks Cloudflare and selects local before room admission if media fails',async()=>{
  const checks=[],progress=[];
  const mode=await chooseRoute(cfg,async mode=>{checks.push(mode);if(mode==='tls')throw Error('allocation worked but video failed');},mode=>progress.push(mode));
  assert.equal(mode,'local');assert.deepEqual(checks,['tls','local']);assert.deepEqual(progress,checks);
});
test('healthy principal route does not need a second relay or a user choice',async()=>{
  const checks=[];assert.equal(await chooseRoute(cfg,async mode=>checks.push(mode)),'tls');assert.deepEqual(checks,['tls']);
});
test('quota fallback is respected before the automatic connection check',()=>{
  assert.deepEqual(routeCandidates({...cfg,relay:{provider:'local'}}),['local']);
});
test('unavailable relays fail before joining the backstage instead of waiting indefinitely',async()=>{
  await assert.rejects(chooseRoute(cfg,async()=>{throw Error('blocked');}),/comprobar una ruta de video/);
});
test('LAN installations without a TLS relay retain direct automatic connection',async()=>{
  assert.equal(await chooseRoute({ice:[]},()=>{throw Error('must not probe');}),'auto');
});
