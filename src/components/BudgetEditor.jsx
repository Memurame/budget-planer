import { useState } from 'react'
import { Card, Button, IconButton, AmountInput, TextInput, Money, Icon } from './ui.jsx'
import { isBudgetMode, uid, isPeriodic, itemMonthly, itemMonthlyFlat, flatRate, simulateAnnual, makePeriodic, makeMonthly, amountAt, setAmountAt, changedIn, monthLabel, addMonths } from '../lib/calc.js'

/** Betragsfeld für monatsabhängige Werte. Ein Punkt zeigt an, dass der Betrag in diesem Monat geändert wurde. */
function MonthAmount({ item, month, onUpdate, className = '' }) {
  const before = changedIn(item, month)
  return (
    <div className={`relative flex items-center ${className}`}>
      {before !== null && (
        <button
          className="absolute -left-2 size-2 rounded-full bg-accent hover:ring-4 hover:ring-accent-soft"
          title={`Ab ${monthLabel(month)} geändert – ${monthLabel(addMonths(month, -1))}: ${fmtCHF(before)}. Klicken, um die Änderung zurückzunehmen.`}
          onClick={() => onUpdate((it) => { delete it.changes[month]; if (!Object.keys(it.changes).length) delete it.changes })}
        />
      )}
      <AmountInput value={amountAt(item, month)} onChange={(v) => onUpdate((it) => setAmountAt(it, month, v))} title={`Betrag ab ${monthLabel(month)}`} />
    </div>
  )
}
import { fmtCHF } from '../lib/format.js'

const move = (arr, i, d) => {
  const j = i + d
  if (j < 0 || j >= arr.length) return
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
}

export const BILLING = [
  [1, 'monatlich'],
  [3, 'vierteljährlich'],
  [6, 'halbjährlich'],
  [12, 'jährlich'],
  [24, 'alle 2 Jahre'],
]

const COLS = 'grid-cols-[minmax(0,1fr)_120px_112px_112px_128px_84px]'

