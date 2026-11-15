import { useMemo, useState } from 'react'
import { Card, Button, IconButton, Badge, Icon, AmountInput } from './ui.jsx'
import PositionSelect, { positionName } from './PositionSelect.jsx'
import { fmtCHF, fmtDate, fmtPct } from '../lib/format.js'
import { monthLabel, uid } from '../lib/calc.js'
import { openCsv } from '../lib/storage.js'
import { STATUS, applyRules, findRule, monthOf, parseRevolut, ruleMatches, suggestOffsets, suggestPattern, yearOf } from '../lib/tx.js'

const FILTERS = [
  ['all', 'Alle'],
  ['open', 'Offen'],
  ['auto', 'Automatisch'],
  ['manual', 'Manuell'],
  ['confirmed', 'Bestätigt'],
  ['ignored', 'Ignoriert'],
]

export default function Transactions({ data, update, month, tx }) {
  const [tab, setTab] = useState('list')
  const [status, setStatus] = useState('all')
  const [scope, setScope] = useState('month')
  const [accountId, setAccountId] = useState('')
  const [positionId, setPositionId] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [imp, setImp] = useState(null)
  const [ruleHint, setRuleHint] = useState(null)
  const [lastRule, setLastRule] = useState(null) // zuletzt automatisch erstellte Regel (für Bearbeiten/Rückgängig)
  const [autoRule, setAutoRuleState] = useState(() => localStorage.getItem('autoRule') !== 'off')
  const setAutoRule = (v) => { setAutoRuleState(v); localStorage.setItem('autoRule', v ? 'on' : 'off'); setRuleHint(null) }
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
        (!positionId || t.positionId === positionId) &&
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
  const assign = (t, pid) => {
    if (!guard([t])) return
    if (pid === '__ignore') return setIgnored([t], true)
    tx.updateTx(t.id, (x) => { x.positionId = pid; x.status = pid ? 'manual' : 'open'; x.ruleId = null; x.override = true })
    if (pid) {
      const pattern = suggestPattern(t.text)
      const existing = findRule(data.rules, t.text)
      if (pattern && !(existing && existing.positionId === pid)) {
        if (autoRule) addRule(pattern, pid, t.text, t.id)
        else {
          const similar = tx.transactions.filter((x) => x.id !== t.id && ['open', 'auto'].includes(x.status) && ruleMatches({ pattern }, x.text)).length
          setRuleHint({ pattern, positionId: pid, similar, text: t.text })
        }
      }
    }
  }

  /**
   * Neue Regel speichern und sofort anwenden. Trifft bereits eine andere Regel auf diesen Text zu,
   * bekommt die neue Regel Vorrang (wird davor eingefügt) – die manuelle Korrektur soll gelten.
   */
  const addRule = (pattern, positionId, text, skipId = null) => {
    const rule = { id: uid(), pattern: pattern.trim(), positionId }
    const conflict = text ? data.rules.findIndex((r) => ruleMatches(r, text)) : -1
    const rules = [...data.rules]
    rules.splice(conflict >= 0 ? conflict : rules.length, 0, rule)
    update((d) => { d.rules = rules })
    const count = applyAllRules(rules, skipId)
    setLastRule({ ...rule, count, editing: false, draft: rule.pattern })
    setRuleHint(null)
  }

  /** Muster der zuletzt erstellten Regel ändern und neu anwenden. */
  const changeLastRule = (pattern) => {
    const rules = data.rules.map((r) => (r.id === lastRule.id ? { ...r, pattern: pattern.trim() } : r))
    update((d) => { d.rules = rules })
    const count = applyAllRules(rules)
    setLastRule({ ...lastRule, pattern: pattern.trim(), draft: pattern.trim(), count, editing: false })
  }

  /** Zuletzt erstellte Regel entfernen; von ihr zugeordnete (nicht bestätigte) Buchungen werden wieder offen. */
  const undoLastRule = () => {
    const rules = data.rules.filter((r) => r.id !== lastRule.id)
    update((d) => { d.rules = rules })
    applyAllRules(rules)
    setLastRule(null)
    flash('Regel entfernt.')
  }
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
    const ok = list.filter((t) => t.positionId && t.status !== 'confirmed' && t.status !== 'ignored')
    if (!ok.length || !guard(ok)) return
    tx.updateTx(ok.map((t) => t.id), (x) => { x.status = 'confirmed' })
    flash(`${ok.length} Buchung${ok.length > 1 ? 'en' : ''} bestätigt.`)
  }
  const unconfirm = (t) => guard([t]) && tx.updateTx(t.id, (x) => { x.status = 'manual' })
  const assignMany = (list, pid) => {
    if (!pid || !guard(list)) return
    if (pid === '__ignore') return setIgnored(list, true)
    tx.updateTx(list.map((t) => t.id), (x) => { x.positionId = pid; x.status = 'manual'; x.ruleId = null; x.override = true })
  }
  const applyAllRules = (rules = data.rules, skipId = null) => {
    // Anzahl vorab auf dem aktuellen Stand zählen (die Zustandsänderung selbst läuft verzögert)
    const changed = tx.transactions.filter((t) => t.id !== skipId && !tx.isClosed(monthOf(t.date)) && applyRules({ ...t }, rules)).length
    tx.updateYears((d) => {
      for (const y of Object.keys(d)) for (const t of d[y].transactions) if (!tx.isClosed(monthOf(t.date))) applyRules(t, rules)
    })
    return changed
  }
  const createRule = () => addRule(ruleHint.pattern, ruleHint.positionId, ruleHint.text)
  const link = (a, b) => {
    tx.updateTx([a.id, b.id], (x) => { x.linkedId = x.id === a.id ? b.id : a.id })
  }
  const unlink = (t) => tx.updateTx([t.id, t.linkedId].filter(Boolean), (x) => { delete x.linkedId })

  // ── Import ──────────────────────────────────────────────────
  const startImport = async () => {
    const file = await openCsv()
    if (!file) return
    const res = parseRevolut(file.content)
    if (res.error) return alert(res.error)
    await tx.ensureYears([...res.rows.map((r) => yearOf(r.date)), ...Object.values(res.balances).map((b) => yearOf(b.date))])
    const mapping = {}
    for (const p of res.products) mapping[p] = data.importMappings[`revolut:${p}`] || (data.accounts.find((a) => a.name.toLowerCase().includes(p.toLowerCase()))?.id ?? '__new')
    setImp({ file: file.name, ...res, mapping })
  }

  const preview = useMemo(() => {
    if (!imp) return null
    const existing = new Set(tx.transactions.map((t) => t.id))
    const fresh = imp.rows.filter((r) => !existing.has(r.id))
    let ignored = 0, auto = 0
    for (const r of fresh) {
      const rule = findRule(data.rules, r.text)
      if (rule?.action === 'ignore') ignored++
      else if (rule) auto++
    }
    const months = [...new Set(imp.rows.map((r) => monthOf(r.date)))].sort()
    const closedHit = months.filter((m) => tx.isClosed(m))
    return { fresh, duplicates: imp.rows.length - fresh.length, ignored, auto, open: fresh.length - ignored - auto, months, closedHit }
  }, [imp, tx.transactions, data.rules])

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
        applyRules(t, data.rules)
        return t
      })
    tx.addTx(rows)
    for (const [p, b] of Object.entries(imp.balances)) {
      if (ids[p]) tx.addBalance({ id: uid(), accountId: ids[p], date: b.date, at: b.at, amount: b.amount, source: 'csv' })
    }
    setImp(null)
    flash(`${rows.length} neue Buchungen importiert${preview.duplicates ? `, ${preview.duplicates} bereits vorhanden` : ''}.`)
  }

  // ── Auswahl ─────────────────────────────────────────────────
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allVisibleSelected = visible.length > 0 && visible.every((t) => selected.has(t.id))
  const selectedList = visible.filter((t) => selected.has(t.id))
  const confirmable = visible.filter((t) => t.positionId && ['auto', 'manual'].includes(t.status))

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
            <Button onClick={startImport}>{Icon.upload} CSV importieren</Button>
            <Button onClick={() => setShowManual((v) => !v)}>{Icon.plus} Buchung erfassen</Button>
            {closed ? (
              <Button onClick={() => tx.setMonthClosed(month, false)} title="Monat wieder öffnen">{Icon.lock} Abgeschlossen</Button>
            ) : (
              <Button
                variant="primary"
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

      {imp && preview && (
        <Card
          title={`Import: ${imp.file}`}
          subtitle={`${imp.rows.length} Zeilen · ${preview.months.map((m) => monthLabel(m)).join(', ')}${imp.skipped ? ` · ${imp.skipped} nicht abgeschlossene übersprungen` : ''}`}
          actions={
            <>
              <Button variant="ghost" onClick={() => setImp(null)}>Abbrechen</Button>
              <Button variant="primary" onClick={doImport} disabled={!preview.fresh.length}>{preview.fresh.length} Buchungen importieren</Button>
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
              <Mini label="Automatisch zugeordnet" value={preview.auto} />
              <Mini label="Ignoriert (Umbuchungen)" value={preview.ignored} />
              <Mini label="Offen (zuordnen)" value={preview.open} />
              {preview.closedHit.length > 0 && <Mini label="Abgeschlossene Monate (übersprungen)" value={preview.closedHit.map(monthLabel).join(', ')} />}
            </div>
          </div>
        </Card>
      )}

      {showManual && <ManualEntry data={data} tx={tx} month={month} onDone={(m) => { setShowManual(false); flash(m) }} />}

      <div className="flex items-center gap-1 border-b border-line">
        {[['list', 'Buchungen'], ['rules', `Regeln (${data.rules.length})`]].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)} className={`-mb-px border-b-2 px-3 py-2 text-[14px] ${tab === v ? 'border-accent font-medium text-accent' : 'border-transparent text-ink-2 hover:text-ink'}`}>{l}</button>
        ))}
      </div>

      {tab === 'rules' ? (
        <RulesEditor data={data} update={update} tx={tx} onApply={(rules) => { const n = applyAllRules(rules); flash(n ? `${n} Buchungen neu zugeordnet.` : 'Keine Änderungen.') }} />
      ) : (
        <>

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
                <Button variant="ghost" onClick={() => setSelected(new Set())}>Auswahl aufheben</Button>
              </>
            ) : (
              <>
                <label className="flex cursor-pointer items-center gap-1.5 text-ink-2" title="Beim Wählen einer Position wird sofort eine Regel erstellt und auf alle offenen Buchungen angewendet">
                  <input type="checkbox" checked={autoRule} onChange={(e) => setAutoRule(e.target.checked)} className="accent-[var(--accent)]" />
                  Beim Zuordnen gleich Regel erstellen
                </label>
                <span className="text-ink-3">·</span>
                <span className="text-ink-3">{visible.length} Buchungen · Summe {fmtCHF(visible.filter((t) => t.status !== 'ignored').reduce((s, t) => s + t.amount, 0))}</span>
                {confirmable.length > 0 && (
                  <Button className="ml-auto" onClick={() => confirmTx(confirmable)}>{Icon.check} Alle {confirmable.length} sichtbaren zugeordneten bestätigen</Button>
                )}
              </>
            )}
          </div>

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
                      <th className="w-36 px-2 font-medium">Konto</th>
                      <th className="w-56 px-2 font-medium">Position</th>
                      <th className="w-28 px-2 text-right font-medium">Betrag</th>
                      <th className="w-28 px-2 font-medium">Status</th>
                      <th className="w-24 pr-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((t) => {
                      const linked = t.linkedId && byId[t.linkedId]
                      return (
                        <tr key={t.id} className={`group border-b border-line last:border-b-0 ${selected.has(t.id) ? 'bg-accent-soft/50' : 'hover:bg-surface-2/60'} ${t.status === 'ignored' ? 'text-ink-3' : ''}`}>
                          <td className="py-1.5 pl-4"><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} className="accent-[var(--accent)]" /></td>
                          <td className="num px-2" title={t.bookedDate && t.bookedDate !== t.date ? `verbucht ${fmtDate(t.bookedDate)}` : undefined}>{fmtDate(t.date)}</td>
                          <td className="px-2">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate">{t.text}</span>
                              {linked && <span className="text-accent" title={`Ausgleich: ${linked.text} (${fmtCHF(linked.amount)}, ${fmtDate(linked.date)})`}>{Icon.link}</span>}
                            </div>
                            <div className="text-[11px] text-ink-3">{[t.kind, t.source === 'manual' && 'manuell erfasst', t.source === 'correction' && 'Saldo-Korrektur'].filter(Boolean).join(' · ')}</div>
                          </td>
                          <td className="truncate px-2 text-ink-2">{accountName(t.accountId)}</td>
                          <td className="px-1">
                            {t.status === 'ignored' ? (
                              <span className="px-1 text-ink-3">–</span>
                            ) : (
                              <PositionSelect data={data} value={t.positionId} onChange={(v) => assign(t, v)} allowIgnore disabled={t.status === 'confirmed'} />
                            )}
                          </td>
                          <td className={`num px-2 text-right font-medium ${t.amount > 0 ? 'text-good' : ''}`}>{fmtCHF(t.amount)}</td>
                          <td className="px-2">
                            <Badge tone={STATUS[t.status]?.tone}>{t.status === 'confirmed' && Icon.check}{STATUS[t.status]?.label}</Badge>
                          </td>
                          <td className="pr-4">
                            <div className="flex justify-end opacity-60 transition group-hover:opacity-100">
                              {t.status === 'confirmed' ? (
                                <IconButton title="Bestätigung aufheben" onClick={() => unconfirm(t)}>{Icon.lock}</IconButton>
                              ) : t.status !== 'ignored' ? (
                                <IconButton title={t.positionId ? 'Bestätigen' : 'Zuerst eine Position wählen'} disabled={!t.positionId} className="hover:text-good disabled:opacity-30" onClick={() => confirmTx([t])}>{Icon.check}</IconButton>
                              ) : null}
                              <IconButton title={t.status === 'ignored' ? 'Nicht mehr ignorieren' : 'Ignorieren (keine Ausgabe)'} onClick={() => setIgnored([t], t.status !== 'ignored')}>{Icon.eyeOff}</IconButton>
                              {linked && <IconButton title="Verknüpfung lösen" onClick={() => unlink(t)}>{Icon.link}</IconButton>}
                              {t.source !== 'csv' && <IconButton title="Löschen" className="hover:text-bad" onClick={() => guard([t]) && confirm('Buchung löschen?') && tx.removeTx(t.id)}>{Icon.trash}</IconButton>}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {(lastRule || ruleHint) && <div className="h-16" />}

      {/* Regel wurde automatisch erstellt → bearbeiten oder rückgängig */}
      {lastRule && !ruleHint && (
        <BottomBar onClose={() => setLastRule(null)}>
          <span className="text-good">{Icon.check}</span>
          {lastRule.editing ? (
            <>
              <span className="text-ink-2">Texte mit</span>
              <input
                autoFocus
                value={lastRule.draft}
                onChange={(e) => setLastRule({ ...lastRule, draft: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && lastRule.draft.trim() && changeLastRule(lastRule.draft)}
                className="w-48 rounded-md border border-line bg-surface px-2 py-1 outline-none focus:border-accent"
              />
              <span className="text-ink-2">→ <b className="text-ink">{positionName(data, lastRule.positionId)}</b></span>
              <Button variant="primary" onClick={() => changeLastRule(lastRule.draft)} disabled={!lastRule.draft.trim()}>Übernehmen</Button>
            </>
          ) : (
            <>
              <span className="text-ink-2">
                Regel <b className="text-ink">«{lastRule.pattern}»</b> → <b className="text-ink">{positionName(data, lastRule.positionId)}</b> erstellt
                {lastRule.count > 0 ? `, ${lastRule.count} weitere zugeordnet` : ''}
              </span>
              <Button variant="ghost" onClick={() => setLastRule({ ...lastRule, editing: true })}>Muster bearbeiten</Button>
              <Button variant="ghost" onClick={undoLastRule}>Rückgängig</Button>
            </>
          )}
        </BottomBar>
      )}

      {/* Automatik aus → nachfragen */}
      {ruleHint && (
        <BottomBar onClose={() => setRuleHint(null)}>
          <span className="text-ink-2">Künftig immer so zuordnen? Texte mit</span>
          <input value={ruleHint.pattern} onChange={(e) => setRuleHint({ ...ruleHint, pattern: e.target.value })} className="w-48 rounded-md border border-line bg-surface px-2 py-1 outline-none focus:border-accent" />
          <span className="text-ink-2">→ <b className="text-ink">{positionName(data, ruleHint.positionId)}</b>{ruleHint.similar > 0 && ` (betrifft ${ruleHint.similar} weitere)`}</span>
          <Button variant="ghost" onClick={() => setRuleHint(null)}>Nein</Button>
          <Button variant="primary" onClick={createRule} disabled={!ruleHint.pattern.trim()}>Regel erstellen</Button>
        </BottomBar>
      )}
    </div>
  )
}

