import { Fragment, useMemo, useState } from 'react'
import { Card, Icon } from './ui.jsx'
import { fmtCHF0 } from '../lib/format.js'
import { annualRate, isPeriodic, itemMonthly, monthKey, monthLabel, reserveItems } from '../lib/calc.js'
import { actualByPosition } from '../lib/tx.js'

const MONTH_NAMES = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const round = (v) => Math.round(v * 100) / 100
// Betrag ohne «CHF» (Intl setzt ein geschütztes Leerzeichen dazwischen)
const n0 = (v) => fmtCHF0(v).replace(/CHF\s*/, '')

/**
 * Jahresübersicht: Budget und effektive Beträge pro Monat für das Jahr des gewählten Monats.
 * Budget-Gruppen (monatliche Positionen, aufklappbar) und jährliche Kosten (Rücklagen) getrennt.
 * «bis heute» vergleicht nur vergangene Monate inkl. des laufenden.
 */
export default function YearOverview({ data, month, tx }) {
  const year = month.slice(0, 4)
  const months = MONTH_NAMES.map((_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
  const current = monthKey()
  const start = tx.startMonth
  const [open, setOpen] = useState(() => new Set())
  const toggle = (id) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  // Zustand pro Monat: vor dem Start (leer), vergangen/laufend (Ist vorhanden), zukünftig (nur Budget)
  const state = (m) => (start && m < start ? 'none' : m <= current ? 'past' : 'future')
  const pastMonths = months.filter((m) => state(m) === 'past')
  const lastPast = pastMonths[pastMonths.length - 1]

  const actualByMonth = useMemo(
    () => Object.fromEntries(months.map((m) => [m, actualByPosition(tx.transactions, m)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tx.transactions, year],
  )

  /** Zeile aus einer Liste von Positionen und einer Budget-Funktion pro Position und Monat. */
  const makeRow = (items, planOf) => {
    const cells = months.map((m) => {
      const st = state(m)
      if (st === 'none') return { m, st, plan: null, actual: null }
      const plan = round(items.reduce((s, it) => s + planOf(it, m), 0))
      const actual = st === 'past' ? round(items.reduce((s, it) => s + (actualByMonth[m][it.id] || 0), 0)) : null
      return { m, st, plan, actual }
    })
    const past = cells.filter((c) => c.st === 'past')
    const planToDate = round(past.reduce((s, c) => s + c.plan, 0))
    const actualToDate = round(past.reduce((s, c) => s + c.actual, 0))
    const planYear = round(cells.reduce((s, c) => s + (c.plan || 0), 0))
    return { cells, planToDate, actualToDate, diff: round(planToDate - actualToDate), planYear, leftYear: round(planYear - actualToDate) }
  }

  const monthly = (it, m) => itemMonthly(it, m)
  const groups = data.groups
    .map((g) => {
      const items = g.items.filter((it) => !isPeriodic(it))
      return { id: g.id, name: g.name, row: makeRow(items, monthly), items: items.map((it) => ({ id: it.id, name: it.name, row: makeRow([it], monthly) })) }
    })
    .filter((g) => g.items.length > 0)

  const reserves = reserveItems(data).map(({ item, group }) => ({ id: item.id, name: item.name, group, row: makeRow([item], (it, m) => annualRate(it, m)) }))
  const reserveRow = makeRow(reserveItems(data).map((x) => x.item), (it, m) => annualRate(it, m))
  const groupTotal = sumRows(groups.map((g) => g.row), months)
  const total = sumRows([groupTotal, reserveRow], months)

  const toDateLabel = lastPast ? (lastPast === `${year}-01` ? 'Jan' : `Jan–${MONTH_NAMES[Number(lastPast.slice(5)) - 1]}`) : null

  return (
    <div className="flex flex-col gap-5">
      <p className="rounded-xl bg-accent-soft px-4 py-2.5 text-[13px] text-ink-2">
        Pro Monat: ausgegeben (gross) und Budget (klein). «Bis heute» zählt nur die Monate bis {monthLabel(current)} –
        «Verfügbar Jahr» zeigt, was vom Jahresbudget bis Ende Jahr noch übrig ist. Zukünftige Monate zeigen nur das Budget
        {start ? `, Monate vor dem Start (${monthLabel(start)}) bleiben leer` : ''}.
      </p>

      <Card padded={false} title={`Jahr ${year}`} subtitle="Mit den Pfeilen oben wechselst du das Jahr">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-[12px] font-medium uppercase tracking-wide text-ink-3">
                <th className="sticky left-0 z-10 bg-surface px-4 py-2 text-left">Position</th>
                {months.map((m, i) => (
                  <th key={m} className={`px-2 py-2 text-right ${m === current ? 'text-accent' : ''}`}>{MONTH_NAMES[i]}</th>
                ))}
                <th className="border-l border-line px-3 py-2 text-right">Budget {toDateLabel ? `(${toDateLabel})` : 'bis heute'}</th>
                <th className="px-3 py-2 text-right">Ist {toDateLabel ? `(${toDateLabel})` : 'bis heute'}</th>
                <th className="px-3 py-2 text-right">Verfügbar {toDateLabel ? `(${toDateLabel})` : 'bis heute'}</th>
                <th className="border-l border-line px-3 py-2 text-right">Budget Jahr</th>
                <th className="px-3 py-2 text-right">Verfügbar Jahr</th>
              </tr>
            </thead>
            <tbody>
              <SectionRow label="Budget-Gruppen" colSpan={months.length + 6} />
              {groups.map((g) => (
                <Fragment key={g.id}>
                  <Row
                    label={
                      <button className="flex items-center gap-1.5 font-medium" onClick={() => toggle(g.id)}>
                        <span className={`text-ink-3 transition ${open.has(g.id) ? '' : '-rotate-90'}`}>{Icon.down}</span>
                        {g.name}
                      </button>
                    }
                    row={g.row}
                    colored
                  />
                  {open.has(g.id) && g.items.map((it) => <Row key={it.id} label={<span className="pl-6 text-ink-2">{it.name}</span>} row={it.row} colored sub />)}
                </Fragment>
              ))}
              <Row label={<span className="font-semibold">Total Budget-Gruppen</span>} row={groupTotal} colored strong />

              {reserves.length > 0 && (
                <>
                  <SectionRow label="Jährliche Kosten (Rücklagen)" hint="Budget = monatliche Rücklage, Ist = Zahlungen im Monat" colSpan={months.length + 6} />
                  {/* Summenzeile oben (aufklappbar), die einzelnen Rücklagen darunter – wie bei den Gruppen */}
                  <Row
                    label={
                      <button className="flex items-center gap-1.5 font-semibold" onClick={() => toggle('__reserves')}>
                        <span className={`text-ink-3 transition ${open.has('__reserves') ? '' : '-rotate-90'}`}>{Icon.down}</span>
                        Total Rücklagen
                      </button>
                    }
                    row={reserveRow}
                    strong
                  />
                  {open.has('__reserves') &&
                    reserves.map((r) => (
                      <Row key={r.id} label={<span className="pl-6 text-ink-2">{r.name}{r.group && <span className="text-ink-3"> · {r.group}</span>}</span>} row={r.row} sub />
                    ))}
                </>
              )}

              <Row label={<span className="font-semibold">Gesamt</span>} row={total} strong total />
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

/** Mehrere Zeilen monatsweise addieren. */
function sumRows(rows, months) {
  const cells = months.map((m, i) => {
    const cs = rows.map((r) => r.cells[i])
    const st = cs[0]?.st ?? 'none'
    if (st === 'none') return { m, st, plan: null, actual: null }
    return { m, st, plan: round(cs.reduce((s, c) => s + (c.plan || 0), 0)), actual: st === 'past' ? round(cs.reduce((s, c) => s + (c.actual || 0), 0)) : null }
  })
  const planToDate = round(rows.reduce((s, r) => s + r.planToDate, 0))
  const actualToDate = round(rows.reduce((s, r) => s + r.actualToDate, 0))
  const planYear = round(rows.reduce((s, r) => s + r.planYear, 0))
  return { cells, planToDate, actualToDate, diff: round(planToDate - actualToDate), planYear, leftYear: round(planYear - actualToDate) }
}

function SectionRow({ label, hint, colSpan }) {
  return (
    <tr className="border-b border-line bg-surface-2/60">
      <td colSpan={colSpan} className="sticky left-0 px-4 py-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-3">
        {label}
        {hint && <span className="ml-2 normal-case tracking-normal">· {hint}</span>}
      </td>
    </tr>
  )
}

/** Eine Tabellenzeile: Monatszellen (Ist gross, Budget klein) und Summen. `colored` = über Budget rot, unter Budget grün. */
function Row({ label, row, colored, strong, sub, total }) {
  const tone = (v) => (v < -0.005 ? 'text-bad' : v > 0.005 ? 'text-good' : 'text-ink-3')
  const bold = strong ? 'font-semibold' : ''
  return (
    <tr className={`border-b border-line ${total ? 'border-t-2 bg-surface-2/40' : ''} ${sub ? 'bg-surface-2/20' : ''}`}>
      <td className={`sticky left-0 z-10 whitespace-nowrap px-4 py-1.5 ${total ? 'bg-surface-2' : 'bg-surface'}`}>{label}</td>
      {row.cells.map((c) => {
        return (
          <td key={c.m} className="whitespace-nowrap px-2 py-1.5 text-right align-top">
            {c.st === 'none' ? null : c.st === 'future' ? (
              <div className="num pt-[18px] text-[11px] text-ink-3" title={`Budget ${fmtCHF0(c.plan)}`}>{n0(c.plan)}</div>
            ) : (
              <div title={`Effektiv ${fmtCHF0(c.actual)} · Budget ${fmtCHF0(c.plan)}`}>
                {/* gross: ausgegeben · klein: Budget */}
                <div className={`num ${bold} ${colored && c.actual > c.plan + 0.005 ? 'text-bad' : colored && c.actual > 0 ? 'text-good' : ''}`}>{c.actual ? n0(c.actual) : '–'}</div>
                <div className="num text-[11px] text-ink-3">{n0(c.plan)}</div>
              </div>
            )}
          </td>
        )
      })}
      <td className={`num whitespace-nowrap border-l border-line px-3 py-1.5 text-right ${bold}`}>{fmtCHF0(row.planToDate)}</td>
      <td className={`num whitespace-nowrap px-3 py-1.5 text-right ${bold}`}>{fmtCHF0(row.actualToDate)}</td>
      <td className={`num whitespace-nowrap px-3 py-1.5 text-right ${bold} ${colored || total ? tone(row.diff) : 'text-ink-3'}`} title="Budget bis heute minus ausgegeben (negativ = über Budget)">
        {fmtCHF0(row.diff)}
      </td>
      <td className={`num whitespace-nowrap border-l border-line px-3 py-1.5 text-right text-ink-2 ${bold}`}>{fmtCHF0(row.planYear)}</td>
      <td className={`num whitespace-nowrap px-3 py-1.5 text-right ${bold} ${tone(row.leftYear)}`} title="Budget fürs ganze Jahr minus bisher ausgegeben – so viel ist bis Ende Jahr noch verfügbar">
        {fmtCHF0(row.leftYear)}
      </td>
    </tr>
  )
}
