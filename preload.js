const { contextBridge, ipcRenderer } = require('electron');

const on = (ch) => (cb) => ipcRenderer.on(ch, (_e, v) => cb(v));

contextBridge.exposeInMainWorld('slayerBridge', {
  setInteractive: (v) => ipcRenderer.send('set-interactive', !!v),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: (wasClick) => ipcRenderer.send('drag-end', !!wasClick),
  refresh: () => ipcRenderer.send('refresh'),
  openMenu: () => ipcRenderer.send('open-menu'),
  login: (svc) => ipcRenderer.send('login', svc),
  pet: (id, kind) => ipcRenderer.send('pet', id, kind),
  event: (name) => ipcRenderer.send('event', name),
  scaleBy: (d) => ipcRenderer.send('scale-by', d),
  cardDone: (dataUrl) => ipcRenderer.send('card-done', dataUrl),
  statsCardDone: (dataUrl) => ipcRenderer.send('stats-card-done', dataUrl),
  ready: () => ipcRenderer.send('ready'),
  onUsage: on('usage'),
  onSettings: on('settings'),
  onPacks: on('packs'),
  onLayout: on('layout'),
  onCommand: on('command'),
  onAchievement: on('achievement'),
  onMakeCard: on('make-card'),
  onMakeStatsCard: on('make-stats-card'),
});
