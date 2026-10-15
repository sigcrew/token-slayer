const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('onboard', {
  getState: () => ipcRenderer.invoke('onb:state'),
  login: (id) => ipcRenderer.send('login', id),
  finish: (choices) => ipcRenderer.send('onb:finish', choices),
  onState: (cb) => ipcRenderer.on('onb:state', (_e, v) => cb(v)),
});