/** Effektiv ausgegeben (aus Buchungen) im Vergleich zum Monatsbetrag. */
export function ActualCell({ actual, planned, periodic, hasTx }) {
  if (!hasTx) return <div className="px-2 text-right text-ink-3">–</div>
  const v = actual || 0
  if (periodic) {
    return <div className="num px-2 text-right text-ink-2" title="Zahlungen in diesem Monat (Rücklage wird separat unter Rücklagen verglichen)">{v ? fmtCHF(v) : '–'}</div>
  }
  const ratio = planned > 0 ? v / planned : v > 0 ? 2 : 0
  const tone = ratio > 1.0001 ? 'bg-bad' : ratio > 0.9 ? 'bg-warn' : 'bg-good'
  const diff = planned - v
  return (
    <div className="px-2" title={diff >= 0 ? `${fmtCHF(diff)} unter Budget` : `${fmtCHF(-diff)} über Budget`}>
      <div className={`num text-right ${ratio > 1.0001 ? 'text-bad' : ''}`}>{fmtCHF(v)}</div>
      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(1, ratio) * 100}%` }} />
      </div>
    </div>
  )
}

/** Tabelle der Gruppen-Positionen. Positionen können monatlich oder periodisch (z. B. jährlich) abgerechnet werden. */
function ItemTable({ items, onUpdate, month, actual = {}, hasTx, addLabel = 'Position hinzufügen' }) {
  const total = items.reduce((s, it) => s + itemMonthly(it, month), 0)
  const totalActual = items.reduce((s, it) => s + (actual[it.id] || 0), 0)
  const totalYear = items.reduce((s, it) => s + itemMonthlyFlat(it, month) * 12, 0)
  return (
    <div>
      <div className={`grid ${COLS} items-center gap-2 border-b border-line pb-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-3`}>
        <div className="px-2">Name</div>
        <div className="px-1">Abrechnung</div>
        <div className="px-2 text-right">Betrag</div>
        <div className="px-2 text-right">Pro Monat</div>
        <div className="px-2 text-right">Effektiv</div>
        <div />
      </div>
      {items.map((it, idx) => {
        const periodic = isPeriodic(it)
        const r = periodic ? simulateAnnual(it, month, 1)[0] : null
        const elevated = periodic && r.rate > flatRate(it) * 1.25 + 0.01
        return (
          <div key={it.id} className="group border-b border-line py-0.5 text-[14px]">
            <div className={`grid ${COLS} items-center gap-2`}>
              <TextInput value={it.name} onChange={(v) => onUpdate((list) => { list[idx].name = v })} />
              <select
                value={it.intervalMonths || 1}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  onUpdate((list) => (v === 1 ? makeMonthly(list[idx]) : makePeriodic(list[idx], v, month)))
                }}
                className={`w-full rounded-md border border-transparent bg-transparent px-1 py-1 outline-none hover:border-line focus:border-accent ${periodic ? 'text-accent' : 'text-ink-2'}`}
              >
                {BILLING.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {periodic ? (
                <AmountInput value={it.amount} onChange={(v) => onUpdate((list) => { list[idx].amount = v })} title="Betrag pro Abrechnung (gilt für alle Monate)" />
              ) : (
                <MonthAmount item={it} month={month} onUpdate={(fn) => onUpdate((list) => fn(list[idx]))} />
              )}
              <div className={`num px-2 text-right ${periodic ? (elevated ? 'text-warn' : '') : 'text-ink-3'}`} title={periodic ? `Rücklage diesen Monat (normal ${fmtCHF(flatRate(it))})` : undefined}>
                {fmtCHF(periodic ? r.rate : amountAt(it, month))}
              </div>
              <ActualCell actual={actual[it.id]} planned={periodic ? r.rate : amountAt(it, month)} periodic={periodic} hasTx={hasTx} />
              <div className="flex justify-end opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                <IconButton title="Nach oben" onClick={() => onUpdate((list) => move(list, idx, -1))}>{Icon.up}</IconButton>
                <IconButton title="Nach unten" onClick={() => onUpdate((list) => move(list, idx, 1))}>{Icon.down}</IconButton>
                <IconButton title="Löschen" className="hover:text-bad" onClick={() => onUpdate((list) => { list.splice(idx, 1) })}>{Icon.trash}</IconButton>
              </div>
            </div>
            {periodic && isBudgetMode(it) && (
              <div className="pb-1.5 pl-2 text-[12px] text-ink-3">Jahresbudget (laufende Ausgaben) – Stand und Ausgaben unter Rücklagen</div>
            )}
            {periodic && !isBudgetMode(it) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1.5 pl-2 text-[12px] text-ink-3">
                <span className="flex items-center gap-1">
                  fällig am
                  <input
                    type="date"
                    value={it.dueDate}
                    onChange={(e) => e.target.value && onUpdate((list) => { list[idx].dueDate = e.target.value; delete list[idx].placeholder })}
                    className="num rounded border border-transparent bg-transparent px-1 text-ink-2 outline-none hover:border-line focus:border-accent"
                  />
                  {it.placeholder && <span className="text-warn" title="Platzhalter – bitte echtes Datum eintragen">{Icon.warn}</span>}
                </span>
                <span>{r.estimated ? `vor Planungsbeginn (${monthLabel(it.savedAsOf)}) – gleichmässig gerechnet` : r.payout > 0 ? `wird diesen Monat bezahlt (${fmtCHF(r.payout)})` : `noch ${r.left} Mt. · angespart ${fmtCHF(r.saved - r.rate)}`}</span>
                {elevated && <span className="text-warn">erhöhte Rate (normal {fmtCHF(flatRate(it))})</span>}
              </div>
            )}
          </div>
        )
      })}
      <div className={`grid ${COLS} items-center gap-2 pt-2.5 text-[14px] font-semibold`}>
        <div className="col-span-3 flex items-center px-2">
          <Button variant="ghost" className="-ml-3 whitespace-nowrap font-normal" onClick={() => onUpdate((list) => { list.push({ id: uid(), name: "Neue Position", amount: 0 }) })}>
            {Icon.plus} {addLabel}
          </Button>
          <span className="num ml-auto whitespace-nowrap text-[12px] font-normal text-ink-3">{fmtCHF(totalYear)} / Jahr</span>
        </div>
        <div className="num px-2 text-right">{fmtCHF(total)}</div>
        <div className={`num px-2 text-right ${hasTx && totalActual > total ? 'text-bad' : ''}`}>{hasTx ? fmtCHF(totalActual) : '–'}</div>
        <div className="text-right text-[11px] font-normal text-ink-3">Summe</div>
      </div>
    </div>
  )
}

export default function BudgetEditor({ data, update, summary: s, month, setView, tx }) {
  const hasTx = tx.progress.total > 0
  const [newGroup, setNewGroup] = useState('')

  const addGroup = () => {
    const name = newGroup.trim() || 'Neue Gruppe'
    update((d) => { d.groups.push({ id: uid(), name, items: [] }) })
    setNewGroup('')
  }

  return (
    <div className="grid gap-5 2xl:grid-cols-[1fr_380px]">
      <div className="flex min-w-0 flex-col gap-5">
        <p className="flex items-center gap-2 rounded-xl bg-accent-soft px-4 py-2.5 text-[13px] text-ink-2">
          <span className="size-2 shrink-0 rounded-full bg-accent" />
          Beträge gelten ab {monthLabel(month)} und bleiben, bis du sie in einem späteren Monat änderst. Frühere Monate bleiben unverändert. Der Punkt markiert eine Änderung in diesem Monat.
        </p>
        {data.groups.map((g, gi) => (
          <Card
            key={g.id}
            title={
              <input
                defaultValue={g.name}
                key={g.name}
                onBlur={(e) => e.target.value !== g.name && update((d) => { d.groups[gi].name = e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                className="-ml-2 rounded-md border border-transparent bg-transparent px-2 py-0.5 text-[16px] font-semibold outline-none hover:border-line focus:border-accent"
              />
            }
            actions={
              <>
                <IconButton title="Gruppe nach oben" onClick={() => update((d) => move(d.groups, gi, -1))}>{Icon.up}</IconButton>
                <IconButton title="Gruppe nach unten" onClick={() => update((d) => move(d.groups, gi, 1))}>{Icon.down}</IconButton>
                <IconButton
                  title="Gruppe löschen"
                  className="hover:text-bad"
                  onClick={() => {
                    if (g.items.length === 0 || confirm(`Gruppe «${g.name}» mit ${g.items.length} Positionen löschen?`)) update((d) => { d.groups.splice(gi, 1) })
                  }}
                >
                  {Icon.trash}
                </IconButton>
              </>
            }
          >
            <ItemTable items={g.items} month={month} actual={tx.actual} hasTx={hasTx} onUpdate={(fn) => update((d) => fn(d.groups[gi].items))} />
          </Card>
        ))}

        <div className="flex items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-3">
          <input
            value={newGroup}
            onChange={(e) => setNewGroup(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addGroup()}
            placeholder="Name der neuen Gruppe, z. B. Mobilität"
            className="flex-1 bg-transparent px-1 text-[14px] outline-none placeholder:text-ink-3"
          />
          <Button onClick={addGroup}>{Icon.plus} Gruppe hinzufügen</Button>
        </div>

        <Card
          title="Jährliche Kosten"
          subtitle="Werden mit Fälligkeit unter Rücklagen verwaltet"
          actions={<Button onClick={() => setView('reserves')}>Zu den Rücklagen →</Button>}
        >
          <div className="flex items-baseline justify-between text-[14px]">
            <span className="text-ink-2">{data.annual.length} Positionen · Rücklage in diesem Monat</span>
            <Money v={s.annual} className="font-semibold" />
          </div>
        </Card>
      </div>

      <div className="order-first grid items-start gap-5 lg:grid-cols-3 2xl:order-none 2xl:flex 2xl:flex-col 2xl:items-stretch">
        <Card title="Einnahmen" subtitle="Monatlich">
          <CompactTable items={data.income} month={month} onUpdate={(fn) => update((d) => fn(d.income))} />
        </Card>
        <Card title="Sparen & Abzüge" subtitle="Nach dem Budget abgezogen · ☑ = zählt zur Sparquote">
          <CompactTable
            month={month}
            items={data.deductions}
            onUpdate={(fn) => update((d) => fn(d.deductions))}
            extra={(it, idx, onUpdate) => (
              <label className="grid size-7 shrink-0 cursor-pointer place-items-center" title="Zählt zur Sparquote">
                <input type="checkbox" checked={!!it.isSaving} onChange={(e) => onUpdate((l) => { l[idx].isSaving = e.target.checked })} className="cursor-pointer accent-[var(--accent)]" />
              </label>
            )}
          />
        </Card>
        <Card>
          <div className="space-y-1.5 pt-4 text-[14px] [&>div]:gap-4">
            <div className="flex justify-between"><span className="text-ink-2">Einnahmen</span><Money v={s.income} /></div>
            <div className="flex justify-between"><span className="text-ink-2">Budget</span><span className="num">– {fmtCHF(s.budget)}</span></div>
            <div className="flex justify-between"><span className="text-ink-2">Sparen & Abzüge</span><span className="num">– {fmtCHF(s.deductionsTotal)}</span></div>
            <div className="flex justify-between border-t border-line pt-2 font-semibold">
              <span>Ergebnis</span>
              <span className={`num ${s.result >= 0 ? 'text-good' : 'text-bad'}`}>{fmtCHF(s.result)}</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

function CompactTable({ items, onUpdate, extra, month }) {
  const total = items.reduce((s, i) => s + amountAt(i, month), 0)
  return (
    <div>
      {items.map((it, idx) => (
        <div key={it.id} className="group flex items-center gap-1 border-b border-line py-0.5 text-[14px]">
          <TextInput value={it.name} onChange={(v) => onUpdate((l) => { l[idx].name = v })} className="w-auto flex-1" />
          {extra?.(it, idx, onUpdate)}
          <MonthAmount item={it} month={month} onUpdate={(fn) => onUpdate((l) => fn(l[idx]))} className="w-28" />
          <IconButton title="Löschen" className="opacity-0 group-hover:opacity-100 hover:text-bad" onClick={() => onUpdate((l) => { l.splice(idx, 1) })}>{Icon.trash}</IconButton>
        </div>
      ))}
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" className="-ml-3 font-normal" onClick={() => onUpdate((l) => { l.push({ id: uid(), name: 'Neue Position', amount: 0 }) })}>{Icon.plus} Hinzufügen</Button>
        <span className="num pr-10 text-[14px] font-semibold">{fmtCHF(total)}</span>
      </div>
    </div>
  )
}
