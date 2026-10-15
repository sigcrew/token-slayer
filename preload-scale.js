const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scaleBridge', {
  get: () => ipcRenderer.invoke('scale-get'),
  set: (v) => ipcRenderer.send('scale-set', v),   // 끄는 중 (바로 반영)
  commit: () => ipcRenderer.send('scale-commit'), // 놓았을 때 (메뉴 갱신)
  reset: () => ipcRenderer.send('scale-reset'),
  onChanged: (cb) => ipcRenderer.on('scale-changed', (_e, v) => cb(v)),
});
