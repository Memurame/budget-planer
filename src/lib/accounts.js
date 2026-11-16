// Konten-Übersicht: Status des Abgleichs, Rücklagen-Soll.
import { budgetPeriodStart, diffMonths, isBudgetMode, simulateAnnual } from './calc.js'
import { actualByPositionRange, balanceAt, balanceCheck } from './tx.js'
import { fmtCHF, fmtDate } from './format.js'

/** Ab so vielen Tagen ohne eingetragenen Saldo gilt der Abgleich als fällig. */
export const RECONCILE_DAYS = 35

/**
 * Zustand des Saldo-Abgleichs als Badge: Differenz beim letzten Abgleich, Abgleich fällig, alles ok.
 * null, wenn das Konto noch nie abgeglichen wurde und keine Buchungen hat.
 */
export function reconcileStatus(account, balances, transactions, today) {
  const checks = balanceCheck(account, balances, transactions)
  const last = checks[checks.length - 1]
  if (!last) {
    return transactions.some((t) => t.accountId === account.id)
      ? { tone: 'warn', label: 'Kein Saldo', title: 'Noch kein Saldo eingetragen – der berechnete Wert ist nur die Summe der Buchungen.' }
      : null
  }
  if (Math.abs(last.diff) >= 0.005) return { tone: 'bad', label: `Diff ${fmt(last.diff)}`, title: `Beim Abgleich vom ${fmtDate(last.date)} weicht der Saldo um ${fmt(last.diff)} vom berechneten Wert ab.` }
  const days = Math.floor((new Date(today) - new Date(balanceAt(last).slice(0, 10))) / 86400000)
  if (days > RECONCILE_DAYS) return { tone: 'warn', label: 'Abgleich fällig', title: `Letzter Saldo vor ${days} Tagen eingetragen.` }
  return { tone: 'good', label: '✓', title: `Abgeglichen am ${fmtDate(last.date)}` }
}

/**
 * Soll-Stand einer Rücklage am Ende von `month`:
 * geplanter Stand gemäss Ansparplan, bei Jahresbudgets abzüglich der bisherigen Ausgaben.
 * null, wenn für diesen Monat noch kein Stand bekannt ist.
 */
export function reserveTarget(item, month, transactions) {
  const r = simulateAnnual(item, month, 1)[0]
  if (!r || r.estimated || r.saved == null) return null
  if (!isBudgetMode(item)) return round(r.saved)
  const since = budgetPeriodStart(item, month)
  const spent = diffMonths(since, month) < 0 ? 0 : actualByPositionRange(transactions, since, month)[item.id] || 0
  return round(r.saved - spent)
}

const round = (v) => Math.round(v * 100) / 100
const fmt = (v) => (v > 0 ? '+' : '') + fmtCHF(v)
