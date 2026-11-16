// Konten-Übersicht: Hierarchie (Bank-Produkt → Pockets), Totale, Status des Abgleichs, Rücklagen-Soll.
import { budgetPeriodStart, diffMonths, isBudgetMode, simulateAnnual } from './calc.js'
import { actualByPositionRange, balanceAt, balanceCheck, currentBalance } from './tx.js'
import { fmtCHF, fmtDate } from './format.js'

/** Ab so vielen Tagen ohne eingetragenen Saldo gilt der Abgleich als fällig. */
export const RECONCILE_DAYS = 35

/**
 * Konten als Baum mit einer Ebene: oberste Konten in ihrer Reihenfolge, darunter die untergeordneten.
 * Ein Verweis auf ein fehlendes oder selbst untergeordnetes Konto wird ignoriert.
 */
export function accountTree(accounts) {
  const tops = accounts.filter((a) => !validParent(a, accounts))
  return tops.map((account) => ({ account, children: accounts.filter((c) => validParent(c, accounts)?.id === account.id) }))
}

function validParent(a, accounts) {
  if (!a.parentId || a.parentId === a.id) return null
  const p = accounts.find((x) => x.id === a.parentId)
  return p && !p.parentId ? p : null
}

/** Mögliche übergeordnete Konten für `a`: oberste Konten ohne eigene Unterkonten-Beziehung zu `a`. */
export function parentCandidates(a, accounts) {
  const hasChildren = accounts.some((c) => c.parentId === a.id)
  if (hasChildren) return []
  return accounts.filter((p) => p.id !== a.id && !p.parentId)
}

const hasOwnData = (a, balances, transactions) =>
  balances.some((b) => b.accountId === a.id) || transactions.some((t) => t.accountId === a.id)

/**
 * Salden eines Baum-Knotens.
 * - own: berechneter Saldo des Kontos selbst (z. B. «Erspartes» aus dem CSV)
 * - total: Wert, der ins Gesamttotal einfliesst – eigener Saldo, oder Summe der Unterkonten, wenn das Konto nur gruppiert
 * - unassigned: eigener Saldo minus Summe der Unterkonten (Geld, das keinem Pocket zugeordnet ist)
 */
export function nodeBalances({ account, children }, balances, transactions) {
  const own = currentBalance(account, balances, transactions)
  const kids = children.map((c) => ({ account: c, balance: currentBalance(c, balances, transactions) }))
  const childSum = round(kids.reduce((s, k) => s + k.balance.amount, 0))
  const ownData = hasOwnData(account, balances, transactions)
  const total = !children.length || ownData ? own.amount : childSum
  const unassigned = children.length && ownData ? round(own.amount - childSum) : null
  return { own, kids, childSum, total, unassigned, groupOnly: children.length > 0 && !ownData }
}

/**
 * Zustand des Saldo-Abgleichs als Badge: Differenz beim letzten Abgleich, Abgleich fällig, alles ok.
 * null, wenn das Konto noch nie abgeglichen wurde und keine Buchungen hat (oder ein Unterkonto ohne eigenen Saldo ist).
 */
export function reconcileStatus(account, balances, transactions, today, { child = false } = {}) {
  const checks = balanceCheck(account, balances, transactions)
  const last = checks[checks.length - 1]
  if (!last) {
    // Unterkonten werden über das übergeordnete Konto abgeglichen – ohne eigenen Saldo keine Warnung
    return !child && transactions.some((t) => t.accountId === account.id)
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
