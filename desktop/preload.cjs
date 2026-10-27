'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('StreamWebRomCapture',Object.freeze({
  version:1,
  preferences:opts=>ipcRenderer.invoke('capture:preferences',opts),
  take:()=>ipcRenderer.invoke('capture:take'),
  start:id=>ipcRenderer.invoke('capture:start',id),
  stop:id=>ipcRenderer.invoke('capture:stop',id),
  onAudio:fn=>{
    const listener=(_e,packet)=>{try{fn(packet)}finally{ipcRenderer.send('capture:ack',packet.id)}};
    ipcRenderer.on('capture:audio',listener);
    return ()=>ipcRenderer.removeListener('capture:audio',listener);
  },
}));
