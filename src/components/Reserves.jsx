import { useMemo } from 'react'
import { Bar } from 'react-chartjs-2'
import { Card, Button, IconButton, AmountInput, TextInput, Stat, Progress, Badge, Icon } from './ui.jsx'
import { fmtCHF, fmtCHF0, fmtDate } from '../lib/format.js'
import { actualByPositionRange } from '../lib/tx.js'
import { budgetPeriodStart, diffMonths, isBudgetMode, nextDueMonth } from '../lib/calc.js'
import { addMonths, annualForecast, flatRate, makeMonthly, monthLabel, onTrackSaved, removeRef, reserveItems, resolveRef, simulateAnnual, uid } from '../lib/calc.js'
import { baseOptions, barStyle, readColors } from '../lib/charts.js'
import { confirmAndDelete } from '../lib/deletion.js'

const INTERVALS = [
  [1, 'monatlich'],
  [3, 'vierteljährlich'],
  [6, 'halbjährlich'],
  [12, 'jährlich'],
  [24, 'alle 2 Jahre'],
  [36, 'alle 3 Jahre'],
]

export default function Reserves({ data, update, month, theme, tx }) {
  const from = addMonths(month, -11)
  const paidMap = useMemo(() => actualByPositionRange(tx.transactions, from, month), [tx.transactions, from, month])
  const rows = useMemo(
    () =>
      reserveItems(data).map(({ item, group, ref }) => {
        const r = simulateAnnual(item, month, 1)[0]
        const flat = flatRate(item)
        const planned = r.estimated ? null : r.saved - r.rate + r.payout
        if (!isBudgetMode(item)) return { item, group, ref, r, flat, startSaved: planned, elevated: r.rate > flat * 1.25 + 0.01 }
        // Jahresbudget: tatsächlicher Stand = angespart − Ausgaben seit Planungsbeginn
        const sum = (a, b) => (diffMonths(a, b) < 0 ? 0 : actualByPositionRange(tx.transactions, a, b)[item.id] || 0)
        const since = budgetPeriodStart(item, month) // bei «jedes Jahr neu»: ab Januar
        const spentBefore = sum(since, addMonths(month, -1))
        const spentNow = sum(month, month)
        const year = month.slice(0, 4)
        const spentYear = sum(`${year}-01`, `${year}-12`)
        const yearBudget = ((Number(item.amount) || 0) * 12) / Math.max(1, Number(item.intervalMonths) || 12)
        return {
          item, group, ref, r, flat, elevated: false, budget: true,
          startSaved: planned === null ? null : planned - spentBefore,
          balance: planned === null ? null : r.saved - spentBefore - spentNow,
          spentYear, yearBudget, year,
        }
      }),
    [data, month, tx.transactions],
  )
  const forecast = useMemo(() => annualForecast(data, month, 12), [data, month])

  const total = rows.reduce((s, x) => s + x.r.rate, 0)
  const totalFlat = rows.reduce((s, x) => s + x.flat, 0)
  const totalSaved = rows.reduce((s, x) => s + (x.startSaved || 0), 0) // Jahresbudget: tatsächlicher Stand
  const totalAmount = rows.reduce((s, x) => s + x.flat * 12, 0) // pro Jahr
  const nextPayout = forecast.find((f) => f.payout > 0)

  const set = (ref, fn) => update((d) => fn(resolveRef(d, ref)))
  const add = () =>
    update((d) => {
      d.annual.push({ id: uid(), name: 'Neue jährliche Ausgabe', amount: 0, dueDate: `${addMonths(month, 12)}-01`, intervalMonths: 12, saved: 0, savedAsOf: month })
    })
  const allOnTrack = () => {
    if (!confirm('Alle Positionen auf den Soll-Stand setzen (als ob bisher gleichmässig angespart wurde)?')) return
    update((d) => rows.forEach(({ ref }) => { const a = resolveRef(d, ref); a.saved = onTrackSaved(a, month); a.savedAsOf = month }))
  }

  const sums = (list) => ({
    rate: list.reduce((a, x) => a + x.r.rate, 0),
    saved: list.reduce((a, x) => a + (x.startSaved || 0), 0),
    amount: list.reduce((a, x) => a + x.flat * 12, 0),
  })

  /** Tabelle für eine Liste von Rücklage-Positionen (jährliche Kosten oder periodische Gruppen-Positionen). */
  const reserveTable = (list, { title, subtitle, actions, empty }) => {
    const t = sums(list)
    return (
        <Card
          title={title}
          subtitle={subtitle}
          actions={actions}
          padded={false}
        >
          <div className="overflow-x-auto px-5 pb-4">
            <table className="w-full min-w-[960px] table-fixed text-[14px]">
              <thead>
                <tr className="whitespace-nowrap border-b border-line text-left text-[12px] font-medium uppercase tracking-wide text-ink-3">
                  <th className="px-2 pb-2 font-medium">Name</th>
                  <th className="w-28 px-2 pb-2 text-right font-medium">Betrag</th>
                  <th className="w-28 px-2 pb-2 font-medium">Intervall</th>
                  <th className="w-40 px-2 pb-2 font-medium">Art / Fällig am</th>
                  <th className="w-28 px-2 pb-2 text-right font-medium" title="Stand am Anfang des gewählten Monats">Angespart</th>
                  <th className="w-32 px-2 pb-2 text-right font-medium">Rate / Monat</th>
                  <th className="w-40 px-2 pb-2 font-medium">Fortschritt</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {list.length === 0 && (
                  <tr><td colSpan={8} className="px-2 py-6 text-center text-ink-3">{empty}</td></tr>
                )}
                {list.map(({ item, group, ref, r, flat, startSaved, elevated, budget, balance, spentYear, yearBudget, year }, idx) => (
                  <tr key={item.id} className="group border-b border-line last:border-b-0">
                    <td className="min-w-48 py-1 pr-2">
                      <TextInput value={item.name} onChange={(v) => set(ref, (a) => { a.name = v })} />
                      {group && <div className="px-2 text-[11px] text-ink-3">aus Gruppe «{group}»</div>}
                      {!budget && <PaidHint item={item} paid={paidMap[item.id] || 0} startSaved={startSaved} month={month} onSet={(fn) => set(ref, fn)} />}
                    </td>
                    <td className="w-28 py-1">
                      <AmountInput value={item.amount} onChange={(v) => set(ref, (a) => { a.amount = v })} />
                    </td>
                    <td className="w-32 py-1 px-1">
                      <select
                        value={item.intervalMonths}
                        onChange={(e) => { const v = Number(e.target.value); set(ref, (a) => (group && v === 1 ? makeMonthly(a) : (a.intervalMonths = v))) }}
                        className="w-full rounded-md border border-transparent bg-transparent px-1 py-1 outline-none hover:border-line focus:border-accent"
                      >
                        {INTERVALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td className="w-40 py-1 px-1">
                      <select
                        value={item.mode || 'due'}
                        onChange={(e) => set(ref, (a) => { if (e.target.value === 'budget') { a.mode = 'budget'; delete a.placeholder } else delete a.mode })}
                        className="w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[12px] text-ink-2 outline-none hover:border-line focus:border-accent"
                      >
                        <option value="due">Fällige Zahlung</option>
                        <option value="budget">Jahresbudget (laufend)</option>
                      </select>
                      {budget && (
                        <select
                          value={item.carry === 'reset' ? 'reset' : 'carry'}
                          onChange={(e) => set(ref, (a) => { if (e.target.value === 'reset') a.carry = 'reset'; else delete a.carry })}
                          className="w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[12px] text-ink-2 outline-none hover:border-line focus:border-accent"
                          title="Was passiert mit dem nicht ausgegebenen Rest am Ende des Kalenderjahres?"
                        >
                          <option value="carry">Rest übertragen</option>
                          <option value="reset">Jedes Jahr neu</option>
                        </select>
                      )}
                      {!budget && <div className="flex items-center gap-1.5">
                        <input
                          type="date"
                          value={item.dueDate}
                          onChange={(e) => e.target.value && set(ref, (a) => { a.dueDate = e.target.value; delete a.placeholder })}
                          className="num w-[124px] rounded-md border border-transparent bg-transparent px-1 py-1 outline-none hover:border-line focus:border-accent"
                        />
                        {item.placeholder && <span className="text-warn" title="Platzhalter – bitte echtes Datum eintragen">{Icon.warn}</span>}
                      </div>}
                    </td>
                    <td className="w-28 py-1">
                      {startSaved === null ? (
                        <div className="px-2 text-right text-ink-3" title="Vor dem Startpunkt der Planung">–</div>
                      ) : (
                        <AmountInput value={Math.round(startSaved * 100) / 100} onChange={(v) => set(ref, (a) => { a.saved = v; a.savedAsOf = month })} />
                      )}
                    </td>
                    <td className="w-32 px-2 py-1 text-right">
                      <div className="num font-medium">{fmtCHF(r.rate)}</div>
                      {Math.abs(r.rate - flat) > 0.01 && <div className="num text-[11px] text-ink-3">normal {fmtCHF(flat)}</div>}
                    </td>
                    <td className="px-2 py-1">
                      {budget ? (
                        <div title={`Ausgaben ${year}: ${fmtCHF(spentYear)} von ${fmtCHF(yearBudget)}`}>
                          <Progress value={yearBudget ? spentYear / yearBudget : 0} tone={spentYear > yearBudget ? 'warn' : 'accent'} />
                          <div className="mt-1 whitespace-nowrap text-[11px] text-ink-3">{year}: {fmtCHF0(spentYear)} von {fmtCHF0(yearBudget)}</div>
                          {balance !== null && <div className={`whitespace-nowrap text-[11px] ${balance < 0 ? 'text-bad' : 'text-ink-2'}`}>Rücklage: {fmtCHF(balance)}</div>}
                        </div>
                      ) : r.payout > 0 ? (
                        <Badge tone="accent">Fällig: {fmtCHF0(r.payout)} wird bezahlt</Badge>
                      ) : (
                        <>
                          <Progress value={item.amount ? (startSaved ?? 0) / item.amount : 0} tone={elevated ? 'warn' : 'accent'} />
                          <div className="mt-1 flex justify-between gap-1 whitespace-nowrap text-[11px] text-ink-3">
                            <span>{r.left != null ? (r.left === 1 ? 'letzte Rate' : `noch ${r.left} Mt.`) : ''}</span>
                            {elevated && <span className="text-warn">erhöhte Rate</span>}
                          </div>
                        </>
                      )}
                    </td>
                    <td className="py-1 text-right">
                      <div className="flex justify-end opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                        <IconButton title="Auf Soll-Stand setzen" onClick={() => set(ref, (a) => { a.saved = onTrackSaved(a, month); a.savedAsOf = month })}>{Icon.target}</IconButton>
                        <IconButton title="Löschen" className="hover:text-bad" onClick={() =>
                          confirmAndDelete({
                            title: `«${item.name}» löschen?`,
                            message: group ? `Die Position wird aus der Gruppe «${group}» entfernt – in allen Monaten.` : 'Die Rücklage wird entfernt – in allen Monaten.',
                            ids: [item.id],
                            update,
                            tx,
                            mutate: (d) => removeRef(d, ref),
                          })
                        }>{Icon.trash}</IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line font-semibold">
                  <td className="px-2 pt-3">Total</td>
                  <td className="num px-2 pt-3 text-right">
                  {fmtCHF(t.amount)}
                  <div className="text-[11px] font-normal text-ink-3">pro Jahr</div>
                </td>
                  <td colSpan={2} />
                  <td className="num px-2 pt-3 text-right">{fmtCHF(t.saved)}</td>
                  <td className="num px-2 pt-3 text-right">{fmtCHF(t.rate)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
    )
  }

  const c = readColors()
  const rateOpts = baseOptions(theme.resolved, { legend: true })
  const payoutOpts = baseOptions(theme.resolved)
  payoutOpts.plugins.tooltip.callbacks.afterBody = (items) => forecast[items[0].dataIndex].payouts.map((p) => `  ${p.name}: ${fmtCHF0(p.amount)}`)

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={`Rücklage ${monthLabel(month)}`} value={fmtCHF(total)} hint="geplante Rate dieses Monats" tone={total > totalFlat * 1.1 ? 'bad' : undefined} />
        <Stat label="Gleichmässig verteilt" value={fmtCHF(totalFlat)} hint={`${fmtCHF0(totalAmount)} pro Jahr ÷ 12`} />
        <Stat label="Angespart (Soll)" value={fmtCHF0(totalSaved)} hint={`Stand Anfang ${monthLabel(month)}`} />
        <Stat
          label="Nächste Fälligkeit"
          value={nextPayout ? fmtCHF0(nextPayout.payout) : '–'}
          hint={nextPayout ? `${monthLabel(nextPayout.month)} · ${nextPayout.payouts.length > 2 ? nextPayout.payouts.length + ' Positionen' : nextPayout.payouts.map((p) => p.name).join(', ')}` : 'keine in 12 Monaten'}
        />
      </div>

      {reserveTable(
        rows.filter((x) => !x.group),
        {
          title: 'Jährliche Kosten',
          subtitle: 'Fällige Zahlung: Rate = (Betrag − angespart) ÷ Monate bis zur Fälligkeit (inkl. Fälligkeitsmonat, Zahlung Ende Monat). Jahresbudget: gleichmässig Betrag ÷ 12, Ausgaben laufend aus den Buchungen; pro Kalenderjahr – Rest übertragen oder jedes Jahr neu.',
          actions: (
            <>
              <Button onClick={allOnTrack} title="Angespart-Werte auf gleichmässigen Verlauf setzen">{Icon.target} Alle auf Soll-Stand</Button>
              <Button variant="primary" onClick={add}>{Icon.plus} Hinzufügen</Button>
            </>
          ),
          empty: 'Noch keine jährlichen Kosten erfasst.',
        },
      )}

      {rows.some((x) => x.group) &&
        reserveTable(
          rows.filter((x) => x.group).sort((a, b) => a.group.localeCompare(b.group)),
          {
            title: 'Periodische Positionen aus Gruppen',
            subtitle: 'Positionen aus den Budget-Gruppen mit vierteljährlicher, halbjährlicher oder jährlicher Abrechnung (z. B. Jahresabos). Sie zählen im Budget zu ihrer Gruppe.',
          },
        )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Rücklage pro Monat" subtitle="Benötigte Rate der nächsten 12 Monate">
          <div className="h-64">
            <Bar
              key={theme.resolved}
              options={rateOpts}
              data={{
                labels: forecast.map((f) => monthLabel(f.month)),
                datasets: [
                  { type: 'line', label: 'Gleichmässig', data: forecast.map(() => totalFlat), borderColor: c.ink3, borderWidth: 2, borderDash: [5, 4], pointRadius: 0, pointHoverRadius: 0 },
                  { label: 'Geplante Rate', data: forecast.map((f) => f.rate), backgroundColor: c.series[0], ...barStyle },
                ],
              }}
            />
          </div>
        </Card>
        <Card title="Fällige Zahlungen" subtitle="Wann die jährlichen Kosten bezahlt werden">
          <div className="h-64">
            <Bar
              key={theme.resolved}
              options={payoutOpts}
              data={{
                labels: forecast.map((f) => monthLabel(f.month)),
                datasets: [{ label: 'Fällig', data: forecast.map((f) => f.payout), backgroundColor: c.series[1], ...barStyle }],
              }}
            />
          </div>
        </Card>
      </div>

      <Card title="Kalender" subtitle="Fälligkeiten der nächsten 12 Monate">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {forecast.map((f) => (
            <div key={f.month} className={`rounded-xl px-3 py-2.5 ${f.payout > 0 ? 'bg-surface-2' : 'border border-dashed border-line'}`}>
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-medium">{monthLabel(f.month)}</span>
                {f.payout > 0 && <span className="num text-[13px] font-semibold">{fmtCHF0(f.payout)}</span>}
              </div>
              <ul className="mt-1 space-y-0.5 text-[12px] text-ink-2">
                {f.payouts.map((p) => <li key={p.name} className="truncate">{p.name}</li>)}
                {f.payouts.length === 0 && <li className="text-ink-3">–</li>}
              </ul>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

/**
 * Effektiv bezahlt in den letzten 12 Monaten. Bei Abweichung zum geplanten Betrag
 * werden Korrekturen angeboten – nie automatisch angewendet.
 */
function PaidHint({ item, paid, startSaved, month, onSet }) {
  if (!paid) return null
  const amount = Number(item.amount) || 0
  const diff = Math.round((paid - amount) * 100) / 100
  // Wurde die geplante Zahlung im Zeitraum bereits verrechnet (Fälligkeit vorbei)?
  const interval = Math.max(1, Number(item.intervalMonths) || 12)
  const next = nextDueMonth(item, month)
  const lastDue = next === month ? month : addMonths(next, -interval)
  // Nur wenn die geplante Zahlung im Zeitraum liegt UND nach Planungsbeginn (sonst ist sie im angesparten Stand nicht verrechnet)
  const dueInWindow =
    diffMonths(addMonths(month, -11), lastDue) >= 0 && diffMonths(lastDue, month) >= 0 && (!item.savedAsOf || diffMonths(item.savedAsOf, lastDue) >= 0)
  // Vorschlag: die geplante Zahlung (Betrag) durch die effektive ersetzen.
  // Nur sinnvoll, wenn die Fälligkeit im Zeitraum liegt – sonst wurde vor der Fälligkeit bezahlt.
  const suggested = startSaved === null || !dueInWindow ? null : Math.round((startSaved + amount - paid) * 100) / 100
  return (
    <div className="px-2 pb-1 text-[11px]">
      <span className="text-ink-3">bezahlt (12 Mt.): </span>
      <span className="num text-ink-2">{fmtCHF(paid)}</span>
      {Math.abs(diff) >= 0.5 && (
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span className="text-warn">{diff > 0 ? `${fmtCHF(diff)} mehr` : `${fmtCHF(-diff)} weniger`} als geplant</span>
          <button className="rounded px-1.5 py-0.5 text-accent hover:bg-accent-soft" onClick={() => onSet((a) => { a.amount = Math.round(paid * 100) / 100 })} title="Betrag für die nächsten Zyklen auf den effektiven Betrag setzen">
            Betrag {fmtCHF0(paid)} übernehmen
          </button>
          {suggested !== null && (
            <button
              className="rounded px-1.5 py-0.5 text-accent hover:bg-accent-soft"
              onClick={() => onSet((a) => { a.saved = suggested; a.savedAsOf = month })}
              title="Geplante Zahlung durch die effektive ersetzen"
            >
              Rest {fmtCHF(next === month ? suggested - amount : suggested)} als angespart übernehmen
            </button>
          )}
          {!dueInWindow && <span className="text-ink-3">· nicht am Fälligkeitsdatum bezahlt</span>}
          <button className="rounded px-1.5 py-0.5 text-accent hover:bg-accent-soft" onClick={() => onSet((a) => { a.mode = 'budget'; delete a.placeholder })} title="Kein fester Termin – laufende Ausgaben übers Jahr">
            Als Jahresbudget führen
          </button>
        </div>
      )}
    </div>
  )
}
