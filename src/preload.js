'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // popup
  onShow: (fn) => ipcRenderer.on('popup:show', (_e, payload) => fn(payload)),
  resize: (width, height) => ipcRenderer.send('popup:size', { width, height }),
  close: () => ipcRenderer.send('popup:close'),
  openSettings: () => ipcRenderer.send('popup:settings'),
  // settings
  getState: () => ipcRenderer.invoke('settings:get'),
  onState: (fn) => ipcRenderer.on('settings:state', (_e, s) => fn(s)),
  loadBuild: (input) => ipcRenderer.invoke('settings:loadBuild', input),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  checkText: (text) => ipcRenderer.invoke('settings:checkText', text),
  openLog: () => ipcRenderer.invoke('settings:openLog'),
});
