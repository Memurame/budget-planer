import { useState } from 'react'
import { Card, Button, IconButton, AmountInput, TextInput, Icon, Changed, DirtyBar, RowSave, dirtyRowCls } from './ui.jsx'
import { OpenPaymentEditDialog } from './EditDialogs.jsx'
import { useDrafts } from '../lib/useDrafts.js'
import SplitEditor from './SplitEditor.jsx'
import PositionSelect, { positionName } from './PositionSelect.jsx'
import { fmtCHF, fmtDate } from '../lib/format.js'
import { uid } from '../lib/calc.js'
import { todayStr } from '../lib/recurring.js'
import { openPaymentGroups } from '../lib/openPayments.js'

const field = 'h-8 rounded-md border border-line bg-surface px-2 text-[13px] outline-none focus:border-accent'
const wrap = 'h-8 overflow-hidden rounded-md border border-line bg-surface focus-within:border-accent'
const inner = 'h-full rounded-none border-0 text-[13px]'
const label = 'mb-1 text-[12px] text-ink-3'

/**
 * Offene Zahlungen: vorgemerkte Ausgaben, die noch keine Buchungen sind.
 * Sie zählen nirgends mit, bis sie als Buchung erfasst werden («Als Buchung erfassen»)
 * oder ohne Buchung erledigt sind («Erledigt», z. B. wenn die Zahlung per Kontoauszug kommt).
 */
