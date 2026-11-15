// Monate werden als "YYYY-MM" geführt.
export const monthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

const toIndex = (key) => { const [y, m] = key.split('-').map(Number); return y * 12 + (m - 1) }
const fromIndex = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`

export const addMonths = (key, n) => fromIndex(toIndex(key) + n)
export const diffMonths = (a, b) => toIndex(b) - toIndex(a) // b - a
export const dueMonthOf = (dateStr) => dateStr.slice(0, 7)

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
export const monthLabel = (key, withYear = true) => {
  const [y, m] = key.split('-').map(Number)
  return withYear ? `${MONTHS[m - 1]} ${String(y).slice(2)}` : MONTHS[m - 1]
}

const sum = (arr, f = (x) => x.amount) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0)

/** Nächste Fälligkeit (Monat) ab einem Monat, Zyklus wird bei Bedarf weitergerollt. */
export function nextDueMonth(item, fromKey) {
  const interval = Math.max(1, Number(item.intervalMonths) || 12)
  let due = dueMonthOf(item.dueDate)
  while (diffMonths(fromKey, due) < 0) due = addMonths(due, interval)
  return due
}

/**
 * Simuliert eine jährliche Position Monat für Monat.
 *
 * Ausgangslage: am Anfang des Monats `savedAsOf` sind `saved` CHF angespart.
 * In jedem Monat wird zuerst eine Fälligkeit bezahlt (falls dieser Monat fällig ist),
 * dann die Rate gelegt:  rate = (Betrag − angespart) / Monate bis zur nächsten Fälligkeit.
 * Der Fälligkeitsmonat selbst zählt also nicht mehr zum Ansparen für diese Zahlung.
 */
/** Laufendes Jahresbudget statt Zahlung an einem Fälligkeitsdatum? */
export const isBudgetMode = (item) => item.mode === 'budget'
/** Jahresbudget, das jedes Kalenderjahr neu beginnt (Rest wird nicht übertragen)? */
export const resetsYearly = (item) => isBudgetMode(item) && item.carry === 'reset'
/** Ab welchem Monat zählt der laufende Stand: Planungsbeginn, bei «jedes Jahr neu» frühestens Januar des Jahres. */
export function budgetPeriodStart(item, key) {
  const start = item.savedAsOf || key
  if (!resetsYearly(item)) return start
  const jan = `${key.slice(0, 4)}-01`
  return diffMonths(start, jan) > 0 ? jan : start
}

export function simulateAnnual(item, fromKey, count) {
  const amount = Number(item.amount) || 0
  const interval = Math.max(1, Number(item.intervalMonths) || 12)

  // Jahresbudget: gleichmässig ansparen, keine geplante Zahlung – Ausgaben kommen aus den Buchungen.
  // «übertragen»: der Rest bleibt in der Rücklage. «jedes Jahr neu»: Stand beginnt jeden Januar bei 0.
  if (isBudgetMode(item)) {
    const rate = amount / interval
    const start = item.savedAsOf || fromKey
    const out = []
    for (let i = 0; i < count; i++) {
      const m = addMonths(fromKey, i)
      const known = diffMonths(start, m) >= 0
      const from = budgetPeriodStart(item, m)
      const base = from === start ? Number(item.saved) || 0 : 0
      const saved = known ? base + rate * (diffMonths(from, m) + 1) : null
      out.push({ month: m, rate, payout: 0, saved, due: null, left: null, estimated: !known, budget: true })
    }
    return out
  }
  const start = item.savedAsOf || fromKey
  let saved = Number(item.saved) || 0
  let due = nextDueMonth(item, start)
  const out = []
  const end = addMonths(fromKey, count - 1)

  // Monate vor dem Startpunkt: kein bekannter Stand → gleichmässige Rate
  for (let m = fromKey; diffMonths(m, start) > 0 && diffMonths(m, end) >= 0; m = addMonths(m, 1)) {
    out.push({ month: m, rate: amount / interval, payout: dueMonthOf(item.dueDate) === m ? amount : 0, saved: null, due: null, left: null, estimated: true })
  }

  for (let m = start; diffMonths(m, end) >= 0; m = addMonths(m, 1)) {
    let payout = 0
    if (m === due) {
      payout = amount
      saved -= amount
      due = addMonths(due, interval)
    }
    const left = diffMonths(m, due)
    const rate = Math.max(0, amount - saved) / left
    saved += rate
    if (diffMonths(fromKey, m) >= 0) out.push({ month: m, rate, payout, saved, due, left, estimated: false })
  }
  return out
}

export const annualRate = (item, key) => simulateAnnual(item, key, 1)[0]?.rate ?? 0
export const flatRate = (item) => (Number(item.amount) || 0) / Math.max(1, Number(item.intervalMonths) || 12)

/** Stand am Monatsende von `key` (Soll gemäss Plan). */
export function annualState(item, key) {
  const r = simulateAnnual(item, key, 1)[0]
  return r
}

/** Betrag, der bei gleichmässigem Ansparen zu Beginn von `key` bereits zurückgelegt wäre. */
export function onTrackSaved(item, key) {
  if (isBudgetMode(item)) return Number(item.saved) || 0 // Jahresbudget: kein Soll-Stand
  const interval = Math.max(1, Number(item.intervalMonths) || 12)
  const due = nextDueMonth(item, key)
  const left = diffMonths(key, due)
  if (left === 0) return Number(item.amount) || 0
  return ((Number(item.amount) || 0) * Math.max(0, interval - left)) / interval
}

/**
 * Monatsabhängige Beträge: `amount` ist der Grundwert, `changes` hält Änderungen pro Monat
 * ({ "2026-11": 2300 }). Ein Wert gilt ab seinem Monat, bis ein späterer Monat ihn ändert.
 */
export function amountAt(it, key) {
  let best = null
  if (it.changes) for (const k in it.changes) if (k <= key && (best === null || k > best)) best = k
  return Number(best ? it.changes[best] : it.amount) || 0
}

/** Betrag ab Monat `key` setzen. Frühere Monate bleiben unverändert. */
export function setAmountAt(it, key, value) {
  it.changes = { ...(it.changes || {}) }
  delete it.changes[key]
  if (amountAt(it, addMonths(key, -1)) !== value) it.changes[key] = value
  if (Object.keys(it.changes).length === 0) delete it.changes
}

/** Wurde der Betrag genau in diesem Monat geändert? Liefert dann den Wert des Vormonats. */
export const changedIn = (it, key) => (it.changes && key in it.changes ? amountAt({ ...it, changes: Object.fromEntries(Object.entries(it.changes).filter(([k]) => k !== key)) }, key) : null)

const sumAt = (arr, key) => arr.reduce((s, x) => s + amountAt(x, key), 0)

/** Gruppen-Position mit nicht-monatlicher Abrechnung (vierteljährlich, jährlich …)? */
export const isPeriodic = (it) => (Number(it.intervalMonths) || 1) > 1

/** Monatlicher Betrag einer Gruppen-Position: fix, oder Rücklage-Rate bei periodischer Abrechnung. */
export const itemMonthly = (it, key) => (isPeriodic(it) ? annualRate(it, key) : amountAt(it, key))

/** Durchschnittlicher Monatsbetrag (für Jahresvergleiche). */
export const itemMonthlyFlat = (it, key = monthKey()) => (isPeriodic(it) ? flatRate(it) : amountAt(it, key))

/**
 * Alle Positionen, für die angespart wird: die Liste "Jährliche Kosten"
 * plus periodisch abgerechnete Positionen aus den Gruppen.
 */
export function reserveItems(data) {
  return [
    ...data.annual.map((item, i) => ({ item, group: null, ref: { kind: 'annual', i } })),
    ...data.groups.flatMap((g, gi) =>
      g.items.map((item, ii) => ({ item, group: g.name, ref: { kind: 'group', gi, ii } })).filter((x) => isPeriodic(x.item)),
    ),
  ]
}

/** Position im (geklonten) Datenobjekt anhand der Referenz aus reserveItems. */
export const resolveRef = (d, ref) => (ref.kind === 'annual' ? d.annual[ref.i] : d.groups[ref.gi].items[ref.ii])

export function removeRef(d, ref) {
  if (ref.kind === 'annual') d.annual.splice(ref.i, 1)
  else d.groups[ref.gi].items.splice(ref.ii, 1)
}

/** Felder setzen, wenn eine Position auf periodische Abrechnung umgestellt wird. */
export function makePeriodic(it, intervalMonths, key = monthKey()) {
  const wasMonthly = !isPeriodic(it)
  it.intervalMonths = intervalMonths
  if (wasMonthly) {
    // Bisheriger Monatsbetrag → Betrag pro Abrechnung
    it.amount = Math.round(amountAt(it, key) * intervalMonths * 100) / 100
    delete it.changes // periodische Beträge gelten für alle Monate
    it.dueDate = `${addMonths(key, intervalMonths)}-01`
    it.placeholder = true
  }
  it.savedAsOf = key
  it.saved = onTrackSaved(it, key)
}

export function makeMonthly(it) {
  const interval = Number(it.intervalMonths) || 1
  it.amount = Math.round(((Number(it.amount) || 0) / interval) * 100) / 100
  delete it.intervalMonths
  delete it.dueDate
  delete it.saved
  delete it.savedAsOf
  delete it.placeholder
}

export function summary(data, key = monthKey()) {
  const income = sumAt(data.income, key)
  const groups = data.groups.map((g) => ({ id: g.id, name: g.name, total: sum(g.items, (it) => itemMonthly(it, key)) }))
  const annualRates = data.annual.map((a) => annualRate(a, key))
  const annual = annualRates.reduce((s, r) => s + r, 0)
  const annualFlat = sum(data.annual, flatRate)
  // Alle Rücklage-Positionen (inkl. periodischer Gruppen-Positionen), z. B. für Warnungen
  const reserves = reserveItems(data).map((x) => ({ ...x.item, group: x.group, rate: annualRate(x.item, key), flat: flatRate(x.item) }))
  const budget = sum(groups, (g) => g.total) + annual
  const deductions = data.deductions.map((d) => ({ ...d, amount: amountAt(d, key) }))
  const deductionsTotal = sum(deductions)
  const result = income - budget - deductionsTotal
  const savings = sum(deductions.filter((d) => d.isSaving))
  return {
    month: key,
    income,
    groups,
    annual,
    annualFlat,
    reserves,
    budget,
    deductions,
    deductionsTotal,
    result,
    savings,
    savingsRate: income > 0 ? savings / income : 0,
    freeRate: income > 0 ? result / income : 0,
  }
}

/** Rücklagen-Vorschau über mehrere Monate: Gesamtrate und Auszahlungen pro Monat (alle Rücklage-Positionen). */
export function annualForecast(data, fromKey, count = 12) {
  const months = Array.from({ length: count }, (_, i) => addMonths(fromKey, i))
  const perItem = reserveItems(data).map((x) => ({ item: x.item, rows: simulateAnnual(x.item, fromKey, count) }))
  return months.map((m, i) => ({
    month: m,
    rate: perItem.reduce((s, p) => s + (p.rows[i]?.rate || 0), 0),
    payout: perItem.reduce((s, p) => s + (p.rows[i]?.payout || 0), 0),
    payouts: perItem.filter((p) => p.rows[i]?.payout > 0).map((p) => ({ name: p.item.name, amount: p.rows[i].payout })),
  }))
}

export const uid = () => Math.random().toString(36).slice(2, 10)
