// Wiederkehrende Buchungen: Vorlagen in budget.json, daraus erzeugte Buchungen in den Jahresdateien.
import { addMonths, amountAt, diffMonths, monthKey } from './calc.js'

export const RECURRING_INTERVALS = [
  [1, 'monatlich'],
  [3, 'vierteljährlich'],
  [12, 'jährlich'],
]

const pad = (n) => String(n).padStart(2, '0')
const lastDay = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate() }
export const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

/** Datum einer Wiederholung in Monat `key` (Tag wird auf Monatsende begrenzt, z. B. 31. → 30.). */
export const occurrenceDate = (tpl, key) => `${key}-${pad(Math.min(Number(tpl.day) || 1, lastDay(key)))}`

/** Alle Monate, in denen die Vorlage fällig ist – vom Start bis `untilKey` (inkl.). */
export function occurrenceMonths(tpl, untilKey) {
  const interval = Math.max(1, Number(tpl.interval) || 1)
  const out = []
  for (let m = tpl.startMonth; diffMonths(m, untilKey) >= 0; m = addMonths(m, interval)) {
    if (tpl.endMonth && diffMonths(tpl.endMonth, m) > 0) break
    out.push(m)
  }
  return out
}

/** Nächste Fälligkeit ab heute (oder null, wenn beendet). */
export function nextOccurrence(tpl, today = todayStr()) {
  const interval = Math.max(1, Number(tpl.interval) || 1)
  let m = tpl.startMonth
  while (occurrenceDate(tpl, m) < today) m = addMonths(m, interval)
  if (tpl.endMonth && diffMonths(tpl.endMonth, m) > 0) return null
  return occurrenceDate(tpl, m)
}

/** Betrag einer Wiederholung (Vorlage kann Beträge ab einem Monat ändern, wie Budget-Positionen). */
export const occurrenceAmount = (tpl, key) => Math.abs(amountAt(tpl, key))

/**
 * Buchungen aus einer Vorlage für alle fälligen Termine bis heute.
 * IDs sind eindeutig pro Vorlage und Monat → werden nie doppelt erzeugt.
 */
export function buildOccurrences(tpl, today = todayStr()) {
  if (tpl.paused) return []
  const out = []
  for (const key of occurrenceMonths(tpl, monthKey(new Date(today + 'T00:00:00')))) {
    const date = occurrenceDate(tpl, key)
    if (date > today) continue
    if (tpl.skipBefore && key < tpl.skipBefore) continue // Termine während einer Pause nicht nachholen
    const amount = occurrenceAmount(tpl, key)
    const base = { date, bookedDate: date, text: tpl.text, source: 'recurring', recurringId: tpl.id, override: true, kind: 'wiederkehrend' }
    if (tpl.kind === 'transfer') {
      const a = `rec-${tpl.id}-${key}-a`, b = `rec-${tpl.id}-${key}-b`
      out.push({ ...base, id: a, accountId: tpl.accountId, amount: -amount, status: 'ignored', positionId: null, linkedId: b, kind: 'Umbuchung (wiederkehrend)' })
      out.push({ ...base, id: b, accountId: tpl.toAccountId, amount, status: 'ignored', positionId: null, linkedId: a, kind: 'Umbuchung (wiederkehrend)' })
    } else {
      out.push({
        ...base,
        id: `rec-${tpl.id}-${key}`,
        accountId: tpl.accountId,
        amount: tpl.kind === 'credit' ? amount : -amount,
        positionId: tpl.positionId || null,
        status: tpl.positionId ? 'manual' : 'open',
      })
    }
  }
  return out
}
