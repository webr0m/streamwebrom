'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('captureHome',Object.freeze({connect:url=>ipcRenderer.invoke('app:connect',url)}));
