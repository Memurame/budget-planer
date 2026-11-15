import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadData, saveData } from './lib/storage.js'
import { createSeed } from './lib/seed.js'
import { addMonths, monthKey, monthLabel, summary } from './lib/calc.js'
import { Icon, DeleteDialogHost } from './components/ui.jsx'
import Overview from './components/Overview.jsx'
import BudgetEditor from './components/BudgetEditor.jsx'
import Reserves from './components/Reserves.jsx'
import Stats from './components/Stats.jsx'
import Settings from './components/Settings.jsx'
import Transactions from './components/Transactions.jsx'
import Accounts from './components/Accounts.jsx'
import { useTheme } from './lib/theme.js'
import { useTxStore } from './lib/useTx.js'
import { actualByPosition, migrate, monthProgress } from './lib/tx.js'

const NAV = [
  { id: 'overview', label: 'Übersicht', icon: Icon.home },
  { id: 'budget', label: 'Budget', icon: Icon.list },
  { id: 'transactions', label: 'Buchungen', icon: Icon.receipt },
  { id: 'reserves', label: 'Rücklagen', icon: Icon.calendar },
  { id: 'accounts', label: 'Konten', icon: Icon.wallet },
  { id: 'stats', label: 'Statistik', icon: Icon.chart },
  { id: 'settings', label: 'Einstellungen', icon: Icon.gear },
]

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved | error
  const [view, setView] = useState(() => localStorage.getItem('view') || 'overview')
  const [month, setMonth] = useState(monthKey())
  const theme = useTheme()
  const dirty = useRef(false)
  const txStore = useTxStore()
  const { ensureYears } = txStore

  // Benötigte Buchungsjahre laden: gewählter Monat und 12 Monate zurück (Verlauf, Rücklagen)
  useEffect(() => {
    ensureYears([Number(month.slice(0, 4)), Number(addMonths(month, -11).slice(0, 4))])
  }, [month, ensureYears])

  useEffect(() => { localStorage.setItem('view', view) }, [view])

  // Laden; beim ersten Start mit den Excel-Werten anlegen
  useEffect(() => {
    loadData()
      .then((d) => {
        if (d) setData(migrate(d))
        else { setData(migrate(createSeed())); dirty.current = true }
      })
      .catch((e) => setError(String(e)))
  }, [])

  // Automatisch speichern (kurz verzögert)
  useEffect(() => {
    if (!data || !dirty.current) return
    setSaveState('saving')
    const t = setTimeout(() => {
      saveData(data)
        .then(() => { dirty.current = false; setSaveState('saved') })
        .catch((e) => { setSaveState('error'); setError(String(e)) })
    }, 400)
    return () => clearTimeout(t)
  }, [data])

  const update = useCallback((fn) => {
    setData((prev) => {
      const next = structuredClone(prev)
      fn(next)
      dirty.current = true
      return next
    })
  }, [])

  const replaceData = useCallback((next) => { dirty.current = true; setData(next) }, [])

  const s = useMemo(() => (data ? summary(data, month) : null), [data, month])
  const tx = useMemo(
    () => ({
      ...txStore,
      actual: actualByPosition(txStore.transactions, month),
      progress: monthProgress(txStore.transactions, month),
      isClosed: (key) => txStore.closedMonths.includes(key),
    }),
    [txStore, month],
  )

  if (error && !data) return <div className="p-8 text-bad">Fehler beim Laden: {error}</div>
  if (!data) return <div className="grid h-full place-items-center text-ink-3">Lade Budget …</div>

  const isCurrent = month === monthKey()
  const props = { data, update, replaceData, summary: s, month, setMonth, theme, setView, tx }
  const anySaving = saveState === 'saving' || txStore.saveState === 'saving'
  const anyError = saveState === 'error' || txStore.saveState === 'error'

  return (
    <div className="flex h-full">
      <DeleteDialogHost />
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface px-3 py-5">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <img src="./icon.svg" alt="" className="size-8" />
          <div>
            <div className="text-[15px] font-semibold leading-tight">Budget</div>
            <div className="text-[12px] text-ink-3">Haushaltsplan</div>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setView(n.id)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition ${
                view === n.id ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
              }`}
            >
              {n.icon}
              {n.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto px-3 text-[12px] text-ink-3">
          {anyError ? <span className="text-bad">Speichern fehlgeschlagen</span> : anySaving ? 'Speichert …' : (saveState === 'saved' || txStore.saveState === 'saved') && '✓ Gespeichert'}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1280px] px-8 py-7">
          <div className="mb-6 flex items-center justify-between gap-4">
            <h1 className="text-[22px] font-semibold tracking-tight">{NAV.find((n) => n.id === view)?.label}</h1>
            {view !== 'settings' && (
              <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
                <button className="grid size-8 place-items-center rounded-lg text-ink-2 hover:bg-surface-2" onClick={() => setMonth(addMonths(month, -1))} title="Vorheriger Monat">{Icon.left}</button>
                <div className="num w-24 text-center text-[14px] font-medium">{monthLabel(month)}</div>
                <button className="grid size-8 place-items-center rounded-lg text-ink-2 hover:bg-surface-2" onClick={() => setMonth(addMonths(month, 1))} title="Nächster Monat">{Icon.right}</button>
                {!isCurrent && (
                  <button className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-accent hover:bg-accent-soft" onClick={() => setMonth(monthKey())}>Heute</button>
                )}
              </div>
            )}
          </div>

          {view === 'overview' && <Overview {...props} />}
          {view === 'budget' && <BudgetEditor {...props} />}
          {view === 'transactions' && <Transactions {...props} />}
          {view === 'reserves' && <Reserves {...props} />}
          {view === 'accounts' && <Accounts {...props} />}
          {view === 'stats' && <Stats {...props} />}
          {view === 'settings' && <Settings {...props} />}
        </div>
      </main>
    </div>
  )
}
