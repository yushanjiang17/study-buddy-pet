const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snip', {
  done: (rect) => ipcRenderer.send('snip:done', rect),
});
