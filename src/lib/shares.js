/**
 * Teilt die Einnahmen in höchstens 7 farbige Kategorien + "Frei" (neutral).
 * Farben folgen der Kategorie (feste Reihenfolge), nie dem Rang.
 * Mehr als 5 Budget-Gruppen werden zu "Übrige Gruppen" zusammengefasst.
 */
export function buildShares(s) {
  // mit Darlehen eine Gruppe weniger, damit höchstens 8 Farben gebraucht werden
  const MAX_GROUPS = s.loans?.total > 0 ? 3 : 4
  const groups = s.groups.slice(0, MAX_GROUPS).map((g) => ({ key: g.id, name: g.name, value: g.total }))
  const rest = s.groups.slice(MAX_GROUPS)
  if (rest.length) groups.push({ key: 'rest', name: 'Übrige Gruppen', value: rest.reduce((a, g) => a + g.total, 0) })

  const saving = s.deductions.filter((d) => d.isSaving).reduce((a, d) => a + (d.amount || 0), 0)
  const other = s.deductions.filter((d) => !d.isSaving).reduce((a, d) => a + (d.amount || 0), 0)

  const list = [
    ...groups,
    { key: 'annual', name: 'Rücklagen jährl. Kosten', value: s.annual },
    ...(s.loans?.total > 0 ? [{ key: 'loans', name: 'Darlehen', value: s.loans.total }] : []),
    { key: 'saving', name: 'Sparbetrag', value: saving },
    { key: 'other', name: 'Weitere Abzüge', value: other },
  ].slice(0, 8)

  return [
    ...list.map((x, i) => ({ ...x, colorIndex: i, color: `var(--s${i + 1})` })),
    { key: 'free', name: s.result >= 0 ? 'Frei verfügbar' : 'Fehlbetrag', value: Math.max(0, s.result), colorIndex: -1, color: 'var(--neutral)' },
  ]
}
