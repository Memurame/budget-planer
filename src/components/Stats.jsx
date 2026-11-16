import { useMemo, useState } from 'react'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import { Card, Button, IconButton, Stat, Icon } from './ui.jsx'
import { fmtCHF, fmtCHF0, fmtPct } from '../lib/format.js'
import { actualByPosition, counts, monthOf } from '../lib/tx.js'
import { isPeriodic, itemMonthly } from '../lib/calc.js'
import { addMonths, amountAt, flatRate, itemMonthlyFlat, monthKey, monthLabel, summary, uid } from '../lib/calc.js'
import { baseOptions, barStyle, readColors } from '../lib/charts.js'

/** Kennzahlen mit gleichmässig verteilten jährlichen Kosten – stabil für Jahresvergleiche. */
export function yearlyTotals(d, key = monthKey()) {
  const sum = (a) => a.reduce((s, x) => s + amountAt(x, key), 0)
  const income = sum(d.income)
  const groups = d.groups.map((g) => ({ name: g.name, total: g.items.reduce((s, it) => s + itemMonthlyFlat(it, key), 0) }))
  const annual = d.annual.reduce((s, a) => s + flatRate(a), 0)
  const deductions = sum(d.deductions)
  const savings = sum(d.deductions.filter((x) => x.isSaving))
  const budget = groups.reduce((s, g) => s + g.total, 0) + annual
  return { income, groups, annual, deductions, savings, budget, result: income - budget - deductions }
}

