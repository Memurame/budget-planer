const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const configPath = () => path.join(app.getPath('userData'), 'config.json')
const defaultDataPath = () => path.join(app.getPath('documents'), 'Budget', 'budget.json')

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')) } catch { return {} }
}
function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2))
}
function dataPath() {
  return readConfig().dataPath || defaultDataPath()
}

// Atomar schreiben: erst in eine temporäre Datei, dann umbenennen.
function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, content)
  fs.renameSync(tmp, file)
}

// Eine Sicherung pro Tag (die erste Version des Tages bleibt erhalten).
function backupOncePerDay(file) {
  if (!fs.existsSync(file)) return
  const day = new Date().toISOString().slice(0, 10)
  const dir = path.join(path.dirname(file), 'backups')
  const target = path.join(dir, `${path.basename(file, '.json')}-${day}.json`)
  if (fs.existsSync(target)) return
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(file, target)
}

ipcMain.handle('budget:load', () => {
  const file = dataPath()
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
})

ipcMain.handle('budget:save', (_e, data) => {
  const file = dataPath()
  backupOncePerDay(file)
  writeAtomic(file, JSON.stringify(data, null, 2))
  return { ok: true, savedAt: new Date().toISOString() }
})

ipcMain.handle('budget:info', () => ({ dataPath: dataPath() }))

ipcMain.handle('budget:choose-file', async () => {
  const res = await dialog.showSaveDialog({
    title: 'Speicherort der Budget-Datei',
    defaultPath: dataPath(),
    filters: [{ name: 'Budget (JSON)', extensions: ['json'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  })
  if (res.canceled || !res.filePath) return null
  const next = res.filePath.endsWith('.json') ? res.filePath : `${res.filePath}.json`
  const current = dataPath()
  // Bestehende Datei übernehmen, falls am neuen Ort noch nichts liegt
  if (!fs.existsSync(next) && fs.existsSync(current)) {
    writeAtomic(next, fs.readFileSync(current, 'utf8'))
  }
  writeConfig({ ...readConfig(), dataPath: next })
  return { dataPath: next }
})

ipcMain.handle('budget:show-in-folder', () => {
  const file = dataPath()
  if (fs.existsSync(file)) shell.showItemInFolder(file)
  else shell.openPath(path.dirname(file))
})

ipcMain.handle('budget:export-csv', async (_e, csv) => {
  const res = await dialog.showSaveDialog({
    title: 'Budget als CSV exportieren',
    defaultPath: path.join(path.dirname(dataPath()), 'budget-export.csv'),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  if (res.canceled || !res.filePath) return null
  fs.writeFileSync(res.filePath, '﻿' + csv) // BOM, damit Excel Umlaute korrekt liest
  return { path: res.filePath }
})

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Budget',
    backgroundColor: '#f6f6f4',
    icon: fs.existsSync(path.join(__dirname, '..', 'icon.png')) ? path.join(__dirname, '..', 'icon.png') : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Externe Links im Standardbrowser öffnen, nie in der App
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })

  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
