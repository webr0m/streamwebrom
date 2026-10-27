'use strict';
// Runs only in an Electron utility process. A broken audio driver cannot block
// the studio main process, and only six PCM packets may be outstanding.
const native=require('./vendor/native-audio/build/Release/electron_native_screenshare.node');
const port=process.parentPort;let outstanding=0,active=false,monitor;
function stop(){active=false;clearInterval(monitor);native.stopCapture()}
port.on('message',({data})=>{
  if(data.type==='ack'){outstanding=Math.max(0,outstanding-1);return}
  if(data.type==='stop'){stop();process.exit(0)}
  if(data.type!=='start'||active)return;
  try{
    active=true;
    native.startCapture(data.pid,data.include,(buffer,meta)=>{
      if(!active||outstanding>=6)return;outstanding++;
      port.postMessage({type:'pcm',meta,pcm:buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)});
    });
    port.postMessage({type:'started'});
    monitor=setInterval(()=>{if(active&&!native.isRunning()){stop();port.postMessage({type:'error',message:'El dispositivo de audio dejó de responder'})}},500);
  }catch(e){active=false;port.postMessage({type:'error',message:e.message})}
});
