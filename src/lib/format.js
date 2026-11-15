const chf = new Intl.NumberFormat('de-CH', { style: 'currency', currency: 'CHF', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const chf0 = new Intl.NumberFormat('de-CH', { style: 'currency', currency: 'CHF', maximumFractionDigits: 0 })
const num = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = new Intl.NumberFormat('de-CH', { style: 'percent', maximumFractionDigits: 1 })

export const fmtCHF = (v) => chf.format(v || 0)
export const fmtCHF0 = (v) => chf0.format(v || 0)
export const fmtNum = (v) => num.format(v || 0)
export const fmtPct = (v) => pct.format(v || 0)
export const fmtDate = (s) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('de-CH') : '')

/** Akzeptiert "1'234.50", "1234,5", "1 234" usw. */
export function parseAmount(str) {
  if (typeof str === 'number') return str
  const clean = String(str).replace(/['’\s]/g, '').replace(/CHF/i, '').replace(',', '.')
  const v = parseFloat(clean)
  return Number.isFinite(v) ? v : 0
}
