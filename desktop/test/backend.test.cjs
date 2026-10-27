const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {NativeBackend}=require('../native-backend.cjs');
class Child extends EventEmitter{constructor(){super();this.sent=[]}postMessage(p){this.sent.push(p)}kill(){this.emit('exit',0)}}
test('cancelling a pending audio initialization settles its promise without leaving the studio blocked',async()=>{
  const child=new Child(),backend=new NativeBackend(()=>child);
  const pending=backend.start({pid:10,include:false},()=>{},()=>{});backend.stop();
  await assert.rejects(pending,e=>e.name==='AbortError');child.emit('exit',0);
});
test('only the active worker supplies PCM; a worker failure stops that capture without touching the room',async()=>{
  const children=[],backend=new NativeBackend(()=>{const c=new Child();children.push(c);return c});let frames=0,errors=0;
  const first=backend.start({pid:10,include:false},()=>frames++,()=>errors++);children[0].emit('message',{type:'started'});await first;
  const second=backend.start({pid:20,include:true},()=>frames++,()=>errors++);children[1].emit('message',{type:'started'});await second;
  children[0].emit('message',{type:'pcm'});assert.equal(frames,0);
  children[1].emit('message',{type:'pcm'});assert.equal(frames,1);
  children[1].emit('message',{type:'error',message:'device removed'});assert.equal(errors,1);assert.equal(backend.worker,null);
  children.forEach(c=>c.emit('exit',0));
});
