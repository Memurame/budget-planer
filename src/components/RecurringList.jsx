import { Fragment, useState } from 'react'
import { Card, Badge, IconButton, Icon, askDelete, AmountInput, Changed, DirtyBar, RowSave, dirtyRowCls } from './ui.jsx'
import PositionSelect, { positionName } from './PositionSelect.jsx'
import SplitEditor from './SplitEditor.jsx'
import { RecurringEditDialog } from './EditDialogs.jsx'
import { fmtCHF, fmtDate } from '../lib/format.js'
import { amountAt, monthKey, setAmountAt } from '../lib/calc.js'
import { RECURRING_INTERVALS, nextOccurrence, scaleSplits, todayStr } from '../lib/recurring.js'
import { useDrafts } from '../lib/useDrafts.js'

const KIND_LABEL = { expense: 'Ausgabe', credit: 'Gutschrift', transfer: 'Umbuchung' }

/**
 * Vorlagen für wiederkehrende Buchungen. Änderungen gelten für künftige Termine –
 * bereits erzeugte Buchungen bleiben unverändert. Änderungen in der Liste werden vorgemerkt
 * und erst mit «Speichern» übernommen; alle Felder gibt es im Bearbeiten-Fenster.
 */
export default function RecurringList({ data, update, tx }) {
  const list = data.recurring || []
  const today = todayStr()
  const set = (id, fn) => update((d) => { const t = (d.recurring || []).find((x) => x.id === id); if (t) fn(t) })
  const [splitId, setSplitId] = useState(null)
  const [editId, setEditId] = useState(null)
  const drafts = useDrafts()
  const posName = (id) => positionName(data, id) || '–'
  const sel = 'h-8 w-full rounded-md border border-transparent bg-transparent px-1 text-[13px] outline-none hover:border-line focus:border-accent'
  const nextKeyOf = (t) => { const n = t.paused ? null : nextOccurrence(t, today); return n ? n.slice(0, 7) : monthKey() }

  /** Vorgemerkte Änderungen übernehmen. Der Betrag gilt ab dem nächsten Termin. */
  const save = (ids) => {
    const all = drafts.current()
    update((d) => {
      for (const id of ids) {
        const p = all[id]
        const x = (d.recurring || []).find((r) => r.id === id)
        if (!p || !x) continue
        if ('text' in p && p.text.trim()) x.text = p.text.trim()
        if ('accountId' in p) x.accountId = p.accountId
        if ('toAccountId' in p) x.toAccountId = p.toAccountId
        if ('positionId' in p) x.positionId = p.positionId
        if ('interval' in p) x.interval = Number(p.interval)
        if ('endMonth' in p) { if (p.endMonth) x.endMonth = p.endMonth; else delete x.endMonth }
        if ('amount' in p) {
          setAmountAt(x, nextKeyOf(x), Math.abs(p.amount))
          if (x.splits?.length) x.splits = scaleSplits(x.splits, Math.abs(p.amount))
        }
      }
    })
    for (const id of ids) drafts.take(id)
  }

  const editing = editId && list.find((t) => t.id === editId)

  return (
    <div className="flex flex-col gap-3">
      <DirtyBar count={drafts.count} onSave={() => save(drafts.ids)} onDiscard={drafts.discardAll} />
      <Card
        title="Wiederkehrende Buchungen"
        subtitle="Werden an jedem Termin automatisch als Buchung erzeugt (bis heute). Änderungen gelten ab dem nächsten Termin; bereits erzeugte Buchungen bleiben unverändert."
        padded={false}
      >
        {list.length === 0 ? (
          <div className="px-5 pb-6 text-[14px] text-ink-3">
            Noch keine wiederkehrenden Buchungen. Unter «Buchung erfassen» bei <b>Wiederholen</b> monatlich, vierteljährlich oder jährlich wählen.
          </div>
        ) : (
          <div className="overflow-x-auto px-5 pb-4">
            <table className="w-full min-w-[1340px] table-fixed text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-medium uppercase tracking-wide text-ink-3">
                  <th className="px-2 pb-2 font-medium">Text</th>
                  <th className="w-44 px-2 pb-2 font-medium">Konto</th>
                  <th className="w-60 px-2 pb-2 font-medium">Position</th>
                  <th className="w-28 px-2 pb-2 text-right font-medium">Betrag</th>
                  <th className="w-32 px-2 pb-2 font-medium">Intervall</th>
                  <th className="w-28 px-2 pb-2 font-medium">Nächste</th>
                  <th className="w-36 px-2 pb-2 font-medium">Bis</th>
                  <th className="w-56" />
                </tr>
              </thead>
              <tbody>
                {list.map((t) => {
                  const next = t.paused ? null : nextOccurrence(t, today)
                  const nextKey = nextKeyOf(t)
                  const generated = tx.allTransactions.filter((x) => x.recurringId === t.id && (t.kind !== 'transfer' || x.amount < 0)).length
                  const dirty = drafts.dirty(t.id)
                  const v = (k, base) => drafts.val(t.id, k, base)
                  const ch = (k, value, base) => drafts.set(t.id, k, value, base)
                  return (
                    <Fragment key={t.id}>
                    <tr onKeyDown={drafts.rowKeys(t.id, () => save([t.id]))} className={`group border-b border-line last:border-b-0 ${dirty ? dirtyRowCls : ''} ${t.paused ? 'text-ink-3' : ''}`}>
                      <td className="px-2 py-1.5">
                        <Changed on={drafts.has(t.id, 'text')}>
                          <input
                            value={v('text', t.text)}
                            onChange={(e) => ch('text', e.target.value, t.text)}
                            className="w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 outline-none hover:border-line focus:border-accent"
                          />
                        </Changed>
                        <div className="flex items-center gap-1.5 px-1 text-[11px] text-ink-3">
                          <Badge tone={t.kind === 'credit' ? 'good' : t.kind === 'transfer' ? 'neutral' : 'accent'}>{KIND_LABEL[t.kind]}</Badge>
                          <span>Tag {t.day} · {generated} erzeugt</span>
                          {t.paused && <Badge tone="warn">pausiert</Badge>}
                        </div>
                      </td>
                      <td className="px-1">
                        <Changed on={drafts.has(t.id, 'accountId')}>
                          <select value={v('accountId', t.accountId || '') || ''} onChange={(e) => ch('accountId', e.target.value, t.accountId)} className={sel}>
                            {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </Changed>
                        {t.kind === 'transfer' && (
                          <Changed on={drafts.has(t.id, 'toAccountId')}>
                            <select value={v('toAccountId', t.toAccountId || '') || ''} onChange={(e) => ch('toAccountId', e.target.value, t.toAccountId)} className={sel} title="Nach Konto">
                              {data.accounts.map((a) => <option key={a.id} value={a.id}>→ {a.name}</option>)}
                            </select>
                          </Changed>
                        )}
                      </td>
                      <td className="px-1">
                        {t.kind === 'transfer' ? (
                          <span className="px-1 text-ink-3">–</span>
                        ) : t.splits?.length ? (
                          <button
                            type="button"
                            onClick={() => setSplitId(splitId === t.id ? null : t.id)}
                            className={`flex h-8 w-full items-center gap-1.5 rounded-md px-1 text-left hover:bg-surface-2 ${splitId === t.id ? 'text-accent' : ''}`}
                            title={t.splits.map((s) => `${posName(s.positionId)}: ${fmtCHF(s.amount)}`).join('\n')}
                          >
                            {Icon.split}<span className="truncate">Aufgeteilt auf {t.splits.length} Positionen</span>
                          </button>
                        ) : (
                          <Changed on={drafts.has(t.id, 'positionId')}>
                            <PositionSelect data={data} value={v('positionId', t.positionId)} onChange={(val) => ch('positionId', val, t.positionId)} />
                          </Changed>
                        )}
                      </td>
                      <td className="px-1" title={`Gilt ab ${nextKey}${t.splits?.length ? ' – Aufteilung wird anteilig angepasst' : ''}`}>
                        <Changed on={drafts.has(t.id, 'amount')}>
                          <AmountInput value={v('amount', amountAt(t, nextKey))} onChange={(val) => ch('amount', Math.abs(val), amountAt(t, nextKey))} />
                        </Changed>
                      </td>
                      <td className="px-1">
                        <Changed on={drafts.has(t.id, 'interval')}>
                          <select value={v('interval', t.interval)} onChange={(e) => ch('interval', Number(e.target.value), t.interval)} className={sel}>
                            {RECURRING_INTERVALS.map(([val, l]) => <option key={val} value={val}>{l}</option>)}
                          </select>
                        </Changed>
                      </td>
                      <td className="num px-2">{next ? fmtDate(next) : '–'}</td>
                      <td className="px-1">
                        <Changed on={drafts.has(t.id, 'endMonth')}>
                          <input
                            type="month"
                            value={v('endMonth', t.endMonth || '') || ''}
                            min={t.startMonth}
                            onChange={(e) => ch('endMonth', e.target.value, t.endMonth)}
                            className={`${sel} num`}
                          />
                        </Changed>
                      </td>
                      <td className="pr-1">
                        {dirty ? (
                          <RowSave onSave={() => save([t.id])} onDiscard={() => drafts.discard(t.id)} />
                        ) : (
                          <div className="flex justify-end opacity-60 transition group-hover:opacity-100">
                            <IconButton title="Bearbeiten" onClick={() => setEditId(t.id)}>{Icon.pencil}</IconButton>
                            {t.kind !== 'transfer' && (
                              <IconButton title="Auf mehrere Positionen aufteilen" className={splitId === t.id ? 'text-accent' : ''} onClick={() => setSplitId(splitId === t.id ? null : t.id)}>{Icon.split}</IconButton>
                            )}
                            <IconButton title={t.paused ? 'Fortsetzen' : 'Pausieren (keine neuen Buchungen)'} onClick={() => set(t.id, (x) => { if (x.paused) { delete x.paused; x.skipBefore = monthKey() } else x.paused = true })}>
                              {t.paused ? '▶' : '⏸'}
                            </IconButton>
                            <IconButton
                              title="Wiederholung löschen"
                              className="hover:text-bad"
                              onClick={async () => {
                                const ok = await askDelete({
                                  title: `Wiederholung «${t.text}» löschen?`,
                                  message: `Es werden keine neuen Buchungen mehr erzeugt. Die ${generated} bereits erzeugten Buchungen bleiben erhalten.`,
                                })
                                if (ok) update((d) => { d.recurring = d.recurring.filter((x) => x.id !== t.id) })
                              }}
                            >
                              {Icon.trash}
                            </IconButton>
                          </div>
                        )}
                      </td>
                    </tr>
                    {splitId === t.id && t.kind !== 'transfer' && (
                      <tr className="border-b border-line bg-surface-2/40">
                        <td colSpan={8} className="px-4 py-3">
                          <SplitEditor
                            data={data}
                            t={{ text: t.text, amount: (t.kind === 'credit' ? 1 : -1) * amountAt(t, nextKey), date: `${nextKey}-01`, positionId: t.positionId, splits: t.splits }}
                            onCancel={() => setSplitId(null)}
                            onSave={(splits) => {
                              set(t.id, (x) => {
                                if (splits) { x.splits = splits.map((s) => ({ positionId: s.positionId, amount: Math.abs(s.amount) })); x.positionId = null }
                                else delete x.splits
                              })
                              setSplitId(null)
                            }}
                          />
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
      {editing && <RecurringEditDialog data={data} tpl={editing} update={update} onClose={() => setEditId(null)} />}
    </div>
  )
}
