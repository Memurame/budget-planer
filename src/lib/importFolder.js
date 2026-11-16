import { useCallback, useEffect, useRef, useState } from 'react'
import { importList, importRead } from './storage.js'

const POLL_MS = 30000

/**
 * Beobachtet den Import-Ordner: beim Start, alle 30 s und wenn das Fenster den Fokus bekommt.
 * Eine neue Datei wird als `pending` geliefert (eine nach der anderen). Jede Datei wird pro
 * App-Sitzung nur einmal angeboten (nach Import oder Abbrechen wird sie ohnehin gelöscht).
 */
export function useImportFolder(onNew) {
  const [pending, setPending] = useState(null)
  const offered = useRef(new Set())
  const busy = useRef(false)
  const pendingRef = useRef(null)
  pendingRef.current = pending
  const onNewRef = useRef(onNew)
  onNewRef.current = onNew

  const check = useCallback(async () => {
    if (busy.current || pendingRef.current) return
    busy.current = true
    try {
      const files = await importList()
      const next = files.find((f) => !offered.current.has(`${f.name}|${f.mtime}`))
      if (!next) return
      offered.current.add(`${next.name}|${next.mtime}`)
      const file = await importRead(next.name)
      setPending({ ...file, fromFolder: true })
      onNewRef.current?.()
    } catch {
      // Ordner nicht lesbar o. Ä. – beim nächsten Durchgang erneut versuchen
    } finally {
      busy.current = false
    }
  }, [])

  useEffect(() => {
    check()
    const t = setInterval(check, POLL_MS)
    window.addEventListener('focus', check)
    return () => { clearInterval(t); window.removeEventListener('focus', check) }
  }, [check])

  // Nach Import oder Abbrechen: freigeben und gleich nach der nächsten Datei schauen
  const clear = useCallback(() => {
    pendingRef.current = null
    setPending(null)
    setTimeout(check, 0)
  }, [check])

  return { pending, clear }
}
