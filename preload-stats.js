const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('statsBridge', {
  get: (opts) => ipcRenderer.invoke('stats:get', opts || {}),
  card: (data) => ipcRenderer.invoke('stats:card', data),
  onProgress: (cb) => ipcRenderer.on('stats:progress', (_e, v) => cb(v)),
});
