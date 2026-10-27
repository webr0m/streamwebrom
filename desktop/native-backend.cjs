'use strict';
const {utilityProcess}=require('electron');const path=require('node:path');
class NativeBackend {
  constructor(spawn=()=>utilityProcess.fork(path.join(__dirname,'native-worker.cjs'),[],{serviceName:'StreamWebRom · Captura de audio',stdio:'pipe'})){this.worker=null;this.spawn=spawn;this.cancelPending=null;}
  start(plan,pcm,error){
    this.stop();const child=this.spawn();this.worker=child;
    return new Promise((resolve,reject)=>{
      let ready=false,done=false;
      const fail=message=>{
        if(done||this.worker!==child)return;done=true;clearTimeout(timer);this.stop();
        if(ready)error(message);else reject(new Error(message));
      };
      const timer=setTimeout(()=>fail('El servicio de audio no respondió'),10000);
      this.cancelPending=()=>{if(!ready&&!done){done=true;clearTimeout(timer);reject(Object.assign(new Error('La selección terminó'),{name:'AbortError'}))}};
      child.on('spawn',()=>child.postMessage({type:'start',pid:plan.pid,include:plan.include}));
      child.on('message',packet=>{
        if(this.worker!==child||done)return;
        if(packet.type==='started'){ready=true;this.cancelPending=null;clearTimeout(timer);resolve(true)}
        else if(packet.type==='error')fail(packet.message);
        else if(packet.type==='pcm')pcm(packet);
      });
      child.on('exit',()=>fail('El servicio de audio se cerró'));
      child.on('error',()=>fail('No se pudo iniciar el servicio de audio'));
    });
  }
  ack(){this.worker?.postMessage({type:'ack'})}
  stop(){
    this.cancelPending?.();this.cancelPending=null;
    const old=this.worker;this.worker=null;if(!old)return;
    try{old.postMessage({type:'stop'})}catch{}
    const timer=setTimeout(()=>{try{old.kill()}catch{}},250);timer.unref();
    old.once('exit',()=>clearTimeout(timer));
  }
}
module.exports={NativeBackend};
