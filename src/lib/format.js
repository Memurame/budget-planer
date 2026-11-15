const chf = new Intl.NumberFormat('de-CH', { style: 'currency', currency: 'CHF', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const chf0 = new Intl.NumberFormat('de-CH', { style: 'currency', currency: 'CHF', maximumFractionDigits: 0 })
const num = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = new Intl.NumberFormat('de-CH', { style: 'percent', maximumFractionDigits: 1 })

// Negative Beträge als "CHF −64.00" statt "CHF-64.00"
const signed = (f, v) => (v < 0 && Math.abs(v) >= 0.005 ? f.format(-v).replace(/CHF\s/, 'CHF −') : f.format(Math.abs(v) < 0.005 ? 0 : v))
export const fmtCHF = (v) => signed(chf, v || 0)
export const fmtCHF0 = (v) => signed(chf0, v || 0)
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
