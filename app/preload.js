// Exposes a small, safe API to the page. The page cannot touch Node or the network directly.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  getConfig: () => ipcRenderer.invoke('pet:get-config'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('win:set-ignore', ignore),
  dragStart: () => ipcRenderer.send('win:drag-start'),
  dragMove: () => ipcRenderer.send('win:drag-move'),
  dragEnd: () => ipcRenderer.send('win:drag-end'),
  showMenu: () => ipcRenderer.send('menu:show'),
  chat: (payload) => ipcRenderer.invoke('chat:send', payload),
  api: (method, path, body) => ipcRenderer.invoke('api:call', { method, path, body }),
  snip: () => ipcRenderer.invoke('snip:start'),
  resizePanel: (w, h) => ipcRenderer.invoke('win:resize-panel', { w, h }),
  onPlay: (cb) => ipcRenderer.on('pet:play', (_e, state) => cb(state)),
  onToggleChat: (cb) => ipcRenderer.on('ui:toggle-chat', () => cb()),
});
