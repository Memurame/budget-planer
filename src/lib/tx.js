// Buchungen: CSV-Import, Regeln, Ist-Werte, Salden.
import { addMonths, isPeriodic, uid } from './calc.js'

export const STATUS = {
  open: { label: 'Offen', tone: 'warn' },
  auto: { label: 'Automatisch', tone: 'accent' },
  manual: { label: 'Manuell', tone: 'accent' },
  confirmed: { label: 'Bestätigt', tone: 'good' },
  ignored: { label: 'Ignoriert', tone: 'neutral' },
}

export const ACCOUNT_TYPES = { giro: 'Girokonto', pocket: 'Pocket / Sparkonto', extern: 'Externes Konto' }

/** Standardregeln für Revolut: interne Umbuchungen zählen nicht als Ausgabe. */
export function defaultRules() {
  return [
    { id: uid(), pattern: 'einzustecken', action: 'ignore', note: 'Umbuchung in ein Pocket' },
    { id: uid(), pattern: 'Auszahlung bei Pocket', action: 'ignore', note: 'Umbuchung aus einem Pocket' },
    { id: uid(), pattern: 'Apple Pay Einzahlung', action: 'ignore', note: 'Einzahlung vom eigenen Konto' },
  ]
}

/** Fehlende Felder in älteren Dateien ergänzen. */
export function migrate(data) {
  return {
    ...data,
    accounts: data.accounts || [],
    rules: data.rules || defaultRules(),
    importMappings: data.importMappings || {},
    pendingRules: data.pendingRules || [],
    recurring: data.recurring || [],
  }
}

export const emptyYear = () => ({ transactions: [], balances: [], closedMonths: [], deletedIds: [] })
export const yearOf = (date) => Number(String(date).slice(0, 4))
export const monthOf = (date) => String(date).slice(0, 7)

// ── Positionen ──────────────────────────────────────────────────

/** Alle Positionen, denen Buchungen zugeordnet werden können. */
export function allPositions(data) {
  return [
    ...data.groups.flatMap((g) => g.items.map((it) => ({ id: it.id, name: it.name, group: g.name, periodic: isPeriodic(it), item: it }))),
    ...data.annual.map((a) => ({ id: a.id, name: a.name, group: 'Jährliche Kosten', periodic: true, item: a })),
    ...data.deductions.map((d) => ({ id: d.id, name: d.name, group: 'Sparen & Abzüge', periodic: false, item: d })),
  ]
}

// ── CSV ─────────────────────────────────────────────────────────

/** Einfacher CSV-Parser mit Anführungszeichen; erkennt Komma oder Semikolon. */
export function parseCsv(text) {
  const clean = text.replace(/^﻿/, '')
  const firstLine = clean.split(/\r?\n/, 1)[0]
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ','
  const rows = []
  let row = [], cell = '', quoted = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

// Spaltennamen des Revolut-Exports (deutsch und englisch)
const COLS = {
  type: ['Art', 'Type'],
  product: ['Produkt', 'Product'],
  started: ['Datum des Beginns', 'Started Date'],
  completed: ['Datum des Abschlusses', 'Completed Date'],
  text: ['Beschreibung', 'Description'],
  amount: ['Betrag', 'Amount'],
  fee: ['Gebühr', 'Fee'],
  currency: ['Währung', 'Currency'],
  state: ['Status', 'State'],
  balance: ['Kontostand', 'Balance'],
}
const DONE = ['ABGESCHLOSSEN', 'COMPLETED']

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/['’\s]/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/** Kurzer, stabiler Hash (FNV-1a) für die Duplikaterkennung. */
function hash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36)
}

/**
 * Revolut-CSV in Buchungen umwandeln.
 * Liefert { rows, skipped, products, balances, error }.
 */
