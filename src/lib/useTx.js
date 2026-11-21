import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listTxYears, loadTxYear, saveTxYear } from './storage.js'
import { emptyYear, yearOf } from './tx.js'

/**
 * Buchungen, Salden und abgeschlossene Monate – eine Datei pro Jahr.
 * Jahre werden bei Bedarf geladen; gespeichert werden nur geänderte Jahre.
 */
export function useTxStore() {
  const [years, setYears] = useState({})
  const [knownYears, setKnownYears] = useState([])
  const [saveState, setSaveState] = useState('idle')
  const yearsRef = useRef({})
  const pending = useRef(new Map())
  const dirty = useRef(new Set())

  useEffect(() => { yearsRef.current = years }, [years])
  const knownYearsRef = useRef([])
  const ensureYearsRef = useRef(null)
  useEffect(() => { listTxYears().then(setKnownYears).catch(() => {}) }, [])
  useEffect(() => { knownYearsRef.current = knownYears }, [knownYears])

  /** Stellt sicher, dass die Jahre geladen sind (fehlende Dateien → leeres Jahr). */
  const ensureYears = useCallback(async (list) => {
    const wanted = [...new Set(list.map(Number))].filter((y) => y && !(y in yearsRef.current))
    await Promise.all(
      wanted.map((y) => {
        if (!pending.current.has(y)) {
          pending.current.set(
            y,
            loadTxYear(y).then((d) => {
              const value = { ...emptyYear(), ...(d || {}) }
              yearsRef.current = { ...yearsRef.current, [y]: value }
              setYears((prev) => (y in prev ? prev : { ...prev, [y]: value }))
            }),
          )
        }
        return pending.current.get(y)
      }),
    )
  }, [])

  ensureYearsRef.current = ensureYears

  /** Änderung an den geladenen Jahren. `fn(draft)` bekommt { [jahr]: {...} }. */
  const updateYears = useCallback((fn) => {
    setYears((prev) => {
      const draft = structuredClone(prev)
      fn(draft)
      for (const y of Object.keys(draft)) {
        if (JSON.stringify(draft[y]) !== JSON.stringify(prev[y])) dirty.current.add(Number(y))
      }
      yearsRef.current = draft
      return draft
    })
  }, [])

  // Automatisch speichern – nur geänderte Jahre
  useEffect(() => {
    if (dirty.current.size === 0) return
    setSaveState('saving')
    const t = setTimeout(async () => {
      const list = [...dirty.current]
      dirty.current.clear()
      try {
        for (const y of list) await saveTxYear(y, yearsRef.current[y])
        setKnownYears((k) => [...new Set([...k, ...list])].sort())
        setSaveState('saved')
      } catch (e) {
        list.forEach((y) => dirty.current.add(y))
        setSaveState('error')
        console.error(e)
      }
    }, 400)
    return () => clearTimeout(t)
  }, [years])

  const transactions = useMemo(
    () => Object.values(years).flatMap((y) => y.transactions).sort((a, b) => b.date.localeCompare(a.date) || (b.bookedDate || '').localeCompare(a.bookedDate || '')),
    [years],
  )
  const balances = useMemo(() => Object.values(years).flatMap((y) => y.balances), [years])
  const closedMonths = useMemo(() => Object.values(years).flatMap((y) => y.closedMonths || []), [years])
  const deletedIds = useMemo(() => new Set(Object.values(years).flatMap((y) => y.deletedIds || [])), [years])

  // ── Operationen ───────────────────────────────────────────────
  const findYear = (draft, id) => Object.keys(draft).find((y) => draft[y].transactions.some((t) => t.id === id))

  const ops = useMemo(
    () => ({
      /** Buchungen ändern: fn(tx) für jede ID. */
      updateTx: (ids, fn) =>
        updateYears((d) => {
          const set = new Set([].concat(ids))
          const moves = []
          for (const y of Object.keys(d)) for (const t of d[y].transactions) {
            if (!set.has(t.id)) continue
            fn(t)
            if (String(yearOf(t.date)) !== y && d[yearOf(t.date)]) moves.push([y, t])
          }
          // Datum in ein anderes Jahr geändert → in die richtige Jahresdatei verschieben (Zieljahr muss geladen sein)
          for (const [y, t] of moves) {
            d[y].transactions = d[y].transactions.filter((x) => x !== t)
            // wiederkehrende/CSV-Buchung im alten Jahr nicht neu erzeugen bzw. importieren
            if (t.source === 'recurring' || t.source === 'csv') d[y].deletedIds = [...new Set([...(d[y].deletedIds || []), t.id])]
            d[yearOf(t.date)].transactions.push(t)
          }
        }),
      /** Neue Buchungen hinzufügen (Jahre müssen vorher mit ensureYears geladen sein). */
      addTx: (list) =>
        updateYears((d) => {
          for (const t of [].concat(list)) {
            const y = yearOf(t.date)
            d[y] = d[y] || emptyYear()
            d[y].transactions.push(t)
          }
        }),
      /**
       * Buchungen löschen. Aus einem CSV-Import stammende werden gemerkt (deletedIds),
       * damit sie beim erneuten Import derselben Datei nicht zurückkommen.
       */
      /**
       * Buchungen hinzufügen, aber nur, wenn es sie noch nicht gibt, sie nicht gelöscht wurden
       * und der Monat nicht abgeschlossen ist (für wiederkehrende Buchungen). Jahre müssen geladen sein.
       */
      addTxUnique: (list) =>
        updateYears((d) => {
          for (const t of list) {
            const y = yearOf(t.date)
            if (!d[y]) continue
            const yr = d[y]
            if ((yr.closedMonths || []).includes(t.date.slice(0, 7))) continue
            if ((yr.deletedIds || []).includes(t.id)) continue
            if (yr.transactions.some((x) => x.id === t.id)) continue
            yr.transactions.push(t)
          }
        }),
      removeTx: (ids) =>
        updateYears((d) => {
          const set = new Set([].concat(ids))
          for (const y of Object.keys(d)) {
            const gone = d[y].transactions.filter((t) => set.has(t.id))
            if (!gone.length) continue
            // CSV- und wiederkehrende Buchungen merken, damit sie nicht erneut entstehen
            d[y].deletedIds = [...new Set([...(d[y].deletedIds || []), ...gone.filter((t) => t.source === 'csv' || t.source === 'recurring').map((t) => t.id)])]
            d[y].transactions = d[y].transactions.filter((t) => !set.has(t.id))
          }
          // Verknüpfungen zu gelöschten Buchungen lösen
          for (const y of Object.keys(d)) for (const t of d[y].transactions) if (t.linkedId && set.has(t.linkedId)) delete t.linkedId
        }),
      addBalance: (b) =>
        updateYears((d) => {
          const y = yearOf(b.date)
          d[y] = d[y] || emptyYear()
          // Ein Saldo pro Konto und Tag – neuer Wert ersetzt den alten
          d[y].balances = d[y].balances.filter((x) => !(x.accountId === b.accountId && x.date === b.date))
          d[y].balances.push(b)
        }),
      removeBalance: (id) =>
        updateYears((d) => {
          for (const y of Object.keys(d)) d[y].balances = d[y].balances.filter((b) => b.id !== id)
        }),
      setMonthClosed: (key, closed) =>
        updateYears((d) => {
          const y = Number(key.slice(0, 4))
          d[y] = d[y] || emptyYear()
          const set = new Set(d[y].closedMonths || [])
          closed ? set.add(key) : set.delete(key)
          d[y].closedMonths = [...set].sort()
        }),
      /** Zuordnungen zu gelöschten Positionen entfernen (alle Jahre) → Buchungen wieder «offen». */
      unassignPositions: async (ids) => {
        const set = new Set(ids)
        await ensureYearsRef.current(knownYearsRef.current)
        updateYears((d) => {
          for (const y of Object.keys(d)) for (const t of d[y].transactions) {
            const hit = set.has(t.positionId) || (t.splits || []).some((x) => set.has(x.positionId))
            if (!hit) continue
            t.positionId = null
            delete t.splits
            t.ruleId = null
            if (t.status !== 'ignored') t.status = 'open'
          }
        })
      },
      /** Freie Änderung über alle geladenen Jahre (z. B. Regeln neu anwenden). */
      updateYears,
    }),
    [updateYears],
  )

  return { years, knownYears, transactions, balances, closedMonths, deletedIds, ensureYears, saveState, ...ops }
}
