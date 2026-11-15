const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('budgetApi', {
  load: () => ipcRenderer.invoke('budget:load'),
  save: (data) => ipcRenderer.invoke('budget:save', data),
  getInfo: () => ipcRenderer.invoke('budget:info'),
  chooseFile: () => ipcRenderer.invoke('budget:choose-file'),
  showInFolder: () => ipcRenderer.invoke('budget:show-in-folder'),
  exportCsv: (csv) => ipcRenderer.invoke('budget:export-csv', csv),
})
