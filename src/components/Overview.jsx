import { useMemo } from 'react'
import { Card, Money, Stat, Badge, Icon } from './ui.jsx'
import { fmtCHF, fmtCHF0, fmtDate, fmtPct } from '../lib/format.js'
import { amountAt, annualForecast, isPeriodic, itemMonthly, monthKey, monthLabel } from '../lib/calc.js'
import { loanOutId, loansMonthly, loansOverview } from '../lib/loans.js'
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

export default function Overview({ data, summary: s, month, setView, tx }) {
  const shares = useMemo(() => buildShares(s), [s])
  const upcoming = useMemo(() => annualForecast(data, month, 6).filter((m) => m.payout > 0), [data, month])
  const elevated = s.reserves.filter((a) => !a.group && a.rate > a.flat * 1.25 + 0.01)
  const placeholders = s.reserves.filter((a) => a.placeholder).length
  // Kachel «Offene Darlehen» nur, wenn Darlehen erfasst sind
  const loanInfo = (data.loans || []).length ? loansOverview(data.loans, tx.allTransactions || tx.transactions, monthKey()) : null

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

      <div className={`grid grid-cols-2 gap-4 ${loanInfo ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
        <Stat label="Einnahmen" value={fmtCHF0(s.income)} hint={`${data.income.length} Positionen`} />
        <Stat label="Budget / Ausgaben" value={fmtCHF0(s.budget)} hint={`davon Rücklagen ${fmtCHF0(s.reserves.reduce((a, r) => a + r.rate, 0))}`} />
        <Stat label="Sparbetrag" value={fmtCHF0(s.savings)} hint={`Sparquote ${fmtPct(s.savingsRate)}`} />
        <Stat
          label="Frei verfügbar"
          value={fmtCHF0(s.result)}
          tone={s.result >= 0 ? 'good' : 'bad'}
          hint={s.result >= 0 ? `${fmtPct(s.freeRate)} der Einnahmen` : 'Budget übersteigt Einnahmen'}
        />
        {loanInfo && (
          <button onClick={() => setView('loans')} className="text-left transition hover:brightness-[0.98]">
            <Stat
              label="Offene Darlehen"
              value={fmtCHF0(loanInfo.outstanding)}
              hint={loanInfo.count ? (loanInfo.nextDue ? `nächste Fälligkeit ${fmtDate(loanInfo.nextDue)}` : `${loanInfo.count} offen`) : 'alles zurückbezahlt'}
            />
          </button>
        )}
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
          {s.loans.total > 0 && <Row label="Darlehen (Raten und Rücklagen)" value={s.loans.total} onClick={() => setView('loans')} />}
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

      <BudgetVsActual data={data} month={month} tx={tx} setView={setView} />

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

/** Soll/Ist pro Gruppe für den Monat. Periodische Kosten werden separat gezeigt (Zahlung ≠ Monatsrate). */
function BudgetVsActual({ data, month, tx, setView }) {
  const p = tx.progress
  if (!p.total) {
    return (
      <Card title={`Soll / Ist ${monthLabel(month)}`} subtitle="Noch keine Buchungen für diesen Monat">
        <button onClick={() => setView('transactions')} className="text-[14px] text-accent hover:underline">Kontoauszug importieren oder Buchungen erfassen →</button>
      </Card>
    )
  }
  const a = tx.actual
  const rows = data.groups.map((g) => {
    const items = g.items.filter((it) => !isPeriodic(it))
    return { name: g.name, plan: items.reduce((x, it) => x + itemMonthly(it, month), 0), actual: items.reduce((x, it) => x + (a[it.id] || 0), 0) }
  })
  const periodicPaid =
    data.annual.reduce((x, it) => x + (a[it.id] || 0), 0) +
    data.groups.flatMap((g) => g.items.filter(isPeriodic)).reduce((x, it) => x + (a[it.id] || 0), 0)
  const deductions = { name: 'Sparen & Abzüge', plan: data.deductions.reduce((x, d) => x + amountAt(d, month), 0), actual: data.deductions.reduce((x, d) => x + (a[d.id] || 0), 0) }
  // Darlehen: geplante Raten vs. effektive Rückzahlungen (Rücklagen für einmalige Rückzahlungen wie jährliche Kosten separat)
  const loanList = data.loans || []
  const loanRow = { name: 'Darlehen (Raten)', plan: loansMonthly(loanList, month, tx.allTransactions || tx.transactions).rates, actual: loanList.reduce((x, l) => x + (a[loanOutId(l)] || 0), 0) }
  const all = [...rows, ...(loanRow.plan || loanRow.actual ? [loanRow] : []), ...(deductions.actual ? [deductions] : [])]
  const pct = p.relevant ? p.confirmed / p.relevant : 0

  return (
    <Card
      title={`Soll / Ist ${monthLabel(month)}`}
      subtitle={`${p.confirmed} von ${p.relevant} Buchungen bestätigt${p.open ? ` · ${p.open} noch nicht zugeordnet` : ''}`}
      actions={<button className="text-[13px] text-accent hover:underline" onClick={() => setView('transactions')}>Buchungen prüfen →</button>}
    >
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-good" style={{ width: `${pct * 100}%` }} /></div>
      <div className="space-y-3">
        {all.map((r) => {
          const over = r.actual > r.plan + 0.005
          return (
            <div key={r.name} className="grid grid-cols-[160px_minmax(0,1fr)_290px] items-center gap-4 text-[13px]">
              <span className="truncate">{r.name}</span>
              {/* Ganze Breite = Budget der Zeile; über Budget → ganzer Balken rot */}
              <div className="relative h-5" title={`Budget ${fmtCHF(r.plan)} · effektiv ${fmtCHF(r.actual)}`}>
                <div className="absolute inset-0 rounded bg-surface-2" />
                <div className={`absolute left-0 top-1 h-3 rounded ${over ? 'bg-bad' : 'bg-accent'}`} style={{ width: `${Math.min(1, r.plan > 0 ? r.actual / r.plan : r.actual > 0 ? 1 : 0) * 100}%` }} />
              </div>
              <span className="num whitespace-nowrap text-right">
                {fmtCHF(r.actual)} <span className="text-ink-3">/ {fmtCHF(r.plan)}</span>
                <span className={`ml-2 ${over ? 'text-bad' : 'text-good'}`}>{over ? '+' : '−'} {fmtCHF0(Math.abs(r.plan - r.actual)).replace('CHF ', '')}</span>
              </span>
            </div>
          )
        })}
      </div>
      {periodicPaid > 0 && (
        <div className="mt-4 flex justify-between border-t border-line pt-3 text-[13px]">
          <span className="text-ink-2">Bezahlte jährliche / periodische Kosten (aus Rücklagen)</span>
          <button className="num text-accent hover:underline" onClick={() => setView('reserves')}>{fmtCHF(periodicPaid)}</button>
        </div>
      )}
      <div className="mt-3 flex gap-4 text-[11px] text-ink-3">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-surface-2 ring-1 ring-line" />Budget</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-accent" />Effektiv</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-bad" />über Budget</span>
      </div>
    </Card>
  )
}
