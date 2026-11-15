import { useEffect, useState } from 'react'

const mq = window.matchMedia('(prefers-color-scheme: dark)')

/** Theme: 'system' | 'light' | 'dark'. Liefert auch `resolved`, damit Diagramme neu zeichnen. */
export function useTheme() {
  const [mode, setMode] = useState(() => localStorage.getItem('theme') || 'system')
  const [systemDark, setSystemDark] = useState(mq.matches)

  useEffect(() => {
    const on = (e) => setSystemDark(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    localStorage.setItem('theme', mode)
    if (mode === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', mode)
  }, [mode])

  const resolved = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode
  return { mode, setMode, resolved }
}

/** Liest die aktuellen CSS-Farbtokens (für Chart.js). */
export function readColors() {
  const cs = getComputedStyle(document.documentElement)
  const v = (n) => cs.getPropertyValue(n).trim()
  return {
    surface: v('--surface'),
    line: v('--line'),
    ink: v('--ink'),
    ink2: v('--ink-2'),
    ink3: v('--ink-3'),
    accent: v('--accent'),
    neutral: v('--neutral'),
    good: v('--good'),
    bad: v('--bad'),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--s${i}`)),
  }
}
