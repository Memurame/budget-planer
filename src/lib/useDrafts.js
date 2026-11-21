// Vorgemerkte Änderungen pro Zeile: werden erst mit «Speichern» übernommen.
import { useRef, useState } from 'react'
import { useUnsaved } from './unsaved.js'

const norm = (v) => (v === '' || v === undefined ? null : v)

/**
 * `drafts` = { [zeilenId]: { feld: wert } }. Werte, die wieder dem Original entsprechen, fallen weg.
 * Der Ref wird sofort aktualisiert, damit «Speichern» direkt nach einem Blur (Enter) den neuesten Stand sieht.
 */
export function useDrafts() {
  const [drafts, setState] = useState({})
  const ref = useRef(drafts)
  const commit = (n) => { ref.current = n; setState(n) }
  const discardAll = () => commit({})
  useUnsaved(Object.keys(drafts).length, discardAll)

  const has = (id, k) => !!drafts[id] && k in drafts[id]
  const val = (id, k, base) => (has(id, k) ? drafts[id][k] : base)
  const set = (id, k, v, base) => {
    const p = { ...(ref.current[id] || {}) }
    if (norm(v) === norm(base)) delete p[k]
    else p[k] = v
    const n = { ...ref.current }
    if (Object.keys(p).length) n[id] = p
    else delete n[id]
    commit(n)
  }
  /** Änderungen einer Zeile herausnehmen (zum Speichern) – danach ist die Zeile wieder sauber. */
  const take = (id) => {
    const p = ref.current[id]
    if (p) { const n = { ...ref.current }; delete n[id]; commit(n) }
    return p
  }
  const peek = (id) => ref.current[id]

  /** Enter speichert, Esc verwirft – für die ganze Zeile. */
  const rowKeys = (id, save) => (e) => {
    if (e.key === 'Enter') {
      e.target.blur?.() // Betrags-/Textfelder übernehmen beim Verlassen
      if (!ref.current[id]) return
      e.preventDefault()
      save()
    } else if (e.key === 'Escape' && ref.current[id]) {
      // nach dem Betragsfeld (das bei Esc verzögert verlässt) verwerfen, sonst setzt es den Wert wieder
      requestAnimationFrame(() => { document.activeElement?.blur?.(); requestAnimationFrame(() => take(id)) })
    }
  }

  return { drafts, ids: Object.keys(drafts), count: Object.keys(drafts).length, dirty: (id) => !!drafts[id], has, val, set, take, peek, discard: take, discardAll, rowKeys, current: () => ref.current }
}
