const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

// Einstellungen (Speicherort, Design …) im bisherigen Ordner ~/.config/budget belassen,
// auch nachdem die App in «budget-planer» umbenannt wurde. Ein explizit gesetzter Pfad bleibt unverändert.
if (path.basename(app.getPath('userData')) === 'budget-planer') {
  app.setPath('userData', path.join(app.getPath('appData'), 'budget'))
}

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

// Eine Sicherung pro Tag und Datei (die erste Version des Tages bleibt erhalten).
function backupOncePerDay(file, prefix = path.basename(file, '.json')) {
  if (!fs.existsSync(file)) return
  const day = new Date().toISOString().slice(0, 10)
  const dir = path.join(path.dirname(dataPath()), 'backups')
  const target = path.join(dir, `${prefix}-${day}.json`)
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

// Buchungen: eine Datei pro Jahr im Unterordner "buchungen"
const txDir = () => path.join(path.dirname(dataPath()), 'buchungen')
const txFile = (year) => {
  if (!/^\d{4}$/.test(String(year))) throw new Error('Ungültiges Jahr')
  return path.join(txDir(), `${year}.json`)
}

ipcMain.handle('tx:years', () => {
  if (!fs.existsSync(txDir())) return []
  return fs.readdirSync(txDir()).filter((f) => /^\d{4}\.json$/.test(f)).map((f) => Number(f.slice(0, 4))).sort()
})

ipcMain.handle('tx:load', (_e, year) => {
  const file = txFile(year)
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
})

ipcMain.handle('tx:save', (_e, year, data) => {
  const file = txFile(year)
  backupOncePerDay(file, `buchungen-${year}`)
  writeAtomic(file, JSON.stringify(data, null, 2))
  return { ok: true }
})

ipcMain.handle('csv:open', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Kontoauszug (CSV) importieren',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    properties: ['openFile'],
  })
  if (res.canceled || !res.filePaths[0]) return null
  const file = res.filePaths[0]
  return { name: path.basename(file), content: fs.readFileSync(file, 'utf8') }
})

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
  // Bestehende Daten übernehmen, falls am neuen Ort noch nichts liegt (Budget + Buchungen)
  if (!fs.existsSync(next) && fs.existsSync(current)) {
    writeAtomic(next, fs.readFileSync(current, 'utf8'))
    const fromTx = path.join(path.dirname(current), 'buchungen')
    const toTx = path.join(path.dirname(next), 'buchungen')
    if (fs.existsSync(fromTx) && !fs.existsSync(toTx)) fs.cpSync(fromTx, toTx, { recursive: true })
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

// Neueste Version auf GitHub abfragen (nur lesend, es werden keine Daten gesendet)
const REPO = 'Memurame/budget-planer'
ipcMain.handle('app:latest-release', async () => {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'budget-planer' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const r = await res.json()
    return { version: String(r.tag_name || '').replace(/^v/, ''), url: r.html_url, name: r.name }
  } catch {
    return null // offline o. Ä. – still ignorieren
  }
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