export default function OpenPayments({ data, update, onConvert, showForm, onCloseForm }) {
  const today = todayStr()
  const list = data.openPayments || []
  const empty = { text: '', amount: 0, dueDate: today, accountId: '', positionId: null, note: '' }
  const [draft, setDraft] = useState(empty)
  const [splitId, setSplitId] = useState(null) // offene Zahlung, deren Aufteilung gerade bearbeitet wird
  // Aufteilung und Betrag passen nicht mehr zusammen (z. B. Betrag nachträglich geändert)
  const splitMismatch = (p) => !!p.splits?.length && Math.abs(p.splits.reduce((s, x) => s + Math.abs(x.amount), 0) - p.amount) >= 0.005
  const [editId, setEditId] = useState(null)
  const drafts = useDrafts() // vorgemerkte Änderungen in der Liste (Fälligkeit, Text, Position, Betrag)
  const setD = (k, v) => setDraft((x) => ({ ...x, [k]: v }))
  const canAdd = draft.text.trim() && draft.amount > 0 && draft.dueDate

  const add = () => {
    if (!canAdd) return
    update((d) => {
      d.openPayments = [...(d.openPayments || []), { id: uid(), ...draft, text: draft.text.trim(), amount: Math.abs(draft.amount), accountId: draft.accountId || null }]
    })
    setDraft(empty)
    onCloseForm()
  }
  const set = (id, fn) => update((d) => { const p = d.openPayments.find((x) => x.id === id); if (p) fn(p) })
  /** Vorgemerkte Änderungen übernehmen. */
  const saveDrafts = (ids) => {
    const all = drafts.current()
    update((d) => {
      for (const id of ids) {
        const p = all[id]
        const x = (d.openPayments || []).find((o) => o.id === id)
        if (!p || !x) continue
        if (p.dueDate) x.dueDate = p.dueDate
        if ('text' in p && p.text.trim()) x.text = p.text.trim()
        if ('amount' in p) x.amount = Math.abs(p.amount)
        if ('positionId' in p) x.positionId = p.positionId
      }
    })
    for (const id of ids) drafts.take(id)
  }
  const done = (p) => update((d) => { d.openPayments = d.openPayments.filter((x) => x.id !== p.id) })

  const { groups, total } = openPaymentGroups(list, today)
  const accountName = (id) => data.accounts.find((a) => a.id === id)?.name

  return (
    <div className="flex flex-col gap-5">
      {showForm && (
      <Card title="Offene Zahlung vormerken" subtitle="Noch keine Buchung – zählt nirgends mit, bis du sie als Buchung erfasst oder als erledigt markierst">
        <form onSubmit={(e) => { e.preventDefault(); add() }} className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <div className={label}>Text</div>
            <input value={draft.text} onChange={(e) => setD('text', e.target.value)} placeholder="z. B. Rechnung Zahnarzt" className={`w-full ${field}`} />
          </div>
          <div>
            <div className={label}>Betrag</div>
            <div className={`w-32 ${wrap}`}><AmountInput value={draft.amount} onChange={(v) => setD('amount', Math.abs(v))} className={inner} /></div>
          </div>
          <div>
            <div className={label}>Fällig am</div>
            <input type="date" value={draft.dueDate} onChange={(e) => setD('dueDate', e.target.value)} className={`num ${field}`} />
          </div>
          <div>
            <div className={label}>Konto (optional)</div>
            <select value={draft.accountId} onChange={(e) => setD('accountId', e.target.value)} className={field}>
              <option value="">–</option>
              {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="w-56">
            <div className={label}>Position (optional)</div>
            <div className={`${wrap} flex items-center`}><PositionSelect data={data} month={draft.dueDate?.slice(0, 7)} value={draft.positionId} onChange={(v) => setD('positionId', v)} className="text-[13px]" /></div>
          </div>
          <div className="min-w-48 flex-1">
            <div className={label}>Notiz (optional)</div>
            <input value={draft.note} onChange={(e) => setD('note', e.target.value)} className={`w-full ${field}`} />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={() => { setDraft(empty); onCloseForm() }}>Abbrechen</Button>
            <Button type="submit" variant="primary" disabled={!canAdd}>{Icon.check} Vormerken</Button>
          </div>
        </form>
      </Card>
      )}

      <DirtyBar count={drafts.count} onSave={() => saveDrafts(drafts.ids)} onDiscard={drafts.discardAll} />

      <Card
        padded={false}
        title="Offene Zahlungen"
        subtitle={list.length ? `${list.length} offen · nach Fälligkeit sortiert` : 'Keine offenen Zahlungen'}
        actions={list.length ? <span className="num text-[15px] font-semibold">Total {fmtCHF(total)}</span> : null}
      >
        {groups.map((g) => (
          <div key={g.key}>
            <div className={`border-y border-line bg-surface-2/60 px-5 py-1.5 text-[12px] font-medium uppercase tracking-wide ${g.key === 'overdue' ? 'text-bad' : 'text-ink-3'}`}>
              {g.label} <span className="normal-case tracking-normal">· {fmtCHF(g.total)}</span>
            </div>
            {g.items.map((p) => (
              <div key={p.id} className="border-b border-line last:border-b-0">
              <div
                onKeyDown={drafts.rowKeys(p.id, () => saveDrafts([p.id]))}
                className={`group grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-3 px-5 py-2 text-[13px] md:grid-cols-[110px_minmax(0,1.2fr)_minmax(200px,1fr)_140px_360px] ${drafts.dirty(p.id) ? dirtyRowCls : ''}`}
              >
                <Changed on={drafts.has(p.id, 'dueDate')}>
                  <input
                    type="date"
                    value={drafts.val(p.id, 'dueDate', p.dueDate)}
                    onChange={(e) => e.target.value && drafts.set(p.id, 'dueDate', e.target.value, p.dueDate)}
                    className={`num w-full rounded-md border border-transparent bg-transparent px-1 py-1 outline-none hover:border-line focus:border-accent ${g.key === 'overdue' ? 'text-bad' : ''}`}
                    title="Fälligkeit ändern"
                  />
                </Changed>
                <div className="min-w-0">
                  <Changed on={drafts.has(p.id, 'text')}>
                    <TextInput value={drafts.val(p.id, 'text', p.text)} onChange={(v) => drafts.set(p.id, 'text', v, p.text)} className="-ml-2 text-[14px]" />
                  </Changed>
                  <div className="truncate text-[12px] text-ink-3">
                    {[accountName(p.accountId), p.note].filter(Boolean).join(' · ') || ' '}
                  </div>
                </div>
                <div className="hidden min-w-0 md:block">
                  {p.splits?.length ? (
                    <button
                      className="flex w-full items-center gap-1.5 truncate rounded-md px-1 py-1 text-left text-ink-2 hover:bg-surface-2"
                      title={p.splits.map((x) => `${positionName(data, x.positionId) || '–'}: ${fmtCHF(Math.abs(x.amount))}`).join('\n')}
                      onClick={() => setSplitId(splitId === p.id ? null : p.id)}
                    >
                      {Icon.split}<span className="truncate">Aufgeteilt auf {p.splits.length} Positionen</span>
                    </button>
                  ) : (
                    <Changed on={drafts.has(p.id, 'positionId')}>
                      <PositionSelect data={data} month={drafts.val(p.id, 'dueDate', p.dueDate)?.slice(0, 7)} value={drafts.val(p.id, 'positionId', p.positionId)} onChange={(v) => drafts.set(p.id, 'positionId', v, p.positionId)} placeholder="ohne Position" className="text-ink-2" />
                    </Changed>
                  )}
                  {splitMismatch(p) && <div className="text-[11px] text-warn">Aufteilung passt nicht zum Betrag</div>}
                </div>
                <Changed on={drafts.has(p.id, 'amount')} className="hidden md:block"><AmountInput value={drafts.val(p.id, 'amount', p.amount)} onChange={(v) => drafts.set(p.id, 'amount', Math.abs(v), p.amount)} className="font-medium" /></Changed>
                {drafts.dirty(p.id) ? (
                  <RowSave onSave={() => saveDrafts([p.id])} onDiscard={() => drafts.discard(p.id)} />
                ) : (
                <div className="flex items-center justify-end gap-1">
                  <IconButton title="Bearbeiten" onClick={() => setEditId(p.id)}>{Icon.pencil}</IconButton>
                  <IconButton title="Auf mehrere Positionen aufteilen" className={splitId === p.id ? 'text-accent' : ''} onClick={() => setSplitId(splitId === p.id ? null : p.id)}>{Icon.split}</IconButton>
                  <Button onClick={() => onConvert(p)} title="Öffnet das Buchungsformular, vorausgefüllt">{Icon.receipt} Als Buchung erfassen</Button>
                  <Button variant="ghost" onClick={() => done(p)} title="Ohne Buchung entfernen – z. B. wenn die Zahlung per Kontoauszug (CSV) kommt">{Icon.check} Erledigt</Button>
                </div>
                )}
              </div>
              {splitId === p.id && (
                <div className="border-t border-line bg-surface-2/40 px-5 py-3">
                  <SplitEditor
                    key={`${p.id}-${p.amount}`}
                    data={data}
                    t={{ text: p.text, amount: -Math.abs(p.amount), date: p.dueDate, positionId: p.positionId, splits: p.splits }}
                    onCancel={() => setSplitId(null)}
                    onSave={(splits) => {
                      set(p.id, (x) => {
                        if (splits) { x.splits = splits; x.positionId = null } else delete x.splits
                      })
                      setSplitId(null)
                    }}
                  />
                </div>
              )}
              </div>
            ))}
          </div>
        ))}
        {editId && list.some((x) => x.id === editId) && (
          <OpenPaymentEditDialog data={data} p={list.find((x) => x.id === editId)} update={update} onClose={() => setEditId(null)} />
        )}
        {list.length === 0 && <p className="px-5 pb-5 text-[13px] text-ink-3">Merke dir hier Zahlungen vor, die du nicht vergessen willst – z. B. Rechnungen, die noch bezahlt werden müssen.</p>}
      </Card>
    </div>
  )
}
