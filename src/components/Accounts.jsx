import { useState } from 'react'
import { Card, Button, IconButton, Badge, Icon, AmountInput, TextInput } from './ui.jsx'
import PositionSelect from './PositionSelect.jsx'
import { fmtCHF, fmtDate } from '../lib/format.js'
import { addMonths, itemMonthly, monthLabel, uid } from '../lib/calc.js'
import { ACCOUNT_TYPES, allPositions, balanceCheck, currentBalance, monthOf, yearOf } from '../lib/tx.js'

const lastDayOf = (key) => {
  const [y, m] = key.split('-').map(Number)
  return `${key}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}

export default function Accounts({ data, update, month, tx }) {
  const [name, setName] = useState('')
  const add = () => {
    update((d) => { d.accounts.push({ id: uid(), name: name.trim() || 'Neues Konto', type: 'pocket', funds: [] }) })
    setName('')
  }
  return (
    <div className="flex flex-col gap-5">
      <p className="rounded-xl bg-accent-soft px-4 py-2.5 text-[13px] text-ink-2">
        Konten sind die Orte, von denen bezahlt wird (Girokonto, Pockets, externe Konten). Unabhängig davon wird jede Buchung einer Budget-Position zugeordnet.
        Trage zum Monatsende den tatsächlichen Saldo ein – die App vergleicht ihn mit dem berechneten Wert. Beim CSV-Import wird der Kontostand automatisch übernommen.
      </p>

      {data.accounts.map((a, i) => (
        <AccountCard key={a.id} account={a} index={i} data={data} update={update} month={month} tx={tx} />
      ))}

      <div className="flex items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Name des neuen Kontos, z. B. Pocket Lifestyle"
          className="flex-1 bg-transparent px-1 text-[14px] outline-none placeholder:text-ink-3"
        />
        <Button onClick={add}>{Icon.plus} Konto hinzufügen</Button>
      </div>
    </div>
  )
}

function AccountCard({ account: a, index, data, update, month, tx }) {
  const [entry, setEntry] = useState({ date: lastDayOf(month), amount: 0 })
  const set = (fn) => update((d) => fn(d.accounts[index]))
  const checks = balanceCheck(a, tx.balances, tx.transactions).slice().reverse()
  const current = currentBalance(a, tx.balances, tx.transactions)
  const monthTx = tx.transactions.filter((t) => t.accountId === a.id && monthOf(t.date) === month)
  const outflow = monthTx.filter((t) => t.status !== 'ignored' && t.amount < 0).reduce((s, t) => s - t.amount, 0)
  const positions = allPositions(data)
  const funded = positions.filter((p) => (a.funds || []).includes(p.id))
  const plan = funded.reduce((s, p) => s + (data.annual.includes(p.item) ? 0 : itemMonthly(p.item, month)), 0)
  const fundedActual = funded.reduce((s, p) => s + (tx.actual[p.id] || 0), 0)

  const addBalance = async () => {
    await tx.ensureYears([yearOf(entry.date)])
    tx.addBalance({ id: uid(), accountId: a.id, date: entry.date, amount: entry.amount, source: 'manual' })
  }
  const correction = async (b) => {
    await tx.ensureYears([yearOf(b.date)])
    tx.addTx({
      id: `kor-${uid()}`,
      accountId: a.id,
      date: b.date,
      bookedDate: b.date,
      bookedAt: b.at || `${b.date} 23:59:58`,
      text: 'Saldo-Korrektur',
      amount: b.diff,
      source: 'correction',
      status: 'open',
      positionId: null,
      override: true,
    })
  }

  return (
    <Card
      title={<TextInput value={a.name} onChange={(v) => set((x) => { x.name = v })} className="-ml-2 text-[16px] font-semibold" />}
      subtitle={
        <select value={a.type} onChange={(e) => set((x) => { x.type = e.target.value })} className="-ml-1 rounded bg-transparent px-1 text-[13px] text-ink-3 outline-none hover:bg-surface-2">
          {Object.entries(ACCOUNT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      }
      actions={
        <IconButton
          title="Konto löschen"
          className="hover:text-bad"
          onClick={() => {
            const n = tx.transactions.filter((t) => t.accountId === a.id).length
            if (confirm(n ? `Konto «${a.name}» löschen? ${n} Buchungen bleiben erhalten, aber ohne Konto.` : `Konto «${a.name}» löschen?`)) update((d) => { d.accounts.splice(index, 1) })
          }}
        >
          {Icon.trash}
        </IconButton>
      }
    >
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Kennzahlen */}
        <div className="space-y-3">
          <div>
            <div className="text-[12px] text-ink-3">Berechneter Saldo</div>
            <div className="num text-[24px] font-semibold">{fmtCHF(current.amount)}</div>
            <div className="text-[12px] text-ink-3">{current.since ? `ab Saldo vom ${fmtDate(current.since)} + spätere Buchungen` : 'noch kein Saldo eingetragen'}</div>
          </div>
          <div className="text-[13px] text-ink-2">
            {monthLabel(month)}: {monthTx.length} Buchungen · Abflüsse {fmtCHF(outflow)}
          </div>
          {funded.length > 0 && (
            <div className="rounded-lg bg-surface-2 px-3 py-2 text-[13px]">
              <div className="flex justify-between"><span className="text-ink-2">Budget finanzierter Positionen</span><span className="num">{fmtCHF(plan)}</span></div>
              <div className="flex justify-between"><span className="text-ink-2">Effektiv zugeordnet</span><span className={`num ${fundedActual > plan ? 'text-bad' : 'text-good'}`}>{fmtCHF(fundedActual)}</span></div>
            </div>
          )}
        </div>

        {/* Finanzierte Positionen */}
        <div>
          <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-3">Finanziert Positionen</div>
          <div className="flex flex-wrap gap-1.5">
            {funded.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pl-2.5 pr-1 text-[12px]">
                {p.name}
                <button className="grid size-4 place-items-center rounded-full text-ink-3 hover:bg-line hover:text-ink" onClick={() => set((x) => { x.funds = x.funds.filter((id) => id !== p.id) })} title="Entfernen">×</button>
              </span>
            ))}
          </div>
          <div className="mt-2 rounded-lg border border-line">
            <PositionSelect data={data} value="" placeholder="+ Position hinzufügen" onChange={(v) => v && set((x) => { x.funds = [...new Set([...(x.funds || []), v])] })} />
          </div>
          <Button
            variant="ghost"
            className="-ml-3 mt-1"
            onClick={() => {
              const g = data.groups.find((gr) => a.name.toLowerCase().includes(gr.name.toLowerCase()))
              if (g) set((x) => { x.funds = [...new Set([...(x.funds || []), ...g.items.map((it) => it.id)])] })
              else alert('Keine Budget-Gruppe mit passendem Namen gefunden. Positionen einzeln hinzufügen.')
            }}
          >
            Ganze Gruppe nach Kontoname übernehmen
          </Button>
        </div>

        {/* Saldo-Abgleich */}
        <div>
          <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-3">Saldo-Abgleich</div>
          <div className="flex items-center gap-1.5">
            <input type="date" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} className="num w-[136px] rounded-md border border-line bg-surface px-1.5 py-1 text-[13px] outline-none focus:border-accent" />
            <div className="w-28 rounded-md border border-line"><AmountInput value={entry.amount} onChange={(v) => setEntry({ ...entry, amount: v })} /></div>
            <Button onClick={addBalance}>Eintragen</Button>
          </div>
          <div className="mt-2 max-h-56 overflow-y-auto">
            {checks.length === 0 && <p className="text-[12px] text-ink-3">Der erste eingetragene Saldo dient als Startpunkt.</p>}
            {checks.map((b) => (
              <div key={b.id} className="group flex items-center gap-2 border-b border-line py-1.5 text-[13px] last:border-b-0">
                <span className="num w-20 text-ink-2">{fmtDate(b.date)}</span>
                <span className="num flex-1 text-right">{fmtCHF(b.amount)}</span>
                <span className="w-36 text-right">
                  {b.expected === null ? (
                    <Badge>Start</Badge>
                  ) : Math.abs(b.diff) < 0.005 ? (
                    <Badge tone="good">{Icon.check} stimmt</Badge>
                  ) : (
                    <button onClick={() => correction(b)} title={`Erwartet ${fmtCHF(b.expected)} – Korrekturbuchung über ${fmtCHF(b.diff)} erstellen`}>
                      <Badge tone="bad">Diff {fmtCHF(b.diff)} → korrigieren</Badge>
                    </button>
                  )}
                </span>
                <span className="w-5">{b.source === 'csv' ? <span className="text-[10px] text-ink-3" title="aus CSV-Import">CSV</span> : null}</span>
                <IconButton title="Saldo löschen" className="opacity-0 group-hover:opacity-100 hover:text-bad" onClick={() => tx.removeBalance(b.id)}>{Icon.trash}</IconButton>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}
