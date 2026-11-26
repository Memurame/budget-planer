import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Card, Button, IconButton, Badge, Icon, AmountInput, TextInput, Changed, DirtyBar, RowSave, dirtyRowCls } from './ui.jsx'
import { TxEditDialog } from './EditDialogs.jsx'
import { useDrafts } from '../lib/useDrafts.js'
import { confirmLeave } from '../lib/unsaved.js'
import PositionSelect, { positionName } from './PositionSelect.jsx'
import EntryForm from './EntryForm.jsx'
import RecurringList from './RecurringList.jsx'
import OpenPayments from './OpenPayments.jsx'
import SplitEditor from './SplitEditor.jsx'
import { scaleSplits, todayStr } from '../lib/recurring.js'
import { fmtCHF, fmtDate, fmtPct } from '../lib/format.js'
import { monthLabel, uid } from '../lib/calc.js'
import { importRemove, openCsv } from '../lib/storage.js'
import { STATUS, allocations, isAssigned, isSplit, applyCsvRow, applyRules, findRule, monthOf, parseRevolut, ruleMatches, suggestOffsets, suggestPattern, yearOf } from '../lib/tx.js'

const FILTERS = [
  ['all', 'Alle'],
  ['open', 'Offen'],
  ['auto', 'Automatisch'],
  ['manual', 'Manuell'],
  ['confirmed', 'Bestätigt'],
  ['ignored', 'Ignoriert'],
]

