const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('budgetApi', {
  load: () => ipcRenderer.invoke('budget:load'),
  save: (data) => ipcRenderer.invoke('budget:save', data),
  getInfo: () => ipcRenderer.invoke('budget:info'),
  chooseFile: () => ipcRenderer.invoke('budget:choose-file'),
  showInFolder: () => ipcRenderer.invoke('budget:show-in-folder'),
  exportCsv: (csv) => ipcRenderer.invoke('budget:export-csv', csv),
  txYears: () => ipcRenderer.invoke('tx:years'),
  txLoad: (year) => ipcRenderer.invoke('tx:load', year),
  txSave: (year, data) => ipcRenderer.invoke('tx:save', year, data),
  openCsv: () => ipcRenderer.invoke('csv:open'),
  latestRelease: () => ipcRenderer.invoke('app:latest-release'),
  importList: () => ipcRenderer.invoke('import:list'),
  importRead: (name) => ipcRenderer.invoke('import:read', name),
  importRemove: (name) => ipcRenderer.invoke('import:remove', name),
})