export function parseRevolut(text) {
  const table = parseCsv(text)
  if (table.length < 2) return { error: 'Die Datei enthält keine Buchungen.' }
  const head = table[0].map((h) => h.trim())
  const idx = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]))
  const missing = ['started', 'text', 'amount'].filter((k) => idx[k] < 0)
  if (missing.length) return { error: 'Unbekanntes Format – erwartet wird ein Revolut-Kontoauszug (CSV).' }

  const get = (r, k) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '')
  const rows = []
  let skipped = 0
  const lastBalance = {} // pro Produkt: letzter Kontostand nach Abschlussdatum

  for (const r of table.slice(1)) {
    const state = get(r, 'state')
    if (state && !DONE.includes(state.toUpperCase())) { skipped++; continue }
    const started = get(r, 'started')
    const completed = get(r, 'completed') || started
    const product = get(r, 'product') || 'Konto'
    const amount = Math.round((num(get(r, 'amount')) - num(get(r, 'fee'))) * 100) / 100
    const balanceRaw = get(r, 'balance')
    const key = [started, completed, get(r, 'text'), get(r, 'amount'), get(r, 'fee'), balanceRaw, product].join('|')
    rows.push({
      id: `csv-${hash(key)}`,
      product,
      date: started.slice(0, 10),
      bookedDate: completed.slice(0, 10),
      bookedAt: completed,
      text: get(r, 'text'),
      kind: get(r, 'type'),
      amount,
      currency: get(r, 'currency') || 'CHF',
    })
    if (balanceRaw !== '') {
      const prev = lastBalance[product]
      if (!prev || completed >= prev.at) lastBalance[product] = { at: completed, date: completed.slice(0, 10), amount: num(balanceRaw) }
    }
  }
  const products = [...new Set(rows.map((r) => r.product))]
  return { rows, skipped, products, balances: lastBalance }
}

// ── Regeln ──────────────────────────────────────────────────────

export function ruleMatches(rule, text) {
  const p = String(rule.pattern || '').trim()
  if (!p) return false
  if (p.length > 2 && p.startsWith('/') && p.endsWith('/')) {
    try { return new RegExp(p.slice(1, -1), 'i').test(text) } catch { return false }
  }
  return String(text).toLowerCase().includes(p.toLowerCase())
}

/** Erste passende Regel (Reihenfolge = Priorität). */
export const findRule = (rules, text) => rules.find((r) => ruleMatches(r, text))

/**
 * Regel auf eine Buchung anwenden – nur, wenn sie nicht manuell bearbeitet oder bestätigt ist.
 * Gibt true zurück, wenn sich etwas geändert hat.
 */
export function applyRules(tx, rules) {
  // Manuell bearbeitete oder bestätigte Buchungen werden nie von Regeln verändert
  if (tx.override || tx.status === 'manual' || tx.status === 'confirmed') return false
  const rule = findRule(rules, tx.text)
  const before = `${tx.status}|${tx.positionId}|${tx.ruleId}`
  if (!rule) { tx.status = 'open'; tx.positionId = null; tx.ruleId = null }
  else if (rule.action === 'ignore') { tx.status = 'ignored'; tx.positionId = null; tx.ruleId = rule.id }
  else { tx.status = 'auto'; tx.positionId = rule.positionId; tx.ruleId = rule.id }
  return before !== `${tx.status}|${tx.positionId}|${tx.ruleId}`
}

