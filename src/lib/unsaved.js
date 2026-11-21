// Ungespeicherte Änderungen (vorgemerkte Zeilen) über die ganze App: Rückfrage vor einem Wechsel.
import { useEffect, useId, useRef } from 'react'

const sources = new Map() // id → { count, discard }

/** Meldet `count` ungespeicherte Änderungen; `discard` verwirft sie nach einem bestätigten Wechsel. */
export function useUnsaved(count, discard) {
  const id = useId()
  const discardRef = useRef(discard)
  discardRef.current = discard
  useEffect(() => {
    if (count) sources.set(id, { count, discard: () => discardRef.current?.() })
    else sources.delete(id)
  }, [id, count])
  useEffect(() => () => { sources.delete(id) }, [id])
}

export const unsavedCount = () => [...sources.values()].reduce((s, x) => s + x.count, 0)

/** Vor Tab-, Seiten- oder Monatswechsel: true, wenn nichts offen ist oder der Benutzer verwerfen will. */
export function confirmLeave() {
  const n = unsavedCount()
  if (!n) return true
  if (!confirm(`${n} ungespeicherte Änderung${n > 1 ? 'en gehen' : ' geht'} verloren. Trotzdem fortfahren?`)) return false
  for (const s of [...sources.values()]) s.discard()
  return true
}
