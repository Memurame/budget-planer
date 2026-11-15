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
export async function exportCsv(csv) {
  if (api) return api.exportCsv(csv)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }))
  a.download = 'budget-export.csv'
  a.click()
  return { path: 'Download' }
}
