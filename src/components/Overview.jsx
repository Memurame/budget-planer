import { useMemo } from 'react'
import { Card, Money, Stat, Badge, Icon } from './ui.jsx'
import { fmtCHF, fmtCHF0, fmtPct } from '../lib/format.js'
import { amountAt, annualForecast, monthLabel } from '../lib/calc.js'
import { buildShares } from '../lib/shares.js'

function Row({ label, value, strong, negative, muted, onClick }) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between border-b border-line py-2 text-[14px] last:border-b-0 ${strong ? 'font-semibold' : ''} ${muted ? 'text-ink-2' : ''} ${onClick ? 'cursor-pointer hover:text-accent' : ''}`}
    >
      <span>{label}</span>
      <span className={`num ${negative ? 'text-ink-2' : ''}`}>{negative ? `– ${fmtCHF(value)}` : fmtCHF(value)}</span>
    </div>
  )
}

export default function Overview({ data, summary: s, month, setView }) {
  const shares = useMemo(() => buildShares(s), [s])
  const upcoming = useMemo(() => annualForecast(data, month, 6).filter((m) => m.payout > 0), [data, month])
  const elevated = s.reserves.filter((a) => !a.group && a.rate > a.flat * 1.25 + 0.01)
  const placeholders = s.reserves.filter((a) => a.placeholder).length

  return (
    <div className="flex flex-col gap-5">
      {placeholders > 0 && (
        <button
          onClick={() => setView('reserves')}
          className="flex items-center gap-2 rounded-xl border border-line bg-warn-soft px-4 py-2.5 text-left text-[13px] text-warn"
        >
          {Icon.warn}
          <span>
            Bei {placeholders} Positionen mit jährlicher Abrechnung ist das Fälligkeitsdatum noch ein Platzhalter. Unter <b>Rücklagen</b> anpassen →
          </span>
        </button>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Einnahmen" value={fmtCHF0(s.income)} hint={`${data.income.length} Positionen`} />
        <Stat label="Budget / Ausgaben" value={fmtCHF0(s.budget)} hint={`davon Rücklagen ${fmtCHF0(s.reserves.reduce((a, r) => a + r.rate, 0))}`} />
        <Stat label="Sparbetrag" value={fmtCHF0(s.savings)} hint={`Sparquote ${fmtPct(s.savingsRate)}`} />
        <Stat
          label="Frei verfügbar"
          value={fmtCHF0(s.result)}
          tone={s.result >= 0 ? 'good' : 'bad'}
          hint={s.result >= 0 ? `${fmtPct(s.freeRate)} der Einnahmen` : 'Budget übersteigt Einnahmen'}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Budget" subtitle={`Monatliche Kosten · ${monthLabel(month)}`}>
          {s.groups.map((g) => (
            <Row key={g.id} label={g.name} value={g.total} onClick={() => setView('budget')} />
          ))}
          <div onClick={() => setView('reserves')} className="flex cursor-pointer items-center justify-between border-b border-line py-2 text-[14px] hover:text-accent">
            <span className="flex items-center gap-2">
              Jährliche Kosten (Rücklage)
              {elevated.length > 0 && <Badge tone="warn" title={elevated.map((e) => e.name).join(', ')}>{Icon.warn} {elevated.length} erhöht</Badge>}
            </span>
            <span className="num">{fmtCHF(s.annual)}</span>
          </div>
          <Row label="Total Budget" value={s.budget} strong />
        </Card>

        <Card title="Monatsrechnung" subtitle="Einnahmen minus Budget und Abzüge">
          {data.income.map((i) => <Row key={i.id} label={i.name} value={amountAt(i, month)} />)}
          <Row label="Budget / Ausgaben" value={s.budget} negative />
          {data.deductions.map((d) => <Row key={d.id} label={d.name} value={amountAt(d, month)} negative />)}
          <div className="flex items-center justify-between pt-3 text-[15px] font-semibold">
            <span>Ergebnis</span>
            <span className={`num ${s.result >= 0 ? 'text-good' : 'text-bad'}`}>{fmtCHF(s.result)}</span>
          </div>
        </Card>
      </div>

      <Card title="Verteilung der Einnahmen" subtitle={`Wohin die ${fmtCHF0(s.income)} pro Monat fliessen`}>
        <ShareBar shares={shares} />
      </Card>

      <Card title="Nächste Fälligkeiten" subtitle="Jährliche Kosten in den kommenden 6 Monaten" actions={<button className="text-[13px] text-accent hover:underline" onClick={() => setView('reserves')}>Alle Rücklagen →</button>}>
        {upcoming.length === 0 ? (
          <p className="text-[14px] text-ink-3">Keine Fälligkeiten in den nächsten 6 Monaten.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((m) => (
              <div key={m.month} className="rounded-xl bg-surface-2 px-4 py-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] font-medium text-ink-2">{monthLabel(m.month)}</span>
                  <span className="num text-[15px] font-semibold">{fmtCHF(m.payout)}</span>
                </div>
                <ul className="mt-1.5 space-y-0.5 text-[13px] text-ink-2">
                  {m.payouts.map((p) => (
                    <li key={p.name} className="flex justify-between gap-2">
                      <span className="truncate">{p.name}</span>
                      <span className="num">{fmtCHF0(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function ShareBar({ shares }) {
  const total = shares.reduce((s, x) => s + Math.max(0, x.value), 0) || 1
  return (
    <div>
      <div className="flex h-9 w-full gap-[2px] overflow-hidden rounded-lg">
        {shares.filter((x) => x.value > 0).map((x) => (
          <div
            key={x.key}
            title={`${x.name}: ${fmtCHF(x.value)} (${fmtPct(x.value / total)})`}
            className="h-full transition-[filter] first:rounded-l-lg last:rounded-r-lg hover:brightness-110"
            style={{ width: `${(x.value / total) * 100}%`, background: x.color }}
          />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
        {shares.map((x) => (
          <div key={x.key} className="flex items-center gap-2 text-[13px]">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: x.color }} />
            <span className="truncate text-ink-2">{x.name}</span>
            <span className="num ml-auto text-ink">{fmtPct(x.value / total)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
