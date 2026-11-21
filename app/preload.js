const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getStatus: (...args) => ipcRenderer.invoke('get-status', ...args),
  getConfig: (...args) => ipcRenderer.invoke('get-config', ...args),
  saveConfig: (...args) => ipcRenderer.invoke('save-config', ...args),
  start: (...args) => ipcRenderer.invoke('start', ...args),
  stop: (...args) => ipcRenderer.invoke('stop', ...args),
  getLogs: (...args) => ipcRenderer.invoke('get-logs', ...args),
  openExternal: (...args) => ipcRenderer.invoke('open-external', ...args),
  pickStateFile: (...args) => ipcRenderer.invoke('pick-state-file', ...args),
  capture: (...args) => ipcRenderer.invoke('capture', ...args),

  onState: (callback) => {
    const listener = (_event, ...args) => callback(...args);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  },
  onLog: (callback) => {
    const listener = (_event, ...args) => callback(...args);
    ipcRenderer.on('log', listener);
    return () => ipcRenderer.removeListener('log', listener);
  },
  onConnection: (callback) => {
    const listener = (_event, ...args) => callback(...args);
    ipcRenderer.on('connection', listener);
    return () => ipcRenderer.removeListener('connection', listener);
  }
});
