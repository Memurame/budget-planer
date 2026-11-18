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
import Loans from './components/Loans.jsx'
import { useTheme } from './lib/theme.js'
import { useTxStore } from './lib/useTx.js'
import { actualByPosition, migrate, monthOf, monthProgress } from './lib/tx.js'
import { buildOccurrences, todayStr } from './lib/recurring.js'
import { APP_VERSION, REPO_URL, useUpdateCheck } from './lib/version.js'
import { useImportFolder } from './lib/importFolder.js'

const NAV = [
  { id: 'overview', label: 'Übersicht', icon: Icon.home },
  { id: 'budget', label: 'Budget', icon: Icon.list },
  { id: 'transactions', label: 'Buchungen', icon: Icon.receipt },
  { id: 'reserves', label: 'Rücklagen', icon: Icon.calendar },
  { id: 'accounts', label: 'Konten', icon: Icon.wallet },
  { id: 'loans', label: 'Darlehen', icon: Icon.loan },
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
  const newRelease = useUpdateCheck()
  // Neue CSV im Import-Ordner → Buchungen öffnen, dort erscheint die Import-Vorschau
  const folderImport = useImportFolder(() => setView('transactions'))
  const dirty = useRef(false)
  const txStore = useTxStore()
  const { ensureYears } = txStore

  // Benötigte Buchungsjahre laden: gewählter Monat und 12 Monate zurück (Verlauf, Rücklagen)
  useEffect(() => {
    ensureYears([Number(month.slice(0, 4)), Number(addMonths(month, -11).slice(0, 4))])
  }, [month, ensureYears])

  // Darlehen: alle vorhandenen Buchungsjahre laden – die Einzahlung und Rückzahlungen können in jedem Jahr liegen
  const hasLoans = (data?.loans || []).length > 0
  const { knownYears } = txStore
  useEffect(() => {
    if (hasLoans && knownYears.length) ensureYears(knownYears)
  }, [hasLoans, knownYears, ensureYears])

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

  const startMonth = data?.startMonth || null
  // Wiederkehrende Buchungen: fällige Termine bis heute erzeugen (beim Start und bei Änderungen an Vorlagen)
  const recurringKey = data ? JSON.stringify(data.recurring || []) : ''
  useEffect(() => {
    if (!data || !(data.recurring || []).length) return
    // erst ab dem Startmonat erzeugen
    const list = data.recurring.flatMap((tpl) => buildOccurrences(tpl, todayStr())).filter((t) => !startMonth || monthOf(t.date) >= startMonth)
    if (!list.length) return
    const years = [...new Set(list.map((t) => Number(t.date.slice(0, 4))))]
    ensureYears(years).then(() => txStore.addTxUnique(list))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recurringKey, ensureYears, startMonth])

  // Vor den Startmonat kann man nicht zurückblättern
  useEffect(() => {
    if (startMonth && month < startMonth) setMonth(startMonth)
  }, [startMonth, month])

  // Mit allen Buchungen: bereits zurückbezahlte Darlehen werden nicht mehr budgetiert
  const s = useMemo(() => (data ? summary(data, month, txStore.transactions) : null), [data, month, txStore.transactions])
  const tx = useMemo(() => {
    // Buchungen vor dem Startmonat werden ausgeblendet (nicht gelöscht). Für Kontosalden und
    // Saldo-Abgleich sowie die Duplikaterkennung beim Import bleiben alle unter `allTransactions`.
    const visible = startMonth ? txStore.transactions.filter((t) => monthOf(t.date) >= startMonth) : txStore.transactions
    return {
      ...txStore,
      allTransactions: txStore.transactions,
      transactions: visible,
      startMonth,
      actual: actualByPosition(visible, month),
      progress: monthProgress(visible, month),
      isClosed: (key) => txStore.closedMonths.includes(key),
    }
  }, [txStore, month, startMonth])

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
        <div className="mt-auto flex flex-col gap-2 px-3 text-[12px] text-ink-3">
          <div>
            {anyError ? <span className="text-bad">Speichern fehlgeschlagen</span> : anySaving ? 'Speichert …' : (saveState === 'saved' || txStore.saveState === 'saved') && '✓ Gespeichert'}
          </div>
          {newRelease && (
            <a
              href={newRelease.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-accent-soft px-2.5 py-1.5 font-medium text-accent hover:underline"
              title={newRelease.name || `Version ${newRelease.version}`}
            >
              Neue Version {newRelease.version} verfügbar
            </a>
          )}
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-ink hover:underline" title="Projekt auf GitHub">
            budget-planer v{APP_VERSION}
          </a>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="px-8 py-7">
          <div className="mb-6 flex items-center justify-between gap-4">
            <h1 className="text-[22px] font-semibold tracking-tight">{NAV.find((n) => n.id === view)?.label}</h1>
            {view !== 'settings' && (
              <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
                <button
                  className="grid size-8 place-items-center rounded-lg text-ink-2 hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-30"
                  onClick={() => setMonth(addMonths(month, -1))}
                  disabled={!!startMonth && month <= startMonth}
                  title={startMonth && month <= startMonth ? `Start des Budget-Planers: ${monthLabel(startMonth)}` : 'Vorheriger Monat'}
                >
                  {Icon.left}
                </button>
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
          {view === 'transactions' && <Transactions {...props} folderImport={folderImport} />}
          {view === 'reserves' && <Reserves {...props} />}
          {view === 'accounts' && <Accounts {...props} />}
          {view === 'loans' && <Loans {...props} />}
          {view === 'stats' && <Stats {...props} />}
          {view === 'settings' && <Settings {...props} />}
        </div>
      </main>
    </div>
  )
}
