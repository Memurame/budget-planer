import { askDelete } from '../components/ui.jsx'
import { allocations } from './tx.js'

/**
 * Budget-Positionen/Gruppen löschen – nur nach Eingabe von «löschen».
 * Räumt danach Regeln, Regelvorschläge und Konto-Zuordnungen auf und setzt
 * zugeordnete Buchungen wieder auf «offen».
 */
export async function confirmAndDelete({ title, message, ids = [], update, tx, mutate }) {
  const set = new Set(ids)
  const affected = set.size ? tx.transactions.filter((t) => allocations(t).some((a) => set.has(a.positionId))).length : 0
  const hint = affected ? `\n\n${affected} zugeordnete Buchung${affected > 1 ? 'en werden' : ' wird'} wieder auf «offen» gesetzt.` : ''
  if (!(await askDelete({ title, message: message + hint }))) return false
  update((d) => {
    mutate(d)
    if (!set.size) return
    d.rules = (d.rules || []).filter((r) => !set.has(r.positionId))
    d.pendingRules = (d.pendingRules || []).filter((r) => !set.has(r.positionId))
    for (const a of d.accounts || []) a.funds = (a.funds || []).filter((id) => !set.has(id))
  })
  if (set.size) await tx.unassignPositions(ids)
  return true
}