export default function Stats({ data, update, replaceData, theme, month, tx }) {
  const t = useMemo(() => yearlyTotals(data, month), [data, month])
  const c = readColors()

  // Budget nach Gruppen (max. 8 Farben, Rest wird zusammengefasst)
  const slices = useMemo(() => {
    const list = [...t.groups.map((g) => ({ name: g.name, value: g.total })), { name: 'Jährliche Kosten', value: t.annual }]
    if (list.length <= 8) return list
    const head = list.slice(0, 7)
    return [...head, { name: 'Übrige', value: list.slice(7).reduce((s, x) => s + x.value, 0) }]
  }, [t])

  // Grösste Einzelpositionen (monatlich)
  const top = useMemo(() => {
    const all = [
      ...data.groups.flatMap((g) => g.items.map((i) => ({ name: i.name, group: g.name, value: itemMonthlyFlat(i, month) }))),
      ...data.annual.map((a) => ({ name: a.name, group: 'Jährliche Kosten', value: flatRate(a) })),
    ]
    return all.sort((a, b) => b.value - a.value).slice(0, 12)
  }, [data, month])

  const donutOpts = {
    ...baseOptions(theme.resolved),
    scales: {},
    cutout: '68%',
    interaction: { mode: 'nearest', intersect: true },
  }
  donutOpts.plugins.tooltip.callbacks.label = (ctx) => ` ${ctx.label}: ${fmtCHF(ctx.parsed)} (${fmtPct(ctx.parsed / t.budget)})`

  const topOpts = baseOptions(theme.resolved, { horizontal: true })
  topOpts.plugins.tooltip.callbacks.title = (items) => `${top[items[0].dataIndex].name} · ${top[items[0].dataIndex].group}`

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Ausgaben pro Jahr" value={fmtCHF0(t.budget * 12)} hint={`Budget inkl. jährlicher Kosten`} />
        <Stat label="Sparen pro Jahr" value={fmtCHF0(t.savings * 12)} hint={`Sparquote ${fmtPct(t.income ? t.savings / t.income : 0)}`} />
        <Stat label="Frei pro Jahr" value={fmtCHF0(t.result * 12)} tone={t.result >= 0 ? 'good' : 'bad'} hint={`${fmtCHF0(t.result)} pro Monat`} />
        <Stat label="Fixe Verpflichtungen" value={fmtPct(t.income ? (t.budget + t.deductions) / t.income : 0)} hint="Budget + Abzüge ÷ Einnahmen" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card title="Budget nach Gruppen" subtitle="Monatlich, jährliche Kosten gleichmässig verteilt">
          <div className="relative mx-auto h-56 w-56">
            <Doughnut
              key={theme.resolved}
              options={donutOpts}
              data={{
                labels: slices.map((s) => s.name),
                datasets: [{ data: slices.map((s) => s.value), backgroundColor: c.series.slice(0, slices.length), borderColor: c.surface, borderWidth: 2, hoverOffset: 4 }],
              }}
            />
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
              <div>
                <div className="text-[12px] text-ink-3">Total</div>
                <div className="num text-[20px] font-semibold">{fmtCHF0(t.budget)}</div>
              </div>
            </div>
          </div>
          <table className="mt-4 w-full text-[13px]">
            <tbody>
              {slices.map((s, i) => (
                <tr key={s.name} className="border-b border-line last:border-b-0">
                  <td className="py-1.5"><span className="mr-2 inline-block size-2.5 rounded-sm align-middle" style={{ background: c.series[i] }} />{s.name}</td>
                  <td className="num py-1.5 text-right">{fmtCHF(s.value)}</td>
                  <td className="num w-14 py-1.5 text-right text-ink-3">{fmtPct(s.value / t.budget)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Grösste Positionen" subtitle="Top 12 pro Monat">
          <div style={{ height: Math.max(220, top.length * 30) }}>
            <Bar
              key={theme.resolved}
              options={topOpts}
              data={{
                labels: top.map((x) => x.name),
                datasets: [{ label: 'Monatlich', data: top.map((x) => x.value), backgroundColor: c.series[0], ...barStyle, maxBarThickness: 18 }],
              }}
            />
          </div>
        </Card>
      </div>

      {tx.progress.total > 0 && <GroupActual data={data} month={month} theme={theme} tx={tx} />}

      <History data={data} month={month} theme={theme} tx={tx} />

      <Versions data={data} update={update} replaceData={replaceData} theme={theme} current={t} month={month} />
    </div>
  )
}

function Versions({ data, update, replaceData, theme, current, month }) {
  const [name, setName] = useState(`Budget ${new Date().getFullYear()}`)
  const versions = data.versions || []
  const c = readColors()

  const save = () => {
    const snapshot = structuredClone({ income: data.income, groups: data.groups, annual: data.annual, deductions: data.deductions })
    update((d) => {
      d.versions = d.versions || []
      d.versions.push({ id: uid(), name: name.trim() || 'Version', createdAt: new Date().toISOString(), snapshot })
    })
  }
  const restore = (v) => {
    if (!confirm(`Aktuelles Budget durch «${v.name}» ersetzen? Speichere vorher eine Version, wenn du den aktuellen Stand behalten willst.`)) return
    replaceData({ ...data, ...structuredClone(v.snapshot) })
  }

  // Vergleich: letzte 3 Versionen + aktueller Stand (feste Farbe pro Version nach Reihenfolge)
  const compared = [...versions.slice(-3).map((v) => ({ name: v.name, t: yearlyTotals(v.snapshot, monthKey(new Date(v.createdAt))) })), { name: monthLabel(month), t: current }]
  const groupNames = [...new Set(compared.flatMap((x) => x.t.groups.map((g) => g.name)))]
  const cats = [
    { label: 'Einnahmen', get: (t) => t.income },
    ...groupNames.map((n) => ({ label: n, get: (t) => t.groups.find((g) => g.name === n)?.total || 0 })),
    { label: 'Jährliche Kosten', get: (t) => t.annual },
    { label: 'Sparen & Abzüge', get: (t) => t.deductions },
    { label: 'Frei', get: (t) => t.result },
  ]
  const opts = baseOptions(theme.resolved, { legend: true })

  return (
    <Card title="Versionen & Vergleich" subtitle="Halte z. B. jedes Jahr einen Stand fest und vergleiche die Entwicklung">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-64 rounded-lg border border-line bg-surface px-3 py-1.5 text-[14px] outline-none focus:border-accent"
        />
        <Button variant="primary" onClick={save}>{Icon.plus} Aktuellen Stand als Version speichern</Button>
      </div>

      {versions.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {versions.map((v, i) => (
            <div key={v.id} className="group flex items-center gap-2 rounded-lg border border-line py-1 pl-3 pr-1 text-[13px]">
              <span className="font-medium">{v.name}</span>
              <span className="text-ink-3">{new Date(v.createdAt).toLocaleDateString('de-CH')}</span>
              <button className="rounded px-1.5 py-0.5 text-[12px] text-accent hover:bg-accent-soft" onClick={() => restore(v)}>Laden</button>
              <IconButton title="Version löschen" className="hover:text-bad" onClick={() => confirm(`Version «${v.name}» löschen?`) && update((d) => { d.versions.splice(i, 1) })}>{Icon.trash}</IconButton>
            </div>
          ))}
        </div>
      )}

      {versions.length === 0 ? (
        <p className="text-[14px] text-ink-3">Noch keine Versionen gespeichert. Sobald du eine speicherst, erscheint hier der Vergleich.</p>
      ) : (
        <div className="h-72">
          <Bar
            key={theme.resolved}
            options={opts}
            data={{
              labels: cats.map((x) => x.label),
              datasets: compared.map((v, i) => ({
                label: v.name,
                data: cats.map((x) => x.get(v.t)),
                backgroundColor: i === compared.length - 1 ? c.series[0] : c.series[(i + 1) % 8],
                ...barStyle,
                maxBarThickness: 22,
              })),
            }}
          />
        </div>
      )}
    </Card>
  )
}

/** Verlauf der letzten 12 Monate bis zum gewählten Monat. */
function History({ data, month, theme, tx }) {
  const rows = useMemo(() => {
    const spent = {}
    for (const t of tx.transactions) if (counts(t)) spent[monthOf(t.date)] = (spent[monthOf(t.date)] || 0) - t.amount
    // Monate vor dem Start des Budget-Planers bleiben leer
    const before = (m) => !!tx.startMonth && m < tx.startMonth
    return Array.from({ length: 12 }, (_, i) => addMonths(month, i - 11)).map((m) => ({ m, s: before(m) ? null : summary(data, m), spent: m in spent ? spent[m] : null }))
  }, [data, month, tx.transactions, tx.startMonth])
  const hasSpent = rows.some((r) => r.spent !== null)
  const c = readColors()
  const opts = baseOptions(theme.resolved, { legend: true })
  opts.interaction = { mode: 'index', intersect: false }
  const line = (label, color, get) => ({
    label,
    data: rows.map((r) => (r.s ? get(r.s) : null)),
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 5,
    pointHoverBorderColor: c.surface,
    pointHoverBorderWidth: 2,
    tension: 0.25,
  })
  return (
    <Card title="Verlauf" subtitle={`Letzte 12 Monate bis ${monthLabel(month)} – zeigt, wie sich deine Einträge über die Monate verändert haben`}>
      <div className="h-64">
        <Line
          key={theme.resolved}
          options={opts}
          data={{
            labels: rows.map((r) => monthLabel(r.m)),
            datasets: [
              line('Einnahmen', c.series[0], (s) => s.income),
              line('Budget', c.series[1], (s) => s.budget),
              line('Frei verfügbar', c.series[2], (s) => s.result),
              ...(hasSpent ? [{ ...line('Effektiv ausgegeben', c.series[3], () => null), data: rows.map((r) => r.spent), borderDash: [6, 4], spanGaps: false, pointRadius: 3 }] : []),
            ],
          }}
        />
      </div>
    </Card>
  )
}

/** Soll/Ist pro Gruppe im gewählten Monat (ohne periodische Positionen). */
function GroupActual({ data, month, theme, tx }) {
  const c = readColors()
  const a = tx.actual
  const rows = data.groups.map((g) => {
    const items = g.items.filter((it) => !isPeriodic(it))
    return { name: g.name, plan: items.reduce((x, it) => x + itemMonthly(it, month), 0), actual: items.reduce((x, it) => x + (a[it.id] || 0), 0) }
  })
  const opts = baseOptions(theme.resolved, { legend: true })
  return (
    <Card title={`Soll / Ist nach Gruppe · ${monthLabel(month)}`} subtitle="Monatliche Positionen; jährliche Kosten werden unter Rücklagen verglichen">
      <div className="h-64">
        <Bar
          key={theme.resolved}
          options={opts}
          data={{
            labels: rows.map((r) => r.name),
            datasets: [
              { label: 'Budget', data: rows.map((r) => r.plan), backgroundColor: c.series[0], ...barStyle, maxBarThickness: 40, categoryPercentage: 0.5, barPercentage: 0.9 },
              { label: 'Effektiv', data: rows.map((r) => r.actual), backgroundColor: c.series[1], ...barStyle, maxBarThickness: 40, categoryPercentage: 0.5, barPercentage: 0.9 },
            ],
          }}
        />
      </div>
    </Card>
  )
}
