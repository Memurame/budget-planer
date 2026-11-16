// Electron: Datei auf der Festplatte. Im reinen Browser (npm run dev) Fallback auf localStorage.
const api = typeof window !== 'undefined' ? window.budgetApi : undefined
const LS_KEY = 'budget-data'

export const isDesktop = !!api

export async function loadData() {
  if (api) return api.load()
  try { return JSON.parse(localStorage.getItem(LS_KEY)) } catch { return null }
}
export async function saveData(data) {
  if (api) return api.save(data)
  localStorage.setItem(LS_KEY, JSON.stringify(data))
  return { ok: true }
}
export async function getInfo() {
  return api ? api.getInfo() : { dataPath: 'Browser (localStorage)' }
}
export const chooseFile = () => api?.chooseFile()
export const showInFolder = () => api?.showInFolder()
export const latestRelease = async () => (api?.latestRelease ? api.latestRelease() : null)

// Import-Ordner (nur Desktop)
export const importList = async () => (api?.importList ? api.importList() : [])
export const importRead = (name) => api.importRead(name)
export const importRemove = (name) => api?.importRemove?.(name)
export async function exportCsv(csv) {
  if (api) return api.exportCsv(csv)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }))
  a.download = 'budget-export.csv'
  a.click()
  return { path: 'Download' }
}

// ── Buchungen: eine Datei pro Jahr ──────────────────────────────
const txKey = (y) => `budget-tx-${y}`

export async function listTxYears() {
  if (api) return api.txYears()
  return Object.keys(localStorage).filter((k) => /^budget-tx-\d{4}$/.test(k)).map((k) => Number(k.slice(-4))).sort()
}
export async function loadTxYear(year) {
  if (api) return api.txLoad(year)
  try { return JSON.parse(localStorage.getItem(txKey(year))) } catch { return null }
}
export async function saveTxYear(year, data) {
  if (api) return api.txSave(year, data)
  localStorage.setItem(txKey(year), JSON.stringify(data))
  return { ok: true }
}

/** CSV-Datei wählen und Inhalt lesen. */
export async function openCsv() {
  if (api) return api.openCsv()
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.csv,text/csv'
    input.onchange = async () => {
      const f = input.files?.[0]
      resolve(f ? { name: f.name, content: await f.text() } : null)
    }
    input.click()
  })
}
