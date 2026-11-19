// Offene Zahlungen: vorgemerkte Ausgaben (noch keine Buchungen), gruppiert nach Fälligkeit.

const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const round = (v) => Math.round(v * 100) / 100

/**
 * Nach Fälligkeit sortieren und gruppieren: überfällig (vor heute), in den nächsten 7 Tagen, später.
 * Leere Gruppen werden weggelassen.
 */
export function openPaymentGroups(list = [], today) {
  const week = addDays(today, 7)
  const sorted = [...list].sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
  const defs = [
    { key: 'overdue', label: 'Überfällig', test: (p) => p.dueDate < today },
    { key: 'week', label: 'Nächste 7 Tage', test: (p) => p.dueDate >= today && p.dueDate <= week },
    { key: 'later', label: 'Später', test: (p) => p.dueDate > week },
  ]
  const groups = defs
    .map((g) => {
      const items = sorted.filter(g.test)
      return { key: g.key, label: g.label, items, total: round(items.reduce((s, p) => s + (Number(p.amount) || 0), 0)) }
    })
    .filter((g) => g.items.length)
  return { groups, total: round(sorted.reduce((s, p) => s + (Number(p.amount) || 0), 0)) }
}

/** Zusammenfassung für die Kachel auf der Übersicht. */
export function openPaymentsSummary(list = [], today) {
  const sorted = [...list].sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
  const upcoming = sorted.find((p) => p.dueDate >= today)
  return {
    count: list.length,
    total: round(list.reduce((s, p) => s + (Number(p.amount) || 0), 0)),
    overdue: sorted.filter((p) => p.dueDate < today).length,
    nextDue: upcoming?.dueDate || null,
  }
}
