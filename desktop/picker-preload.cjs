'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('capturePicker',Object.freeze({
  load:()=>ipcRenderer.invoke('picker:load'),
  choose:(id,audio)=>ipcRenderer.invoke('picker:choose',{id,audio}),
  content:url=>ipcRenderer.invoke('picker:content',url),
  cancel:()=>ipcRenderer.send('picker:cancel'),
}));