/** Fixierte Leiste am unteren Rand – immer sichtbar, auch beim Scrollen. */
function BottomBar({ children, onClose }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-[960px] flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3 text-[13px] shadow-[0_8px_30px_rgba(0,0,0,0.18)]">
        {children}
        <IconButton title="Schliessen" onClick={onClose}>×</IconButton>
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

/** Manuelle Buchung erfassen (z. B. Zahlungen vom Lohnkonto). */
function ManualEntry({ data, tx, month, onDone }) {
  const today = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState({ date: today.startsWith(month) ? today : `${month}-01`, text: '', amount: 0, sign: -1, accountId: data.accounts[0]?.id || '', positionId: null })
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const save = async () => {
    if (!f.text.trim() || !f.amount) return
    if (tx.isClosed(monthOf(f.date)) && !confirm(`${monthLabel(monthOf(f.date))} ist abgeschlossen. Trotzdem erfassen?`)) return
    await tx.ensureYears([yearOf(f.date)])
    tx.addTx({
      id: `man-${uid()}`,
      accountId: f.accountId || null,
      date: f.date,
      bookedDate: f.date,
      text: f.text.trim(),
      amount: f.sign * Math.abs(f.amount),
      source: 'manual',
      status: f.positionId ? 'manual' : 'open',
      positionId: f.positionId,
      override: true,
    })
    onDone(`Buchung «${f.text.trim()}» erfasst.`)
  }
  const input = 'rounded-lg border border-line bg-surface px-2 py-1.5 text-[14px] outline-none focus:border-accent'
  return (
    <Card title="Buchung erfassen" subtitle="Für Zahlungen ohne Kontoauszug, z. B. direkt vom Lohnkonto">
      <div className="grid items-end gap-3 md:grid-cols-[140px_1fr_150px_150px_1fr_auto]">
        <label className="text-[12px] text-ink-3">Datum<input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} className={`${input} num mt-1 w-full`} /></label>
        <label className="text-[12px] text-ink-3">Text<input value={f.text} onChange={(e) => set('text', e.target.value)} placeholder="z. B. Versicherung" className={`${input} mt-1 w-full`} /></label>
        <label className="text-[12px] text-ink-3">Betrag
          <div className="mt-1 flex items-center gap-1">
            <select value={f.sign} onChange={(e) => set('sign', Number(e.target.value))} className={`${input} px-1`}>
              <option value={-1}>−</option>
              <option value={1}>+</option>
            </select>
            <div className={`${input} flex-1 p-0`}><AmountInput value={f.amount} onChange={(v) => set('amount', v)} /></div>
          </div>
        </label>
        <label className="text-[12px] text-ink-3">Konto
          <select value={f.accountId} onChange={(e) => set('accountId', e.target.value)} className={`${input} mt-1 w-full`}>
            <option value="">– ohne Konto –</option>
            {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="text-[12px] text-ink-3">Position
          <div className={`${input} mt-1 p-0.5`}><PositionSelect data={data} value={f.positionId} onChange={(v) => set('positionId', v)} /></div>
        </label>
        <Button variant="primary" onClick={save} disabled={!f.text.trim() || !f.amount}>Speichern</Button>
      </div>
    </Card>
  )
}

/** Regeln: Textmuster → Position oder ignorieren. Reihenfolge = Priorität. */
function RulesEditor({ data, update, tx, onApply }) {
  const set = (i, fn) => update((d) => fn(d.rules[i]))
  const move = (i, dir) => update((d) => { const j = i + dir; if (j >= 0 && j < d.rules.length) [d.rules[i], d.rules[j]] = [d.rules[j], d.rules[i]] })
  const matches = (r) => tx.transactions.filter((t) => ruleMatches(r, t.text)).length
  return (
    <Card
      title="Zuordnungsregeln"
      subtitle="Die erste passende Regel gewinnt. Gross-/Kleinschreibung egal; /…/ für reguläre Ausdrücke. Manuell bearbeitete und bestätigte Buchungen werden nie verändert."
      actions={
        <>
          <Button onClick={() => onApply(data.rules)}>Regeln anwenden</Button>
          <Button variant="primary" onClick={() => update((d) => { d.rules.push({ id: uid(), pattern: '', positionId: null }) })}>{Icon.plus} Regel</Button>
        </>
      }
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
