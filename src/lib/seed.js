import { uid } from './calc.js'

/** Leere Vorlage für den ersten Start. Danach ist die gespeicherte Datei der Master. */
export function createSeed() {
  return {
    version: 1,
    currency: 'CHF',
    income: [{ id: uid(), name: 'Lohn', amount: 0 }],
    groups: [
      { id: uid(), name: 'Fixkosten', items: [{ id: uid(), name: 'Miete', amount: 0 }] },
      { id: uid(), name: 'Abos', items: [] },
      { id: uid(), name: 'Lebenshaltung', items: [] },
    ],
    annual: [],
    deductions: [{ id: uid(), name: 'Sparbetrag', amount: 0, isSaving: true }],
    versions: [],
  }
}
