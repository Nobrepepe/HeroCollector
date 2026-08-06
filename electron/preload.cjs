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
  loadSamplePack: () => ipcRenderer.invoke('content:sample')
});
