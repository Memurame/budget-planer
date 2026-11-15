import { Card, Badge, Button, IconButton, Icon, askDelete } from './ui.jsx'
import PositionSelect from './PositionSelect.jsx'
import { fmtCHF, fmtDate } from '../lib/format.js'
import { amountAt, monthKey, setAmountAt } from '../lib/calc.js'
import { RECURRING_INTERVALS, nextOccurrence, todayStr } from '../lib/recurring.js'
import { AmountInput } from './ui.jsx'

const KIND_LABEL = { expense: 'Ausgabe', credit: 'Gutschrift', transfer: 'Umbuchung' }

/**
 * Vorlagen für wiederkehrende Buchungen. Änderungen gelten für künftige Termine –
 * bereits erzeugte Buchungen bleiben unverändert.
 */
export default function RecurringList({ data, update, tx, onAdd }) {
  const list = data.recurring || []
  const today = todayStr()
  const set = (id, fn) => update((d) => { const t = (d.recurring || []).find((x) => x.id === id); if (t) fn(t) })
  const accountName = (id) => data.accounts.find((a) => a.id === id)?.name || '–'
  const sel = 'h-8 w-full rounded-md border border-transparent bg-transparent px-1 text-[13px] outline-none hover:border-line focus:border-accent'

  return (
    <Card
      title="Wiederkehrende Buchungen"
      subtitle="Werden an jedem Termin automatisch als Buchung erzeugt (bis heute). Änderungen gelten ab dem nächsten Termin; bereits erzeugte Buchungen bleiben unverändert."
      actions={<Button variant="primary" className="whitespace-nowrap" onClick={onAdd}>{Icon.plus} Neue Wiederholung</Button>}
      padded={false}
    >
      {list.length === 0 ? (
        <div className="px-5 pb-6 text-[14px] text-ink-3">
          Noch keine wiederkehrenden Buchungen. Unter «Buchung erfassen» bei <b>Wiederholen</b> monatlich, vierteljährlich oder jährlich wählen.
        </div>
      ) : (
        <div className="overflow-x-auto px-5 pb-4">
          <table className="w-full min-w-[980px] table-fixed text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] font-medium uppercase tracking-wide text-ink-3">
                <th className="px-2 pb-2 font-medium">Text</th>
                <th className="w-36 px-2 pb-2 font-medium">Konto</th>
                <th className="w-44 px-2 pb-2 font-medium">Position</th>
                <th className="w-28 px-2 pb-2 text-right font-medium">Betrag</th>
                <th className="w-32 px-2 pb-2 font-medium">Intervall</th>
                <th className="w-28 px-2 pb-2 font-medium">Nächste</th>
                <th className="w-36 px-2 pb-2 font-medium">Bis</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {list.map((t) => {
                const next = t.paused ? null : nextOccurrence(t, today)
                const nextKey = next ? next.slice(0, 7) : monthKey()
                const generated = tx.transactions.filter((x) => x.recurringId === t.id && (t.kind !== 'transfer' || x.amount < 0)).length
                return (
                  <tr key={t.id} className={`group border-b border-line last:border-b-0 ${t.paused ? 'text-ink-3' : ''}`}>
                    <td className="px-2 py-1.5">
                      <input
                        defaultValue={t.text}
                        key={t.text}
                        onBlur={(e) => e.target.value.trim() && e.target.value !== t.text && set(t.id, (x) => { x.text = e.target.value.trim() })}
                        className="w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 outline-none hover:border-line focus:border-accent"
                      />
                      <div className="flex items-center gap-1.5 px-1 text-[11px] text-ink-3">
                        <Badge tone={t.kind === 'credit' ? 'good' : t.kind === 'transfer' ? 'neutral' : 'accent'}>{KIND_LABEL[t.kind]}</Badge>
                        <span>Tag {t.day} · {generated} erzeugt</span>
                        {t.paused && <Badge tone="warn">pausiert</Badge>}
                      </div>
                    </td>
                    <td className="px-1">
                      <select value={t.accountId || ''} onChange={(e) => set(t.id, (x) => { x.accountId = e.target.value })} className={sel}>
                        {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                      {t.kind === 'transfer' && (
                        <select value={t.toAccountId || ''} onChange={(e) => set(t.id, (x) => { x.toAccountId = e.target.value })} className={sel} title="Nach Konto">
                          {data.accounts.map((a) => <option key={a.id} value={a.id}>→ {a.name}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-1">
                      {t.kind === 'transfer' ? <span className="px-1 text-ink-3">–</span> : <PositionSelect data={data} value={t.positionId} onChange={(v) => set(t.id, (x) => { x.positionId = v })} />}
                    </td>
                    <td className="px-1" title={`Gilt ab ${nextKey}`}>
                      <AmountInput value={amountAt(t, nextKey)} onChange={(v) => set(t.id, (x) => setAmountAt(x, nextKey, Math.abs(v)))} />
                    </td>
                    <td className="px-1">
                      <select value={t.interval} onChange={(e) => set(t.id, (x) => { x.interval = Number(e.target.value) })} className={sel}>
                        {RECURRING_INTERVALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td className="num px-2">{next ? fmtDate(next) : '–'}</td>
                    <td className="px-1">
                      <input
                        type="month"
                        value={t.endMonth || ''}
                        min={t.startMonth}
                        onChange={(e) => set(t.id, (x) => { if (e.target.value) x.endMonth = e.target.value; else delete x.endMonth })}
                        className={`${sel} num`}
                      />
                    </td>
                    <td className="pr-1">
                      <div className="flex justify-end opacity-60 transition group-hover:opacity-100">
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
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
