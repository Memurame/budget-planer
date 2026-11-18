// Erhaltene Darlehen: Restschuld, Rückzahlungsplan und Anteil am Monatsbudget.
//
// Buchungen werden über zwei «Pseudo-Positionen» pro Darlehen verknüpft:
//   loan-in:<id>   Auszahlung erhalten  → zählt nicht als Einnahme
//   loan-out:<id>  Rückzahlung          → senkt die Restschuld
// Rückzahlungsarten: 'rate' (monatliche Raten), 'due' (einmalig bis Datum, monatlich zurücklegen), 'free' (ohne Plan).
// eigene Monatsrechnung (statt Import aus calc.js), damit calc.js dieses Modul ohne Zirkelbezug nutzen kann
const toIndex = (key) => { const [y, m] = key.split('-').map(Number); return y * 12 + (m - 1) }
const diffMonths = (a, b) => toIndex(b) - toIndex(a)

export const LOAN_PLANS = {
  rate: 'Raten (monatlich)',
  due: 'Einmalig bis Datum',
  free: 'Ohne festen Plan',
}

export const loanInId = (loan) => `loan-in:${loan.id}`
export const loanOutId = (loan) => `loan-out:${loan.id}`
export const isLoanIn = (positionId) => String(positionId || '').startsWith('loan-in:')
export const isLoanPosition = (positionId) => /^loan-(in|out):/.test(String(positionId || ''))

const round = (v) => Math.round(v * 100) / 100
const monthOf = (date) => String(date).slice(0, 7)
const allocs = (t) => (t.splits?.length ? t.splits : t.positionId ? [{ positionId: t.positionId, amount: t.amount }] : [])

/** Summe der verknüpften Buchungen (positiv), optional nur vor Monat `beforeKey`. */
function linkedSum(id, transactions, beforeKey) {
  let s = 0
  for (const t of transactions) {
    if (t.status === 'ignored') continue
    if (beforeKey && monthOf(t.date) >= beforeKey) continue
    for (const a of allocs(t)) if (a.positionId === id) s += Math.abs(a.amount)
  }
  return round(s)
}

/** Erste als «erhalten» verknüpfte Buchung (Datum und Konto der Einzahlung) – oder null. */
export function loanFirstReceipt(loan, transactions = []) {
  let first = null
  for (const t of transactions) {
    if (t.status === 'ignored') continue
    if (!allocs(t).some((a) => a.positionId === loanInId(loan))) continue
    if (!first || t.date < first.date) first = t
  }
  return first
}

/**
 * Beginn des Darlehens: Datum der Einzahlungs-Buchung; solange keine verknüpft ist,
 * das Erfassungsdatum (ältere Daten: früheres Feld «date»).
 */
export const loanStart = (loan, transactions) => loanFirstReceipt(loan, transactions)?.date || loan.createdAt || loan.date || null

/** Zurückbezahlter Betrag (alle Rückzahlungen, oder nur vor Monat `beforeKey`). */
export const loanRepaid = (loan, transactions, beforeKey) => linkedSum(loanOutId(loan), transactions, beforeKey)
/** Laut Buchungen erhaltener Betrag. */
export const loanReceived = (loan, transactions) => linkedSum(loanInId(loan), transactions)

/**
 * Anteil des Darlehens am Budget in Monat `key`.
 * - rate: Rate ab Startmonat, bis der Betrag gemäss Plan zurückbezahlt ist (letzte Rate = Rest);
 *         0, sobald laut Buchungen alles zurückbezahlt ist.
 * - due:  gleichmässig zurücklegen vom Monat der Einzahlung (bzw. der Erfassung) bis zum Fälligkeitsmonat (inkl.).
 * - free: nichts im Budget.
 * Ohne `transactions` wird nur nach Plan gerechnet.
 */
export function loanMonthly(loan, key, transactions) {
  const amount = Number(loan.amount) || 0
  if (amount <= 0) return 0
  const repaidBefore = transactions ? loanRepaid(loan, transactions, key) : 0
  const open = amount - repaidBefore
  if (open <= 0.005) return 0

  if (loan.plan === 'rate') {
    const rate = Number(loan.rate) || 0
    if (rate <= 0 || !loan.rateStart || key < loan.rateStart) return 0
    const planLeft = amount - rate * diffMonths(loan.rateStart, key)
    if (planLeft <= 0.005) return transactions ? Math.min(rate, round(open)) : 0 // Plan erfüllt, aber noch offen → weiter Raten
    return round(Math.min(rate, planLeft, open))
  }
  if (loan.plan === 'due') {
    const startDate = loanStart(loan, transactions)
    if (!loan.dueDate || !startDate) return 0
    const start = monthOf(startDate), due = monthOf(loan.dueDate)
    if (key < start || key > due) return 0
    return round(amount / (diffMonths(start, due) + 1))
  }
  return 0
}

/** Gesamter Budget-Anteil aller Darlehen in Monat `key`, getrennt nach Raten und Rücklagen. */
export function loansMonthly(loans = [], key, transactions) {
  let rates = 0, reserve = 0
  for (const l of loans) {
    const v = loanMonthly(l, key, transactions)
    if (l.plan === 'rate') rates += v
    else if (l.plan === 'due') reserve += v
  }
  return { rates: round(rates), reserve: round(reserve), total: round(rates + reserve) }
}

/** Übersicht eines Darlehens: zurückbezahlt, Restschuld, Fortschritt, nächste Fälligkeit. */
export function loanStatus(loan, transactions, currentKey) {
  const amount = Number(loan.amount) || 0
  const repaid = loanRepaid(loan, transactions)
  const outstanding = Math.max(0, round(amount - repaid))
  const done = amount > 0 && outstanding <= 0.005
  let next = null
  if (!done && loan.plan === 'rate' && Number(loan.rate) > 0 && loan.rateStart) {
    // nächster Monat ab heute mit einer geplanten Rate
    const from = loan.rateStart > currentKey ? loan.rateStart : currentKey
    next = { month: from, amount: Math.min(Number(loan.rate), outstanding) }
  } else if (!done && loan.plan === 'due' && loan.dueDate) {
    next = { date: loan.dueDate, amount: outstanding }
  }
  return { amount, repaid, outstanding, done, progress: amount > 0 ? Math.min(1, repaid / amount) : 0, received: loanReceived(loan, transactions), next }
}

/** Alle offenen Darlehen zusammen (für die Kachel auf der Übersicht). */
export function loansOverview(loans = [], transactions, currentKey) {
  const list = loans.map((l) => ({ loan: l, ...loanStatus(l, transactions, currentKey) })).filter((x) => !x.done && x.amount > 0)
  const outstanding = round(list.reduce((s, x) => s + x.outstanding, 0))
  const dues = list.map((x) => x.next?.date || (x.next?.month ? `${x.next.month}-01` : null)).filter(Boolean).sort()
  return { count: list.length, outstanding, nextDue: dues[0] || null }
}
