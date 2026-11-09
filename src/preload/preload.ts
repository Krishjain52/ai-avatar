// Plain require (not `import`) so this compiles to a script, which sandboxed preloads need.
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

contextBridge.exposeInMainWorld('api', {
  setMode: (m: 'compact' | 'expanded') => ipcRenderer.invoke('set-mode', m),
  dragBy: (dx: number, dy: number) => ipcRenderer.send('drag-by', dx, dy),
  setClickThrough: (through: boolean) => ipcRenderer.send('click-through', through),
  search: (q: string) => ipcRenderer.invoke('search', q),
  goToCorner: () => ipcRenderer.invoke('go-corner'),
  goHome: () => ipcRenderer.invoke('go-home'),
  open: (p: string) => ipcRenderer.send('open-file', p),
  reveal: (p: string) => ipcRenderer.send('reveal-file', p),
  showMenu: () => ipcRenderer.send('show-menu'),
});
