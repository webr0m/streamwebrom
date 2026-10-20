import { readFile } from 'node:fs/promises';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { moduleURL } from './module-url.mjs';

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
const { Signal, readStored, waitConnected, iceConfiguration, publish, subscribe } = await import(await moduleURL('rtc.js'));
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

test('manual reconnect replaces a live socket after checking the new route, preserving admission',async()=>{
  const s=signal(),old=await connected(s);s.joinMsg.password='in-memory';
  const pending=assert.rejects(s.request({type:'publish'}),/connection restarted/);
  let finish;const prepared=new Promise(resolve=>{finish=resolve});
  let resumed=0;s.on('reconnected',()=>resumed++);
  const restart=s.reconnect(async()=>{await prepared;s.mediaMode='local'});
  assert.equal(s.reconnect(),restart,'double clicks must share a single attempt');
  await pending;assert.equal(old.readyState,3);assert.equal(s.pending.size,0);
  assert.equal(Socket.sockets.length,1,'do not join before route selection finishes');
  finish();await new Promise(resolve=>setImmediate(resolve));
  const fresh=Socket.sockets.at(-1);assert.notEqual(fresh,old);fresh.open();
  assert.equal(fresh.sent[0].route,'local');assert.equal(fresh.sent[0].rejoin,'pass');
  assert.equal(fresh.sent[0].password,'in-memory');
  // A delayed callback from the old socket cannot cancel the fresh connection.
  old.onclose();old.receive({type:'kicked'});assert.equal(s.closed,false);
  fresh.receive({type:'welcome',ice:[],peerId:'new-peer'});
  await restart;assert.equal(resumed,1);assert.equal(s.restarting,null);
});

test('manual reconnect cancels automatic backoff and an unresponsive joining socket',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const s=signal(),old=await connected(s);old.close();
  const restart=s.reconnect();await new Promise(resolve=>setImmediate(resolve));
  const stalled=Socket.sockets.at(-1);
  t.mock.timers.tick(501);assert.equal(Socket.sockets.length,2,'backoff was cancelled');
  // Replacing a stalled join must settle its promise instead of hanging.
  const failed=assert.rejects(restart,/connection closed/);s.close();await failed;
  assert.equal(stalled.readyState,3);
});

test('failed route preparation can be retried, but leaving or being kicked cannot revive a guest',async()=>{
  const s=signal();await connected(s);
  await assert.rejects(s.reconnect(()=>{throw new Error('no route')}),/no route/);
  assert.equal(s.restarting,null);
  const restart=s.reconnect();await new Promise(resolve=>setImmediate(resolve));
  const fresh=Socket.sockets.at(-1);fresh.open();fresh.receive({type:'welcome',ice:[]});await restart;
  fresh.receive({type:'kicked'});
  await assert.rejects(s.reconnect(),/connection closed/);
  assert.equal(Socket.sockets.length,2);
});

test('cleanup of old publications and subscriptions cannot remove media on a new socket',async t=>{
  class Peer extends EventTarget {
    connectionState='connected';iceGatheringState='complete';localDescription={type:'offer',sdp:''};
    async createOffer(){return this.localDescription} async createAnswer(){return this.localDescription}
    async setLocalDescription(){} async setRemoteDescription(){} close(){this.connectionState='closed'}
  }
  globalThis.RTCPeerConnection=Peer;globalThis.MediaStream=class {};
  t.after(()=>{delete globalThis.RTCPeerConnection;delete globalThis.MediaStream});
  const s=signal(),old=await connected(s);s.trickle=true;
  s.request=async()=>({stream:'camera',sdp:{type:'answer',sdp:''}});
  const p=await publish(s,{getTracks:()=>[]});const sub=await subscribe(s,'remote');
  const count=old.sent.length;s.ws=new Socket();s.ws.open();
  p.stop();sub.close();
  assert.equal(old.sent.length,count);assert.deepEqual(s.ws.sent,[]);
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

test('a saved room retains participant identity across tabs and clears it on revocation',async()=>{
  const persistent=new Map();globalThis.localStorage={getItem:k=>persistent.get(k),setItem:(k,v)=>persistent.set(k,v),removeItem:k=>persistent.delete(k)};
  try {
    const s=signal(),ws=await connected(s);
    ws.receive({type:'room-persistent',persistent:true});
    assert.equal(persistent.get('swr.rejoin.test-room'),'pass');
    storage.clear();
    const second=signal(),joining=second.connect({type:'join',role:'guest',room:'test-room'});
    const socket=Socket.sockets.at(-1);socket.open();
    assert.equal(socket.sent[0].rejoin,'pass');
    socket.receive({type:'welcome',rejoin:'pass',persistent:true});await joining;
    socket.receive({type:'kicked'});
    assert.equal(persistent.has('swr.rejoin.test-room'),false);
  } finally {delete globalThis.localStorage}
});
test('disabling room persistence removes durable identity while retaining session reconnection',async()=>{
  const persistent=new Map();globalThis.localStorage={getItem:k=>persistent.get(k),setItem:(k,v)=>persistent.set(k,v),removeItem:k=>persistent.delete(k)};
  try {const s=signal(),ws=await connected(s);ws.receive({type:'room-persistent',persistent:true});ws.receive({type:'room-persistent',persistent:false});assert.equal(persistent.size,0);assert.equal(storage.get('swr.rejoin.test-room'),'pass')} finally {delete globalThis.localStorage}
});
