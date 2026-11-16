import { useEffect, useState } from 'react'
import { latestRelease } from './storage.js'

export const APP_VERSION = __APP_VERSION__
export const REPO_URL = 'https://github.com/Memurame/budget-planer'

// 1.2.0 > 1.1.10 > 1.1.9 – numerischer Vergleich der Teile
export function isNewer(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0)
  }
  return false
}

// Beim Start und danach alle 6 Stunden prüfen, ob auf GitHub eine neuere Version liegt
export function useUpdateCheck() {
  const [update, setUpdate] = useState(null)
  useEffect(() => {
    let alive = true
    const check = () =>
      latestRelease().then((r) => {
        if (alive) setUpdate(r && r.version && isNewer(r.version, APP_VERSION) ? r : null)
      })
    check()
    const t = setInterval(check, 6 * 60 * 60 * 1000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  return update
}