/** Vorschlag für ein Regelmuster aus einem Buchungstext (ohne Zahlen/Referenzen). */
export function suggestPattern(text) {
  return String(text).replace(/\*?\d[\d\s./-]*/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ')
}

// ── Auswertung ──────────────────────────────────────────────────

/** Aufteilung einer Buchung auf Positionen: Split-Zeilen oder die eine zugeordnete Position. */
export const allocations = (t) => (t.splits?.length ? t.splits : t.positionId ? [{ positionId: t.positionId, amount: t.amount }] : [])
export const isSplit = (t) => !!t.splits?.length
/** Ist die Buchung vollständig zugeordnet (Position oder gültige Aufteilung)? */
export const isAssigned = (t) => (isSplit(t) ? t.splits.every((s) => s.positionId) : !!t.positionId)

export const counts = (tx) => tx.status !== 'ignored' && allocations(tx).length > 0

/** Effektive Ausgaben pro Position in einem Monat (positiv = ausgegeben). */
export function actualByPosition(transactions, key) {
  return actualByPositionRange(transactions, key, key)
}

/** Effektive Ausgaben pro Position über einen Zeitraum [fromKey, toKey]. */
export function actualByPositionRange(transactions, fromKey, toKey) {
  const out = {}
  for (const t of transactions) {
    const m = monthOf(t.date)
    if (!counts(t) || m < fromKey || m > toKey) continue
    for (const a of allocations(t)) if (a.positionId) out[a.positionId] = (out[a.positionId] || 0) - a.amount
  }
  return out
}

/** Kontroll-Fortschritt eines Monats. */
export function monthProgress(transactions, key) {
  const c = { total: 0, open: 0, auto: 0, manual: 0, confirmed: 0, ignored: 0 }
  for (const t of transactions) {
    if (monthOf(t.date) !== key) continue
    c.total++
    c[t.status] = (c[t.status] || 0) + 1
  }
  c.relevant = c.total - c.ignored
  return c
}

// ── Salden ──────────────────────────────────────────────────────

/**
 * Saldo-Verlauf eines Kontos: zu jedem eingetragenen Saldo der erwartete Wert
 * (vorheriger Saldo + Buchungen dazwischen) und die Differenz.
 * Der erste eingetragene Saldo ist der Startpunkt.
 */
// Zeitpunkte: Buchungen nach Abschluss, Salden zum Stichtag (manuell eingetragen = Tagesende)
const txAt = (t) => t.bookedAt || `${t.bookedDate || t.date} 12:00:00`
export const balanceAt = (b) => b.at || `${b.date} 23:59:59`

export function balanceCheck(account, balances, transactions) {
  const list = balances.filter((b) => b.accountId === account.id).sort((a, b) => balanceAt(a).localeCompare(balanceAt(b)))
  const txs = transactions.filter((t) => t.accountId === account.id)
  const sumBetween = (from, to) => txs.filter((t) => txAt(t) > from && txAt(t) <= to).reduce((s, t) => s + t.amount, 0)
  return list.map((b, i) => {
    if (i === 0) return { ...b, expected: null, diff: 0 }
    const prev = list[i - 1]
    const expected = Math.round((prev.amount + sumBetween(balanceAt(prev), balanceAt(b))) * 100) / 100
    return { ...b, expected, diff: Math.round((b.amount - expected) * 100) / 100 }
  })
}

/** Berechneter aktueller Saldo: letzter eingetragener Saldo + spätere Buchungen. */
export function currentBalance(account, balances, transactions) {
  const list = balances.filter((b) => b.accountId === account.id).sort((a, b) => balanceAt(a).localeCompare(balanceAt(b)))
  const last = list[list.length - 1]
  const txs = transactions.filter((t) => t.accountId === account.id)
  if (!last) return { amount: txs.reduce((s, t) => s + t.amount, 0), since: null }
  return {
    amount: Math.round((last.amount + txs.filter((t) => txAt(t) > balanceAt(last)).reduce((s, t) => s + t.amount, 0)) * 100) / 100,
    since: last.date,
  }
}

// ── Ausgleichsbuchungen ─────────────────────────────────────────

/**
 * Vorschläge: ignorierte Gutschrift (Umbuchung) mit gleichem Betrag wie eine Ausgabe
 * innerhalb von 14 Tagen danach.
 */
export function suggestOffsets(transactions) {
  const days = (a, b) => (new Date(b) - new Date(a)) / 86400000
  const out = []
  const used = new Set()
  const expenses = transactions.filter((t) => t.amount < 0 && t.status !== 'ignored' && !t.linkedId)
  for (const tr of transactions) {
    if (tr.status !== 'ignored' || tr.amount <= 0 || tr.linkedId) continue
    const match = expenses.find((e) => !used.has(e.id) && Math.abs(e.amount + tr.amount) < 0.005 && days(e.date, tr.date) >= 0 && days(e.date, tr.date) <= 14)
    if (match) { used.add(match.id); out.push({ transfer: tr, expense: match }) }
  }
  return out
}

export const monthRange = (key, n) => Array.from({ length: n }, (_, i) => addMonths(key, i - n + 1))
