const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('heroAPI', {
  loadContent: () => ipcRenderer.invoke('content:load'),
  loadSave: () => ipcRenderer.invoke('save:load'),
  writeSave: (data) => ipcRenderer.invoke('save:write', data),
  exportJson: (data, name) => ipcRenderer.invoke('save:export', data, name),
  importJson: () => ipcRenderer.invoke('save:import'),
  loadCustom: () => ipcRenderer.invoke('custom:load'),
  writeCustom: (data) => ipcRenderer.invoke('custom:save', data),
  loadActiveCustom: () => ipcRenderer.invoke('custom-active:load'),
  writeActiveCustom: (data) => ipcRenderer.invoke('custom-active:save', data),
  writeArt: (bytes, extension) => ipcRenderer.invoke('art:write', bytes, extension),
  listArt: () => ipcRenderer.invoke('art:list'),
  deleteArt: (names) => ipcRenderer.invoke('art:delete', names),
  loadSamplePack: () => ipcRenderer.invoke('content:sample'),
  // World Hub consumer
  worldhubStatus: () => ipcRenderer.invoke('worldhub:status'),
  worldhubStageZip: () => ipcRenderer.invoke('worldhub:stage-zip'),
  worldhubStageFolder: (path) => ipcRenderer.invoke('worldhub:stage-folder', path),
  worldhubActivate: (stagingId) => ipcRenderer.invoke('worldhub:activate', stagingId),
  worldhubDiscard: (stagingId) => ipcRenderer.invoke('worldhub:discard', stagingId),
  worldhubRollback: () => ipcRenderer.invoke('worldhub:rollback'),
  worldhubActiveDb: () => ipcRenderer.invoke('worldhub:active-db'),
  worldhubMigrateSave: (mapping) => ipcRenderer.invoke('worldhub:migrate-save', mapping)
});
