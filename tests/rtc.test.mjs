import { readFile } from 'node:fs/promises';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.location = { search: '', hash: '', protocol: 'https:', host: 'studio.test' };
const storage = new Map();
globalThis.sessionStorage = { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) };
class Socket {
  static sockets = [];
  constructor() { this.readyState = 0; this.sent = []; Socket.sockets.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  send(data) { this.sent.push(JSON.parse(data)); }
  receive(data) { this.onmessage?.({data:JSON.stringify(data)}); }
  close() { this.readyState = 3; this.onclose?.(); }
}
globalThis.WebSocket = Socket;
const source = await readFile(new URL('../web/js/rtc.js', import.meta.url), 'utf8');
const { Signal, readStored, waitConnected, iceConfiguration } = await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const signals=[];

test('restricted mobile mode uses only TLS/443 relay candidates',()=>{
  const servers=[{urls:'stun:stun.test:3478'},{urls:['turn:relay.test:3478?transport=udp','turn:relay.test:443?transport=tcp','turns:relay.test:5349?transport=tcp','turns:relay.test:443?transport=tcp'],username:'temporary',credential:'test'}];
  const cfg=iceConfiguration(servers,'tls');
  assert.equal(cfg.iceTransportPolicy,'relay');
  assert.deepEqual(cfg.iceServers,[{urls:['turns:relay.test:443?transport=tcp'],username:'temporary',credential:'test'}]);
  assert.equal(servers[1].urls.length,4);
  assert.deepEqual(iceConfiguration(servers).iceServers,servers);
  assert.throws(()=>iceConfiguration([{urls:'turn:relay.test:443?transport=tcp'}],'local'),/puerto 443/);
});

test('switching a single socket to local preserves admission and password in memory',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const s=signal(),ws=await connected(s);
  s.joinMsg.password='in-memory';s.useNetwork('local');
  t.mock.timers.tick(501);
  const retry=Socket.sockets.at(-1);retry.open();
  assert.equal(retry.sent[0].route,'local');assert.equal(retry.sent[0].rejoin,'pass');assert.equal(retry.sent[0].password,'in-memory');
  retry.receive({type:'welcome',ice:[],localIce:[{urls:'turns:local.test:443?transport=tcp'}]});
  await Promise.resolve();assert.equal(s.localIce.length,1);
});
afterEach(()=>{ signals.splice(0).forEach(s=>s.close()); Socket.sockets=[]; storage.clear(); });
function signal() { const s=new Signal();signals.push(s);return s; }
async function connected(s) {
  const joined=s.connect({type:'join',role:'guest',room:'test-room'});
  const ws=Socket.sockets.at(-1);ws.open();ws.receive({type:'welcome',ice:[],rejoin:'pass'});await joined;return ws;
}

test('offline requests fail immediately without replaying stale SDP',async()=>{
  const s=signal(); await assert.rejects(s.request({type:'publish'}),/disconnected/);
  assert.equal(s.queue.length,0);assert.equal(s.pending.size,0);
});
test('disconnect rejects pending requests and discards queued controls',async()=>{
  const s=signal(),ws=await connected(s);
  const request=s.request({type:'subscribe',stream:'cam'});
  ws.close(); await assert.rejects(request,/disconnected/);
  assert.equal(s.pending.size,0);assert.equal(s.queue.length,0);
});
test('close cancels a scheduled reconnect',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const s=signal(),ws=await connected(s);ws.close();s.close();t.mock.timers.tick(20000);
  assert.equal(Socket.sockets.length,1);
});
test('a rejected password permits an explicit retry without retry storms',async()=>{
  const s=signal();const initial=s.connect({type:'join',room:'test-room',password:'wrong'});
  const ws=Socket.sockets.at(-1);ws.open();ws.receive({type:'error',error:'invalid password'});
  await assert.rejects(initial,/invalid password/);
  await connected(s);assert.equal(Socket.sockets.length,2);
});
test('kicking a guest revokes its locally cached pass and stops reconnecting',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const s=signal(),ws=await connected(s);assert.equal(storage.get('swr.rejoin.test-room'),'pass');
  ws.receive({type:'kicked'});ws.close();t.mock.timers.tick(20000);
  assert.equal(storage.has('swr.rejoin.test-room'),false);assert.equal(Socket.sockets.length,1);
});
test('completed requests leave no timeout rejection behind',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const s=signal(),ws=await connected(s);const request=s.request({type:'subscribe',stream:'cam'});
  ws.receive({type:'offer',reqId:ws.sent.at(-1).reqId});assert.equal((await request).type,'offer');
  t.mock.timers.tick(20000);assert.equal(s.pending.size,0);
});
test('storage failures and malformed values fall back safely',()=>{
  globalThis.localStorage={getItem:()=>'{broken'};assert.deepEqual(readStored('rooms',{}),{});
  globalThis.localStorage={getItem:()=>{throw new Error('denied')}};assert.deepEqual(readStored('rooms',[]),[]);
  globalThis.localStorage={getItem:()=> '[]'};assert.deepEqual(readStored('rooms',{}),{});
});

test('a stalled mobile WebSocket rejects and permits retry',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const s=signal(), join=s.connect({type:'join',room:'test-room'});
  const rejection=assert.rejects(join,/servidor no respondió/);
  t.mock.timers.tick(20001);await rejection;
  assert.equal(Socket.sockets[0].readyState,3);
  await connected(s);
});

test('waiting for media reports missing TURN instead of hanging forever',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const pc=new EventTarget();pc.connectionState='connecting';
  const pending=assert.rejects(waitConnected(pc,[],30000),/no tiene uno configurado/);
  t.mock.timers.tick(30001);await pending;
});

test('media connection success and configured TURN failure have distinct results',async()=>{
  const pc=new EventTarget();pc.connectionState='connecting';
  const pending=waitConnected(pc,[]);pc.connectionState='connected';pc.dispatchEvent(new Event('connectionstatechange'));await pending;
  pc.connectionState='failed';await assert.rejects(waitConnected(pc,[{urls:'turns:relay.test:443?transport=tcp'}]),/Comprueba el servicio TURN/);
});

test('signalling loss cancels a pending media connection immediately',async()=>{
  const pc=new EventTarget();pc.connectionState='connecting';const controller=new AbortController();
  const pending=assert.rejects(waitConnected(pc,[],30000,controller.signal),/perdió la conexión con el servidor/);
  controller.abort();await pending;
});