export default function Transactions({ data, update, month, tx, folderImport }) {
  // Tab; die Übersicht kann «Offene Zahlungen» direkt öffnen (einmalig über sessionStorage)
  const [tab, setTab] = useState(() => { try { const t = sessionStorage.getItem('txTab'); sessionStorage.removeItem('txTab'); return t || 'list' } catch { return 'list' } })
  const [convert, setConvert] = useState(null) // offene Zahlung, die gerade als Buchung erfasst wird
  const [showOpenForm, setShowOpenForm] = useState(false) // Formular «Offene Zahlung vormerken»
  const [status, setStatus] = useState('all')
  const [scope, setScope] = useState('month')
  const [accountId, setAccountId] = useState('')
  const [positionId, setPositionId] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [imp, setImp] = useState(null)
  const suggestionsRef = useRef(null)
  const [splitId, setSplitId] = useState(null)
  const [editId, setEditId] = useState(null) // Buchung im Bearbeiten-Fenster
  const drafts = useDrafts() // vorgemerkte Änderungen in der Liste (Konto, Position)
  const pending = data.pendingRules || []
  const [showManual, setShowManual] = useState(false)
  const [msg, setMsg] = useState('')

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 5000) }
  const closed = tx.isClosed(month)
  const accountName = (id) => data.accounts.find((a) => a.id === id)?.name || '–'

  // Schutz für abgeschlossene Monate
  const guard = (list) => {
    const months = [...new Set(list.map((t) => monthOf(t.date)))].filter((m) => tx.isClosed(m))
    return months.length === 0 || confirm(`${months.map((m) => monthLabel(m)).join(', ')} ist abgeschlossen. Trotzdem ändern?`)
  }

  const inScope = useMemo(
    () => tx.transactions.filter((t) => (scope === 'month' ? monthOf(t.date) === month : yearOf(t.date) === Number(month.slice(0, 4)))),
    [tx.transactions, scope, month],
  )
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return inScope.filter(
      (t) =>
        (status === 'all' || t.status === status) &&
        (!accountId || t.accountId === accountId) &&
        (!positionId || allocations(t).some((a) => a.positionId === positionId)) &&
        (!q || t.text.toLowerCase().includes(q) || String(Math.abs(t.amount)).includes(q)),
    )
  }, [inScope, status, accountId, positionId, search])

  const counts = useMemo(() => {
    const c = { all: inScope.length }
    for (const t of inScope) c[t.status] = (c[t.status] || 0) + 1
    return c
  }, [inScope])

  const offsets = useMemo(() => suggestOffsets(inScope), [inScope])
  const byId = useMemo(() => Object.fromEntries(tx.transactions.map((t) => [t.id, t])), [tx.transactions])

  // ── Aktionen ────────────────────────────────────────────────
  /**
   * Regelvorschläge sammeln – es wird nichts automatisch erstellt.
   * Ein Vorschlag pro Muster; wird derselbe Händler erneut zugeordnet, wird der Vorschlag aktualisiert.
   */
  const queueSuggestions = (list, pid) => {
    update((d) => {
      d.pendingRules = d.pendingRules || []
      for (const t of list) {
        const pattern = suggestPattern(t.text)
        if (!pattern) continue
        const existing = findRule(d.rules, t.text)
        const key = pattern.toLowerCase()
        const idx = d.pendingRules.findIndex((s) => s.pattern.toLowerCase() === key)
        if (existing && existing.positionId === pid) {
          if (idx >= 0) d.pendingRules.splice(idx, 1) // Regel existiert schon
          continue
        }
        if (idx >= 0) Object.assign(d.pendingRules[idx], { positionId: pid, sample: t.text, hits: (d.pendingRules[idx].hits || 1) + 1 })
        else d.pendingRules.push({ id: uid(), pattern, positionId: pid, sample: t.text, hits: 1 })
      }
    })
  }

  /**
   * Regeln aus Vorschlägen erstellen und sofort anwenden. Trifft bereits eine andere Regel auf den Text zu,
   * bekommt die neue Regel Vorrang (wird davor eingefügt) – die manuelle Korrektur soll gelten.
   */
  const createRules = (suggestions) => {
    const rules = [...data.rules]
    for (const s of suggestions) {
      if (!s.pattern.trim() || !s.positionId) continue
      const rule = { id: uid(), pattern: s.pattern.trim(), positionId: s.positionId }
      const conflict = rules.findIndex((r) => ruleMatches(r, s.sample || s.pattern))
      rules.splice(conflict >= 0 ? conflict : rules.length, 0, rule)
    }
    const ids = new Set(suggestions.map((s) => s.id))
    update((d) => {
      d.rules = rules
      d.pendingRules = (d.pendingRules || []).filter((s) => !ids.has(s.id))
    })
    const count = applyAllRules(rules)
    flash(`${suggestions.length} Regel${suggestions.length > 1 ? 'n' : ''} erstellt${count ? `, ${count} weitere Buchung${count > 1 ? 'en' : ''} zugeordnet` : ''}.`)
  }
  const discardSuggestions = (suggestions) => {
    const ids = new Set(suggestions.map((s) => s.id))
    update((d) => { d.pendingRules = (d.pendingRules || []).filter((s) => !ids.has(s.id)) })
  }
  const editSuggestion = (id, fn) => update((d) => { const s = (d.pendingRules || []).find((x) => x.id === id); if (s) fn(s) })
  const setIgnored = (list, ignored) => {
    if (!guard(list)) return
    tx.updateTx(list.map((t) => t.id), (x) => {
      x.override = true
      x.ruleId = null
      if (ignored) { x.status = 'ignored'; x.positionId = null }
      else x.status = 'open'
    })
  }
  const confirmTx = (list) => {
    const ok = list.filter((t) => isAssigned(t) && t.status !== 'confirmed' && t.status !== 'ignored')
    if (!ok.length || !guard(ok)) return
    tx.updateTx(ok.map((t) => t.id), (x) => { x.status = 'confirmed' })
    flash(`${ok.length} Buchung${ok.length > 1 ? 'en' : ''} bestätigt.`)
  }
  const removeMany = (list) => {
    if (!list.length || !guard(list)) return
    const csv = list.filter((t) => t.source === 'csv').length
    if (!confirm(`${list.length} Buchung${list.length > 1 ? 'en' : ''} löschen?${csv ? `\n\n${csv} stamm${csv > 1 ? 'en' : 't'} aus einem CSV-Import und wird beim erneuten Import derselben Datei übersprungen.` : ''}`)) return
    tx.removeTx(list.map((t) => t.id))
    setSelected(new Set())
    flash(`${list.length} Buchung${list.length > 1 ? 'en' : ''} gelöscht.`)
  }
  const saveSplit = (t, splits) => {
    if (!guard([t])) return
    tx.updateTx(t.id, (x) => {
      x.override = true
      x.ruleId = null
      if (splits) { x.splits = splits; x.positionId = null; x.status = 'manual' }
      else { delete x.splits; x.status = x.positionId ? 'manual' : 'open' }
    })
    setSplitId(null)
  }
  /** Vorgemerkte Änderungen einer Buchung übernehmen (Schutz für abgeschlossene Monate macht der Aufrufer). */
  const applyDraft = (t, p) => {
    if (!p) return
    const sign = Math.sign(t.amount) || -1
    const amountChanged = 'amount' in p && t.source !== 'csv' && p.amount > 0
    tx.updateTx(t.id, (x) => {
      if ('text' in p && p.text.trim()) x.text = p.text.trim()
      if (amountChanged) {
        x.amount = sign * p.amount
        x.override = true
        if (x.splits?.length) x.splits = scaleSplits(x.splits, p.amount).map((s) => ({ positionId: s.positionId, amount: sign * s.amount }))
      }
      if ('accountId' in p) x.accountId = p.accountId || null
      if ('positionId' in p) {
        x.override = true
        x.ruleId = null
        if (p.positionId === '__ignore') { x.status = 'ignored'; x.positionId = null }
        else { x.positionId = p.positionId; x.status = p.positionId ? 'manual' : 'open' }
      }
    })
    // manuelle Umbuchung: Gegenbuchung mit anpassen
    const partner = t.linkedId && byId[t.linkedId]
    if (amountChanged && partner && /Umbuchung/.test(t.kind || '') && partner.source !== 'csv') {
      tx.updateTx(partner.id, (x) => { x.amount = -sign * p.amount; x.override = true })
    }
    if (p.positionId && p.positionId !== '__ignore') queueSuggestions([t], p.positionId)
  }
  const saveDrafts = (ids) => {
    const list = ids.map((id) => byId[id]).filter(Boolean)
    if (!list.length || !guard(list)) return
    for (const t of list) applyDraft(t, drafts.take(t.id))
    for (const id of ids) drafts.take(id) // verschwundene Buchungen
  }
  const unconfirm = (t) => guard([t]) && tx.updateTx(t.id, (x) => { x.status = 'manual' })
  const assignMany = (list, pid) => {
    if (!pid || !guard(list)) return
    if (pid === '__ignore') return setIgnored(list, true)
    tx.updateTx(list.map((t) => t.id), (x) => { x.positionId = pid; x.status = 'manual'; x.ruleId = null; x.override = true })
    queueSuggestions(list, pid)
  }
  const applyAllRules = (rules = data.rules) => {
    // Anzahl vorab auf dem aktuellen Stand zählen (die Zustandsänderung selbst läuft verzögert)
    const changed = tx.transactions.filter((t) => !tx.isClosed(monthOf(t.date)) && applyRules({ ...t }, rules)).length
    tx.updateYears((d) => {
      for (const y of Object.keys(d)) for (const t of d[y].transactions) if (!tx.isClosed(monthOf(t.date))) applyRules(t, rules)
    })
    return changed
  }
  const link = (a, b) => {
    tx.updateTx([a.id, b.id], (x) => { x.linkedId = x.id === a.id ? b.id : a.id })
  }
  const unlink = (t) => tx.updateTx([t.id, t.linkedId].filter(Boolean), (x) => { delete x.linkedId })

  // ── Import ──────────────────────────────────────────────────
  const startImport = async () => {
    const file = await openCsv()
    if (file) loadImport(file)
  }

  // Datei aus dem Import-Ordner: Vorschau öffnen, sobald kein anderer Import offen ist
  const pendingFile = folderImport?.pending
  useEffect(() => {
    if (pendingFile && !imp) loadImport(pendingFile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFile, imp])

  const loadImport = async (file) => {
    const res = parseRevolut(file.content)
    if (res.error) {
      if (file.fromFolder) folderImport.clear()
      return alert(`${file.name}: ${res.error}`)
    }
    await tx.ensureYears([...res.rows.map((r) => yearOf(r.date)), ...Object.values(res.balances).map((b) => yearOf(b.date))])
    const mapping = {}
    for (const p of res.products) mapping[p] = data.importMappings[`revolut:${p}`] || (data.accounts.find((a) => a.name.toLowerCase().includes(p.toLowerCase()))?.id ?? '__new')
    setImp({ file: file.name, fromFolder: !!file.fromFolder, ...res, mapping })
    setTab('list') // Vorschau erscheint bei den Buchungen
  }

  // Vorschau schliessen (nach Import oder Abbrechen); eine Datei aus dem Import-Ordner wird dabei gelöscht
  const closeImport = async () => {
    const fromFolder = imp?.fromFolder && imp.file
    setImp(null)
    if (!fromFolder) return
    try { await importRemove(fromFolder) } catch (e) { alert(`${fromFolder} konnte nicht gelöscht werden: ${e}`) }
    folderImport?.clear()
  }

  const preview = useMemo(() => {
    if (!imp) return null
    // Duplikate gegen alle Buchungen prüfen, auch die vor dem Startmonat ausgeblendeten
    const existing = new Map(tx.allTransactions.map((t) => [t.id, t]))
    // Zeilen vor dem Start des Budget-Planers werden übersprungen
    const isBeforeStart = (r) => !!tx.startMonth && monthOf(r.date) < tx.startMonth
    const beforeStart = imp.rows.filter(isBeforeStart).length
    const rows = imp.rows.filter((r) => !isBeforeStart(r))
    const fresh = []
    const finalize = [] // abgeschlossene Zeilen, die eine ausstehende Buchung ersetzen
    const refresh = [] // weiterhin ausstehend, aber mit geändertem Betrag
    let deleted = 0, duplicates = 0
    for (const r of rows) {
      const own = existing.get(r.id)
      if (own) {
        if (r.pending && own.pending && Math.abs(own.amount - r.amount) >= 0.005) refresh.push(r)
        else duplicates++
      } else if (!r.pending && existing.get(r.pendingId)?.pending) finalize.push(r)
      else if (tx.deletedIds.has(r.id) || (!r.pending && tx.deletedIds.has(r.pendingId))) deleted++
      else fresh.push(r)
    }
    // Ausstehende Buchungen, die im Zeitraum der Datei nicht mehr vorkommen (oder storniert sind) → entfernen
    const seen = new Set(imp.rows.map((r) => (r.pending ? r.id : r.pendingId)))
    const covers = (t) => imp.products.some((p) => imp.mapping[p] === t.accountId && imp.periods[p] && t.date >= imp.periods[p].from && t.date <= imp.periods[p].to)
    const stale = tx.allTransactions.filter((t) => t.pending && t.source === 'csv' && !seen.has(t.id) && covers(t))
    let ignored = 0, auto = 0
    for (const r of fresh) {
      const rule = findRule(data.rules, r.text)
      if (rule?.action === 'ignore') ignored++
      else if (rule) auto++
    }
    const months = [...new Set(rows.map((r) => monthOf(r.date)))].sort()
    const closedHit = months.filter((m) => tx.isClosed(m))
    const pendingNew = fresh.filter((r) => r.pending && !tx.isClosed(monthOf(r.date))).length
    const changes = fresh.length + finalize.length + refresh.length + stale.length
    return { fresh, finalize, refresh, stale, pendingNew, changes, deleted, beforeStart, duplicates, ignored, auto, open: fresh.length - ignored - auto, months, closedHit }
  }, [imp, tx.allTransactions, tx.startMonth, data.rules])

  const doImport = () => {
    const ids = {}
    const newAccounts = []
    for (const p of imp.products) {
      if (imp.mapping[p] === '__new') {
        const acc = { id: uid(), name: `Revolut ${p}`, type: /giro|current/i.test(p) ? 'giro' : 'pocket', funds: [] }
        newAccounts.push(acc)
        ids[p] = acc.id
      } else ids[p] = imp.mapping[p] || null
    }
    update((d) => {
      d.accounts.push(...newAccounts)
      for (const p of imp.products) if (ids[p]) d.importMappings[`revolut:${p}`] = ids[p]
    })
    const rows = preview.fresh
      .filter((r) => !tx.isClosed(monthOf(r.date)))
      .map((r) => {
        const t = { id: r.id, accountId: ids[r.product], date: r.date, bookedDate: r.bookedDate, bookedAt: r.bookedAt, text: r.text, kind: r.kind, amount: r.amount, source: 'csv', status: 'open', positionId: null, ruleId: null }
        if (r.pending) t.pending = true
        applyRules(t, data.rules)
        return t
      })
    tx.addTx(rows)
    // Ausstehende Buchungen nachführen: abschliessen (neue ID), Betrag aktualisieren oder entfernen.
    // Zuordnung, Aufteilung, Text und Datum bleiben erhalten.
    const fin = new Map([...preview.finalize.map((r) => [r.pendingId, r]), ...preview.refresh.map((r) => [r.id, r])])
    const staleIds = new Set(preview.stale.map((t) => t.id))
    if (fin.size || staleIds.size) {
      tx.updateYears((d) => {
        for (const y of Object.keys(d)) {
          d[y].transactions = d[y].transactions.filter((t) => !staleIds.has(t.id))
          for (const t of d[y].transactions) {
            if (t.linkedId && staleIds.has(t.linkedId)) delete t.linkedId
            if (t.linkedId && fin.has(t.linkedId)) t.linkedId = fin.get(t.linkedId).id
            if (fin.has(t.id)) applyCsvRow(t, fin.get(t.id))
          }
        }
      })
    }
    for (const [p, b] of Object.entries(imp.balances)) {
      if (ids[p]) tx.addBalance({ id: uid(), accountId: ids[p], date: b.date, at: b.at, amount: b.amount, source: 'csv' })
    }
    closeImport()
    const pendingNew = rows.filter((t) => t.pending).length
    flash([
      `${rows.length} neue Buchungen importiert${pendingNew ? ` (davon ${pendingNew} ausstehend)` : ''}`,
      preview.finalize.length && `${preview.finalize.length} ausstehende abgeschlossen`,
      preview.refresh.length && `${preview.refresh.length} ausstehende mit neuem Betrag`,
      preview.stale.length && `${preview.stale.length} ausstehende entfernt (storniert)`,
      preview.duplicates && `${preview.duplicates} bereits vorhanden`,
    ].filter(Boolean).join(', ') + '.')
  }

  // ── Auswahl ─────────────────────────────────────────────────
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allVisibleSelected = visible.length > 0 && visible.every((t) => selected.has(t.id))
  const selectedList = visible.filter((t) => selected.has(t.id))
  const confirmable = visible.filter((t) => isAssigned(t) && ['auto', 'manual'].includes(t.status))

  const p = tx.progress
  const pct = p.relevant ? p.confirmed / p.relevant : 0

  return (
    <div className="flex flex-col gap-5">
      {/* Monatsabschluss */}
      <Card
        title={`Kontrolle ${monthLabel(month)}`}
        subtitle={p.total ? `${p.confirmed} von ${p.relevant} bestätigt · ${p.open} offen · ${p.auto} automatisch · ${p.manual} manuell · ${p.ignored} ignoriert` : 'Noch keine Buchungen in diesem Monat'}
        actions={
          <>
            {closed ? (
              <Button variant="ghost" onClick={() => tx.setMonthClosed(month, false)} title="Monat wieder öffnen">{Icon.lock} Abgeschlossen</Button>
            ) : (
              <Button
                variant="ghost"
                disabled={!p.total}
                onClick={() => (p.open + p.auto + p.manual === 0 || confirm(`Es sind noch ${p.open + p.auto + p.manual} Buchungen nicht bestätigt. Monat trotzdem abschliessen?`)) && tx.setMonthClosed(month, true)}
              >
                {Icon.check} Monat abschliessen
              </Button>
            )}
          </>
        }
      >
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-good transition-all" style={{ width: `${pct * 100}%` }} />
        </div>
        <div className="mt-1.5 text-[12px] text-ink-3">{fmtPct(pct)} kontrolliert{closed && ' · Monat abgeschlossen – Änderungen nur nach Rückfrage'}</div>
      </Card>

      {msg && <div className="rounded-xl bg-accent-soft px-4 py-2.5 text-[13px] text-ink-2">{msg}</div>}

      <div className="flex items-center gap-1 border-b border-line">
        {[['list', 'Buchungen'], ['open', `Offene Zahlungen (${(data.openPayments || []).length})`], ['recurring', `Wiederkehrend (${(data.recurring || []).length})`], ['rules', `Regeln (${data.rules.length})`]].map(([v, l]) => (
          <button key={v} onClick={() => { if (v === tab || !confirmLeave()) return; setShowManual(false); setShowOpenForm(false); setConvert(null); setTab(v) }} className={`-mb-px border-b-2 px-3 py-2 text-[14px] ${tab === v ? 'border-accent font-medium text-accent' : 'border-transparent text-ink-2 hover:text-ink'}`}>{l}</button>
        ))}
      </div>

      {/* Einheitliche Knopfzeile unter den Tabs: Hauptaktion (blau) zuerst, weitere Aktionen daneben */}
      <div className="flex flex-wrap items-center gap-2">
        {tab === 'list' && (
          <>
            <Button variant="primary" onClick={() => setShowManual((v) => !v)}>{Icon.plus} Buchung erfassen</Button>
            <Button onClick={startImport}>{Icon.upload} CSV importieren</Button>
          </>
        )}
        {tab === 'open' && (
          <Button variant="primary" onClick={() => { setConvert(null); setShowOpenForm((v) => !v) }}>{Icon.plus} Offene Zahlung vormerken</Button>
        )}
        {tab === 'recurring' && (
          <Button variant="primary" onClick={() => setShowManual((v) => !v)}>{Icon.plus} Neue Wiederholung</Button>
        )}
        {tab === 'rules' && (
          <>
            <Button variant="primary" onClick={() => update((d) => { d.rules.push({ id: uid(), pattern: '', positionId: null }) })}>{Icon.plus} Regel</Button>
            <Button onClick={() => { const n = applyAllRules(data.rules); flash(n ? `${n} Buchungen neu zugeordnet.` : 'Keine Änderungen.') }}>Regeln anwenden</Button>
          </>
        )}
      </div>

      {tab === 'list' && imp && preview && (
        <Card
          title={`Import: ${imp.file}`}
          subtitle={`${imp.rows.length} Zeilen · ${preview.months.map((m) => monthLabel(m)).join(', ')}${imp.skipped ? ` · ${imp.skipped} storniert/abgelehnt (übersprungen)` : ''}${preview.beforeStart ? ` · ${preview.beforeStart} vor dem Start (${monthLabel(tx.startMonth)}) übersprungen` : ''}`}
          actions={
            <>
              <Button variant="ghost" onClick={closeImport}>Abbrechen</Button>
              <Button variant="primary" onClick={doImport} disabled={!preview.changes}>{preview.fresh.length || !preview.changes ? `${preview.fresh.length} Buchungen importieren` : `${preview.changes} Änderungen übernehmen`}</Button>
            </>
          }
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-ink-3">Konten zuordnen</div>
              {imp.products.map((prod) => (
                <div key={prod} className="flex items-center gap-3 border-b border-line py-1.5 text-[14px] last:border-b-0">
                  <span className="w-32 shrink-0 text-ink-2">«{prod}»</span>
                  <select
                    value={imp.mapping[prod]}
                    onChange={(e) => setImp({ ...imp, mapping: { ...imp.mapping, [prod]: e.target.value } })}
                    className="flex-1 rounded-md border border-line bg-surface px-2 py-1 outline-none focus:border-accent"
                  >
                    <option value="__new">+ Neues Konto «Revolut {prod}» anlegen</option>
                    {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              ))}
              <p className="mt-2 text-[12px] text-ink-3">Der letzte Kontostand pro Konto wird automatisch als Saldo übernommen.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[13px]">
              <Mini label="Neu" value={preview.fresh.length} />
              <Mini label="Bereits vorhanden" value={preview.duplicates} />
              {preview.deleted > 0 && <Mini label="Früher gelöscht (übersprungen)" value={preview.deleted} />}
              <Mini label="Automatisch zugeordnet" value={preview.auto} />
              <Mini label="Ignoriert (Umbuchungen)" value={preview.ignored} />
              <Mini label="Offen (zuordnen)" value={preview.open} />
              {preview.pendingNew > 0 && <Mini label="Davon neu ausstehend" value={preview.pendingNew} />}
              {preview.finalize.length > 0 && <Mini label="Ausstehende jetzt abgeschlossen" value={preview.finalize.length} />}
              {preview.refresh.length > 0 && <Mini label="Ausstehende mit neuem Betrag" value={preview.refresh.length} />}
              {preview.stale.length > 0 && <Mini label="Ausstehende storniert (werden entfernt)" value={preview.stale.length} />}
              {preview.closedHit.length > 0 && <Mini label="Abgeschlossene Monate (übersprungen)" value={preview.closedHit.map(monthLabel).join(', ')} />}
            </div>
          </div>
        </Card>
      )}

      {tab === 'open' && convert && (
        <EntryForm
          key={convert.id}
          data={data}
          update={update}
          tx={tx}
          month={month}
          initial={{ text: convert.text, amount: convert.amount, date: todayStr(), accountId: convert.accountId, positionId: convert.positionId, splits: convert.splits }}
          onCancel={() => setConvert(null)}
          onDone={(m) => {
            // Buchung gespeichert → offene Zahlung entfernen
            update((d) => { d.openPayments = (d.openPayments || []).filter((x) => x.id !== convert.id) })
            setConvert(null)
            flash(m)
          }}
        />
      )}

      {/* Formular «Buchung erfassen»: bei den Buchungen, und für neue wiederkehrende Buchungen auch im Tab «Wiederkehrend» */}
      {showManual && (tab === 'list' || tab === 'recurring') && <EntryForm key={tab} recurring={tab === 'recurring'} data={data} update={update} tx={tx} month={month} onCancel={() => setShowManual(false)} onDone={(m) => { setShowManual(false); flash(m) }} />}

      {tab === 'open' ? (
        <OpenPayments data={data} update={update} showForm={showOpenForm} onCloseForm={() => setShowOpenForm(false)} onConvert={(p) => { setShowOpenForm(false); setConvert(p); document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' }) }} />
      ) : tab === 'recurring' ? (
        <RecurringList data={data} update={update} tx={tx} />
      ) : tab === 'rules' ? (
        <RulesEditor data={data} update={update} tx={tx} />
      ) : (
        <>

          {pending.length > 0 && (
            <div ref={suggestionsRef} className="scroll-mt-4">
              <RuleSuggestions data={data} tx={tx} pending={pending} onCreate={createRules} onDiscard={discardSuggestions} onEdit={editSuggestion} />
            </div>
          )}

          {offsets.length > 0 && (
            <Card title="Mögliche Ausgleichsbuchungen" subtitle="Umbuchung mit gleichem Betrag kurz nach einer Ausgabe – z. B. aus dem falschen Konto bezahlt und wieder ausgeglichen">
              {offsets.map(({ transfer, expense }) => (
                <div key={transfer.id} className="flex flex-wrap items-center gap-2 border-b border-line py-2 text-[13px] last:border-b-0">
                  <span className="num">{fmtDate(expense.date)}</span>
                  <b>{expense.text}</b>
                  <span className="num text-ink-2">{fmtCHF(expense.amount)}</span>
                  <span className="text-ink-3">↔</span>
                  <span className="num">{fmtDate(transfer.date)}</span>
                  <span className="text-ink-2">{transfer.text}</span>
                  <span className="num text-good">+{fmtCHF(transfer.amount)}</span>
                  <Button className="ml-auto" onClick={() => link(expense, transfer)}>{Icon.link} Verknüpfen</Button>
                </div>
              ))}
            </Card>
          )}

          {/* Filter */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
              {[['month', monthLabel(month)], ['year', `Jahr ${month.slice(0, 4)}`]].map(([v, l]) => (
                <button key={v} onClick={() => setScope(v)} className={`rounded-md px-3 py-1 text-[13px] ${scope === v ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-surface-2'}`}>{l}</button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {FILTERS.map(([v, l]) => (
                <button key={v} onClick={() => setStatus(v)} className={`rounded-full border px-2.5 py-1 text-[12px] ${status === v ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line text-ink-2 hover:bg-surface-2'}`}>
                  {l} <span className="num text-ink-3">{counts[v] || 0}</span>
                </button>
              ))}
            </div>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1 text-[13px] outline-none">
              <option value="">Alle Konten</option>
              {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <div className="w-48"><PositionSelect data={data} value={positionId} onChange={(v) => setPositionId(v || '')} placeholder="Alle Positionen" className="rounded-lg border-line bg-surface text-[13px]" /></div>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Suchen …" className="ml-auto w-48 rounded-lg border border-line bg-surface px-3 py-1 text-[13px] outline-none focus:border-accent" />
          </div>

          {/* Massenaktionen */}
          <div className="flex min-h-9 flex-wrap items-center gap-2 text-[13px]">
            {selectedList.length > 0 ? (
              <>
                <span className="font-medium">{selectedList.length} ausgewählt</span>
                <Button variant="primary" onClick={() => { confirmTx(selectedList); setSelected(new Set()) }}>{Icon.check} Bestätigen</Button>
                <div className="w-56"><PositionSelect data={data} value="" allowIgnore placeholder="Position zuweisen …" onChange={(v) => { assignMany(selectedList, v); setSelected(new Set()) }} className="rounded-lg border-line bg-surface" /></div>
                <Button onClick={() => { setIgnored(selectedList, false); setSelected(new Set()) }}>Nicht mehr ignorieren</Button>
                <Button variant="danger" onClick={() => removeMany(selectedList)}>{Icon.trash} Löschen</Button>
                <Button variant="ghost" onClick={() => setSelected(new Set())}>Auswahl aufheben</Button>
              </>
            ) : (
              <>
                <span className="text-ink-3">{visible.length} Buchungen · Summe {fmtCHF(visible.filter((t) => t.status !== 'ignored').reduce((s, t) => s + t.amount, 0))}</span>
                {confirmable.length > 0 && (
                  <Button className="ml-auto" onClick={() => confirmTx(confirmable)}>{Icon.check} Alle {confirmable.length} sichtbaren zugeordneten bestätigen</Button>
                )}
              </>
            )}
          </div>

          <DirtyBar count={drafts.count} onSave={() => saveDrafts(drafts.ids)} onDiscard={drafts.discardAll} />

          <Card padded={false}>
            {visible.length === 0 ? (
              <div className="px-5 py-10 text-center text-[14px] text-ink-3">
                {tx.transactions.length === 0 ? 'Noch keine Buchungen. Importiere einen Kontoauszug (CSV) oder erfasse eine Buchung von Hand.' : 'Keine Buchungen für diesen Filter.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] font-medium uppercase tracking-wide text-ink-3">
                      <th className="w-10 py-2.5 pl-4"><input type="checkbox" checked={allVisibleSelected} onChange={() => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((t) => t.id)))} className="accent-[var(--accent)]" /></th>
                      <th className="w-24 px-2 font-medium">Datum</th>
                      <th className="px-2 font-medium">Text</th>
                      <th className="w-44 px-2 font-medium">Konto</th>
                      <th className="w-72 px-2 font-medium">Position</th>
                      <th className="w-32 whitespace-nowrap px-2 text-right font-medium">Betrag</th>
                      <th className="w-28 px-2 font-medium">Status</th>
                      <th className="w-52 pr-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((t) => {
                      const linked = t.linkedId && byId[t.linkedId]
                      const dirty = drafts.dirty(t.id)
                      const posValue = drafts.val(t.id, 'positionId', t.positionId)
                      const locked = t.status === 'confirmed' // bestätigt → nur anzeigen
                      return (
                        <Fragment key={t.id}>
                        <tr
                          onKeyDown={drafts.rowKeys(t.id, () => saveDrafts([t.id]))}
                          className={`group border-b border-line last:border-b-0 ${dirty ? dirtyRowCls : selected.has(t.id) ? 'bg-accent-soft/50' : 'hover:bg-surface-2/60'} ${t.status === 'ignored' ? 'text-ink-3' : ''}`}
                        >
                          <td className="py-1.5 pl-4"><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} className="accent-[var(--accent)]" /></td>
                          <td className="num px-2" title={t.bookedDate && t.bookedDate !== t.date ? `verbucht ${fmtDate(t.bookedDate)}` : undefined}>{fmtDate(t.date)}</td>
                          <td className="px-2">
                            <div className="flex items-center gap-1.5">
                              {locked ? (
                                <span className="truncate">{t.text}</span>
                              ) : (
                                <Changed on={drafts.has(t.id, 'text')} className="min-w-0 flex-1">
                                  <TextInput value={drafts.val(t.id, 'text', t.text)} onChange={(v) => drafts.set(t.id, 'text', v, t.text)} className="-ml-2" />
                                </Changed>
                              )}
                              {linked && <span className="text-accent" title={`Ausgleich: ${linked.text} (${fmtCHF(linked.amount)}, ${fmtDate(linked.date)})`}>{Icon.link}</span>}
                            </div>
                            <div className="text-[11px] text-ink-3">{[t.kind, t.source === 'manual' && 'manuell erfasst', t.source === 'correction' && 'Saldo-Korrektur'].filter(Boolean).join(' · ')}</div>
                          </td>
                          <td className="truncate px-1 text-ink-2">
                            {t.source === 'csv' || locked ? (
                              <span className="px-1" title={locked ? 'Bestätigt' : 'Aus dem Kontoauszug – Konto ist fest'}>{accountName(t.accountId)}</span>
                            ) : (
                              <Changed on={drafts.has(t.id, 'accountId')}>
                                <select
                                  value={drafts.val(t.id, 'accountId', t.accountId || '') || ''}
                                  onChange={(e) => drafts.set(t.id, 'accountId', e.target.value, t.accountId)}
                                  className="w-full truncate rounded-md border border-transparent bg-transparent px-1 py-1 outline-none hover:border-line focus:border-accent"
                                  title="Konto ändern"
                                >
                                  <option value="">– ohne Konto –</option>
                                  {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                                </select>
                              </Changed>
                            )}
                          </td>
                          <td className="px-1">
                            {t.status === 'ignored' ? (
                              <span className="px-1 text-ink-3">–</span>
                            ) : locked && !isSplit(t) ? (
                              <span className="block truncate px-1">{positionName(data, t.positionId) || '–'}</span>
                            ) : isSplit(t) ? (
                              <button
                                className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left hover:bg-surface-2"
                                title={t.splits.map((x) => `${positionName(data, x.positionId) || '–'}: ${fmtCHF(x.amount)}`).join('\n')}
                                onClick={() => setSplitId(splitId === t.id ? null : t.id)}
                                disabled={t.status === 'confirmed'}
                              >
                                {Icon.split}<span className="truncate">Aufgeteilt auf {t.splits.length} Positionen</span>
                              </button>
                            ) : (
                              <Changed on={drafts.has(t.id, 'positionId')}>
                                <PositionSelect data={data} month={monthOf(t.date)} value={posValue} onChange={(v) => drafts.set(t.id, 'positionId', v, t.positionId)} allowIgnore disabled={t.status === 'confirmed'} />
                              </Changed>
                            )}
                          </td>
                          <td className={`num whitespace-nowrap px-2 text-right font-medium ${t.amount > 0 ? 'text-good' : ''}`}>
                            {locked || t.source === 'csv' ? (
                              <span title={t.source === 'csv' && !locked ? 'Aus dem Kontoauszug – Betrag ist fest' : undefined}>{fmtCHF(t.amount)}</span>
                            ) : (
                              <Changed on={drafts.has(t.id, 'amount')}>
                                <AmountInput
                                  value={(Math.sign(t.amount) || -1) * drafts.val(t.id, 'amount', Math.abs(t.amount))}
                                  onChange={(v) => Math.abs(v) > 0 && drafts.set(t.id, 'amount', Math.abs(v), Math.abs(t.amount))}
                                  className="font-medium"
                                  title="Betrag ändern – das Vorzeichen bleibt"
                                />
                              </Changed>
                            )}
                          </td>
                          <td className="px-2">
                            <div className="flex flex-wrap items-center gap-1">
                              <Badge tone={STATUS[t.status]?.tone}>{t.status === 'confirmed' && Icon.check}{STATUS[t.status]?.label}</Badge>
                              {t.pending && <Badge tone="warn" title="Noch nicht abgeschlossen – zählt im Budget, aber noch nicht im Kontostand. Wird beim nächsten Import ersetzt.">ausstehend</Badge>}
                            </div>
                          </td>
                          <td className="pr-4">
                            {dirty ? (
                              <RowSave onSave={() => saveDrafts([t.id])} onDiscard={() => drafts.discard(t.id)} />
                            ) : (
                            <div className="flex justify-end opacity-60 transition group-hover:opacity-100">
                              <IconButton title={t.status === 'confirmed' ? 'Bestätigt – zuerst die Bestätigung aufheben' : 'Bearbeiten'} disabled={t.status === 'confirmed'} className="disabled:opacity-30" onClick={() => setEditId(t.id)}>{Icon.pencil}</IconButton>
                              {t.status === 'confirmed' ? (
                                <IconButton title="Bestätigung aufheben" onClick={() => unconfirm(t)}>{Icon.lock}</IconButton>
                              ) : t.status !== 'ignored' ? (
                                <IconButton title={isAssigned(t) ? 'Bestätigen' : 'Zuerst eine Position wählen'} disabled={!isAssigned(t)} className="hover:text-good disabled:opacity-30" onClick={() => confirmTx([t])}>{Icon.check}</IconButton>
                              ) : null}
                              {t.status !== 'ignored' && t.status !== 'confirmed' && (
                                <IconButton title="Auf mehrere Positionen aufteilen" className={splitId === t.id ? 'text-accent' : ''} onClick={() => setSplitId(splitId === t.id ? null : t.id)}>{Icon.split}</IconButton>
                              )}
                              <IconButton title={t.status === 'ignored' ? 'Nicht mehr ignorieren' : 'Ignorieren (keine Ausgabe)'} onClick={() => setIgnored([t], t.status !== 'ignored')}>{Icon.eyeOff}</IconButton>
                              {linked && <IconButton title="Verknüpfung lösen" onClick={() => unlink(t)}>{Icon.link}</IconButton>}
                              <IconButton title="Löschen" className="hover:text-bad" onClick={() => removeMany([t])}>{Icon.trash}</IconButton>
                            </div>
                            )}
                          </td>
                        </tr>
                        {splitId === t.id && (
                          <tr className="border-b border-line bg-surface-2/60">
                            <td colSpan={8} className="px-4 py-3">
                              <SplitEditor data={data} t={t} onSave={(splits) => saveSplit(t, splits)} onCancel={() => setSplitId(null)} />
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {editId && byId[editId] && (
        <TxEditDialog
          data={data}
          tx={tx}
          t={byId[editId]}
          partner={byId[editId].linkedId ? byId[byId[editId].linkedId] : null}
          queueSuggestions={queueSuggestions}
          onSaved={flash}
          onOpenRecurring={() => { setEditId(null); if (confirmLeave()) setTab('recurring') }}
          onClose={() => setEditId(null)}
        />
      )}

      {/* Hinweis unten: offene Regelvorschläge – immer sichtbar */}
      {pending.length > 0 && tab === 'list' && (
        <>
          <div className="h-16" />
          <BottomBar>
            <span className="text-ink-2">
              <b className="text-ink">{pending.length} Regelvorschl{pending.length > 1 ? 'äge' : 'ag'}</b> warten auf deine Entscheidung
            </span>
            <Button variant="primary" onClick={() => suggestionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Ansehen</Button>
          </BottomBar>
        </>
      )}
    </div>
  )
}

/**
 * Liste der Regelvorschläge aus manuellen Zuordnungen.
 * Jeder Vorschlag muss bewusst erstellt oder verworfen werden.
 */
function RuleSuggestions({ data, tx, pending, onCreate, onDiscard, onEdit }) {
  const info = (s) => {
    const rule = { pattern: s.pattern }
    const matching = tx.transactions.filter((t) => t.status !== 'ignored' && ruleMatches(rule, t.text))
    return {
      // offene/automatische Buchungen, die die Regel zusätzlich zuordnen würde
      more: matching.filter((t) => ['open', 'auto'].includes(t.status) && t.positionId !== s.positionId).length,
      // manuell anders zugeordnete Buchungen mit gleichem Text → Regel evtl. ungeeignet
      conflicts: matching.filter((t) => ['manual', 'confirmed'].includes(t.status) && t.positionId && t.positionId !== s.positionId).length,
    }
  }
  return (
    <Card
      title={`Regelvorschläge (${pending.length})`}
      subtitle="Aus deinen Zuordnungen. Entscheide pro Händler, ob künftig automatisch zugeordnet werden soll – das Muster kannst du vorher kürzen (z. B. «Migros» statt «Migros Take Away»)."
      actions={
        <>
          <Button variant="ghost" onClick={() => confirm(`Alle ${pending.length} Vorschläge verwerfen?`) && onDiscard(pending)}>Alle verwerfen</Button>
          <Button variant="primary" onClick={() => onCreate(pending)}>Alle {pending.length} erstellen</Button>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] gap-2 border-b border-line pb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">
        <div className="px-2">Text enthält</div><div className="px-1">Position</div><div className="px-2">Wirkung</div><div />
      </div>
      {pending.map((s) => {
        const { more, conflicts } = info(s)
        return (
          <div key={s.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-2 border-b border-line py-1 text-[13px] last:border-b-0">
            <div>
              <input
                defaultValue={s.pattern}
                key={s.pattern}
                onBlur={(e) => e.target.value.trim() && e.target.value !== s.pattern && onEdit(s.id, (x) => { x.pattern = e.target.value.trim() })}
                onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                className="w-full rounded-md border border-line bg-surface px-2 py-1 outline-none focus:border-accent"
              />
              {s.sample && s.sample !== s.pattern && <div className="truncate px-2 text-[11px] text-ink-3">z. B. «{s.sample}»</div>}
            </div>
            <PositionSelect data={data} value={s.positionId} onChange={(v) => v && onEdit(s.id, (x) => { x.positionId = v })} />
            <div className="px-2 text-[12px]">
              <span className="text-ink-2">{s.hits > 1 ? `${s.hits}× so zugeordnet` : '1× so zugeordnet'}</span>
              {more > 0 && <span className="text-ink-2"> · ordnet {more} weitere zu</span>}
              {conflicts > 0 && <div className="text-warn">{Icon.warn} {conflicts} gleiche Buchung{conflicts > 1 ? 'en' : ''} anders zugeordnet</div>}
            </div>
            <div className="flex gap-1.5">
              <Button variant="ghost" onClick={() => onDiscard([s])}>Verwerfen</Button>
              <Button onClick={() => onCreate([s])}>{Icon.check} Erstellen</Button>
            </div>
          </div>
        )
      })}
    </Card>
  )
}

/** Fixierte Leiste am unteren Rand – immer sichtbar, auch beim Scrollen. */
function BottomBar({ children, onClose }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-[960px] flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3 text-[13px] shadow-[0_8px_30px_rgba(0,0,0,0.18)]">
        {children}
        {onClose && <IconButton title="Schliessen" onClick={onClose}>×</IconButton>}
      </div>
    </div>
  )
}


const Mini = ({ label, value }) => (
  <div className="rounded-lg bg-surface-2 px-3 py-2">
    <div className="text-[11px] text-ink-3">{label}</div>
    <div className="num text-[16px] font-semibold">{value}</div>
  </div>
)

/** Regeln: Textmuster → Position oder ignorieren. Reihenfolge = Priorität. */
function RulesEditor({ data, update, tx }) {
  const set = (i, fn) => update((d) => fn(d.rules[i]))
  const move = (i, dir) => update((d) => { const j = i + dir; if (j >= 0 && j < d.rules.length) [d.rules[i], d.rules[j]] = [d.rules[j], d.rules[i]] })
  const matches = (r) => tx.transactions.filter((t) => ruleMatches(r, t.text)).length
  return (
    <Card
      title="Zuordnungsregeln"
      subtitle="Die erste passende Regel gewinnt. Gross-/Kleinschreibung egal; /…/ für reguläre Ausdrücke. Manuell bearbeitete und bestätigte Buchungen werden nie verändert."
    >
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_70px_84px] gap-2 border-b border-line pb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">
        <div className="px-2">Text enthält</div><div className="px-1">Zuordnung</div><div className="px-2">Notiz</div><div className="text-right">Treffer</div><div />
      </div>
      {data.rules.map((r, i) => (
        <div key={r.id} className="group grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_70px_84px] items-center gap-2 border-b border-line py-0.5 text-[13px] last:border-b-0">
          <input defaultValue={r.pattern} key={r.pattern} onBlur={(e) => e.target.value !== r.pattern && set(i, (x) => { x.pattern = e.target.value })} placeholder="z. B. Supermarkt" className="rounded-md border border-transparent bg-transparent px-2 py-1 outline-none hover:border-line focus:border-accent" />
          <PositionSelect data={data} allowIgnore value={r.action === 'ignore' ? '__ignore' : r.positionId} onChange={(v) => set(i, (x) => { if (v === '__ignore') { x.action = 'ignore'; x.positionId = null } else { delete x.action; x.positionId = v } })} />
          <input defaultValue={r.note || ''} key={`n${r.note}`} onBlur={(e) => set(i, (x) => { x.note = e.target.value })} className="rounded-md border border-transparent bg-transparent px-2 py-1 text-ink-2 outline-none hover:border-line focus:border-accent" />
          <div className="num text-right text-ink-3">{matches(r)}</div>
          <div className="flex justify-end opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
            <IconButton title="Höhere Priorität" onClick={() => move(i, -1)}>{Icon.up}</IconButton>
            <IconButton title="Tiefere Priorität" onClick={() => move(i, 1)}>{Icon.down}</IconButton>
            <IconButton title="Löschen" className="hover:text-bad" onClick={() => update((d) => { d.rules.splice(i, 1) })}>{Icon.trash}</IconButton>
          </div>
        </div>
      ))}
    </Card>
  )
}
