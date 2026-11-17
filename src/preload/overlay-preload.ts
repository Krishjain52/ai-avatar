// Preload for the "pick a spot" overlay. Plain require so it compiles to a script (sandboxed preloads need that);
// wrapped in a block so its names don't clash with preload.ts, which shares the same global scope at compile time.
{
  const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

  contextBridge.exposeInMainWorld('picker', {
    pick: (x: number, y: number) => ipcRenderer.send('spot-picked', x, y),
    cancel: () => ipcRenderer.send('pick-cancel'),
  });
}
