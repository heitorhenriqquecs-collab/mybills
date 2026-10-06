const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mybillsDesktop', {
  platform: process.platform,
  desktop: true,
  loadState: scope => ipcRenderer.invoke('mybills:load-state', scope),
  saveState: (scope, value) => ipcRenderer.invoke('mybills:save-state', scope, value),
  saveStateSync: (scope, value) => ipcRenderer.sendSync('mybills:save-state-sync', scope, value),
  exportBackup: value => ipcRenderer.invoke('mybills:export-backup', value),
  startLocalTransfer: (direction, value) => ipcRenderer.invoke('mybills:start-local-transfer', direction, value),
  cancelLocalTransfer: () => ipcRenderer.invoke('mybills:cancel-local-transfer'),
  onTransferReceived: callback => { const handler=(_event,value)=>callback(value);ipcRenderer.on('mybills:transfer-received',handler);return()=>ipcRenderer.removeListener('mybills:transfer-received',handler); }
});
