import { useMemo, useState } from 'react'
import { Card, Button, IconButton, Badge, Icon, AmountInput, TextInput, Stat, askDelete } from './ui.jsx'
import PositionSelect from './PositionSelect.jsx'
import { fmtCHF, fmtDate } from '../lib/format.js'
import { itemMonthly, monthLabel, uid } from '../lib/calc.js'
import { ACCOUNT_TYPES, allPositions, balanceCheck, monthOf, yearOf } from '../lib/tx.js'
import { accountTree, nodeBalances, parentCandidates, reconcileStatus, reserveTarget } from '../lib/accounts.js'
import { todayStr } from '../lib/recurring.js'

const lastDayOf = (key) => {
  const [y, m] = key.split('-').map(Number)
  return `${key}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}

export default function Accounts({ data, update, month, tx, setView }) {
  const [name, setName] = useState('')
  const [open, setOpen] = useState(() => new Set())
  const toggle = (id) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const positions = useMemo(() => allPositions(data), [data])
  const tree = useMemo(() => accountTree(data.accounts), [data.accounts])
  const nodes = useMemo(
    () => tree.map((node) => ({ ...node, ...nodeBalances(node, tx.balances, tx.transactions) })),
    [tree, tx.balances, tx.transactions],
  )
  const today = todayStr()
  const total = nodes.reduce((s, n) => s + n.total, 0)
  const childIds = new Set(tree.flatMap((n) => n.children.map((c) => c.id)))
  const statuses = Object.fromEntries(
    data.accounts.map((a) => [a.id, reconcileStatus(a, tx.balances, tx.transactions, today, { child: childIds.has(a.id) })]),
  )
  const attention = Object.values(statuses).filter((s) => s && s.tone !== 'good').length
  const withoutAccount = data.accounts.length ? tx.transactions.filter((t) => !t.accountId && monthOf(t.date) === month).length : 0

  const add = () => {
    update((d) => { d.accounts.push({ id: uid(), name: name.trim() || 'Neues Konto', type: 'pocket', funds: [] }) })
    setName('')
  }

  const rowProps = { data, update, month, tx, positions, statuses, open, toggle }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total aller Konten" value={fmtCHF(total)} hint="berechnet aus Salden und Buchungen" />
        <Stat
          label="Abgleich"
          value={attention ? `${attention} offen` : 'Alles ok'}
          tone={attention ? undefined : 'good'}
          hint={attention ? 'Konten mit Differenz oder fälligem Saldo' : 'alle Salden stimmen'}
        />
        <Stat
          label={`Ohne Konto · ${monthLabel(month)}`}
          value={withoutAccount}
          hint={withoutAccount ? <button className="text-accent hover:underline" onClick={() => setView('transactions')}>In Buchungen zuordnen →</button> : 'alle Buchungen haben ein Konto'}
        />
      </div>

      <Card padded={false}>
        <div className="grid grid-cols-[28px_1fr_auto] items-center gap-3 border-b border-line px-4 py-2 text-[12px] font-medium uppercase tracking-wide text-ink-3 md:grid-cols-[28px_1fr_120px_180px_130px]">
          <span />
          <span>Konto</span>
          <span className="hidden md:block">Status</span>
          <span className="hidden md:block">Budget {monthLabel(month, false)}</span>
          <span className="text-right">Saldo</span>
        </div>
        {nodes.length === 0 && <p className="px-5 py-6 text-[13px] text-ink-3">Noch keine Konten. Lege unten ein Konto an oder importiere einen Kontoauszug unter «Buchungen».</p>}
        {nodes.map((n) => (
          <div key={n.account.id} className="border-b border-line last:border-b-0">
            <AccountRow account={n.account} balance={n.groupOnly ? { amount: n.childSum, since: null } : n.own} groupOnly={n.groupOnly} {...rowProps} />
            {n.kids.map((k) => (
              <AccountRow key={k.account.id} account={k.account} balance={k.balance} child {...rowProps} />
            ))}
            {n.unassigned !== null && Math.abs(n.unassigned) >= 0.005 && (
              <div
                className="grid grid-cols-[28px_1fr_auto] items-center gap-3 px-4 py-1.5 text-[13px] text-ink-3 md:grid-cols-[28px_1fr_120px_180px_130px]"
                title="Saldo des Kontos minus Summe der Unterkonten – Geld, das keinem Unterkonto zugeordnet ist (oder fehlende Buchungen bei den Unterkonten)."
              >
                <span />
                <span className="pl-6 italic">nicht auf Unterkonten verteilt</span>
                <span className="hidden md:block" />
                <span className="hidden md:block" />
                <span className="num text-right">{fmtCHF(n.unassigned)}</span>
              </div>
            )}
          </div>
        ))}
      </Card>

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

      <p className="text-[12px] text-ink-3">
        Konten sind die Orte, von denen bezahlt wird (Girokonto, Pockets, externe Konten); jede Buchung gehört zusätzlich zu einer Budget-Position.
        Pockets lassen sich einem Bank-Produkt unterordnen (z. B. «Erspartes»): Der Saldo-Abgleich läuft dann auf dem Produkt, so wie es im CSV steht.
      </p>
    </div>
  )
}

/** Eine Zeile der Kontenliste; aufgeklappt mit Details. */
function AccountRow({ account: a, balance, child, groupOnly, data, update, month, tx, positions, statuses, open, toggle }) {
  const isOpen = open.has(a.id)
  const status = statuses[a.id]
  const funded = positions.filter((p) => (a.funds || []).includes(p.id))
  const plan = funded.reduce((s, p) => s + (data.annual.includes(p.item) ? 0 : itemMonthly(p.item, month)), 0)
  const actual = funded.reduce((s, p) => s + (tx.actual[p.id] || 0), 0)
  const reserves = funded.filter((p) => p.periodic).map((p) => reserveTarget(p.item, month, tx.transactions)).filter((v) => v !== null)
  const reserveSoll = reserves.length ? reserves.reduce((s, v) => s + v, 0) : null
  const reserveDiff = reserveSoll === null ? null : Math.round((balance.amount - reserveSoll) * 100) / 100

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => toggle(a.id)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle(a.id))}
        className={`grid cursor-pointer grid-cols-[28px_1fr_auto] items-center gap-3 px-4 py-2.5 transition hover:bg-surface-2 md:grid-cols-[28px_1fr_120px_180px_130px] ${isOpen ? 'bg-surface-2' : ''}`}
      >
        <span className={`grid size-6 place-items-center text-ink-3 transition ${isOpen ? '' : '-rotate-90'}`}>{Icon.down}</span>
        <div className={`min-w-0 ${child ? 'border-l border-line pl-5' : ''}`}>
          <div className={`truncate text-[14px] ${child ? '' : 'font-medium'}`}>{a.name}</div>
          <div className="truncate text-[12px] text-ink-3">
            {ACCOUNT_TYPES[a.type] || a.type}
            {groupOnly && ' · Summe der Unterkonten'}
            {reserveSoll !== null && (
              <span className={Math.abs(reserveDiff) < 0.005 ? '' : reserveDiff < 0 ? 'text-bad' : 'text-good'} title="Berechneter Saldo verglichen mit dem Soll-Stand der finanzierten Rücklagen am Monatsende">
                {' · '}Rücklagen-Soll {fmtCHF(reserveSoll)}
                {Math.abs(reserveDiff) >= 0.005 && ` (${reserveDiff > 0 ? '+' : ''}${fmtCHF(reserveDiff)})`}
              </span>
            )}
          </div>
        </div>
        <div className="hidden md:block">{status && <Badge tone={status.tone} title={status.title}>{status.label}</Badge>}</div>
        <div className="hidden md:block">
          {plan > 0 || actual > 0 ? (
            <div title={`Budget ${fmtCHF(plan)} · effektiv ${fmtCHF(actual)}`}>
              <div className="mb-1 flex justify-between text-[11px] text-ink-3">
                <span className={`num ${actual > plan ? 'text-bad' : ''}`}>{fmtCHF(actual)}</span>
                <span className="num">von {fmtCHF(plan)}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                <div className={`h-full rounded-full ${actual > plan ? 'bg-bad' : 'bg-accent'}`} style={{ width: `${Math.min(100, plan ? (actual / plan) * 100 : 100)}%` }} />
              </div>
            </div>
          ) : (
            <span className="text-[12px] text-ink-3">–</span>
          )}
        </div>
        <div className={`num text-right ${child ? 'text-[14px]' : 'text-[15px] font-semibold'}`}>{fmtCHF(balance.amount)}</div>
      </div>
      {isOpen && <AccountDetails account={a} funded={funded} plan={plan} actual={actual} balance={balance} data={data} update={update} month={month} tx={tx} />}
    </>
  )
}

const TABS = [
  ['abgleich', 'Saldo-Abgleich'],
  ['buchungen', 'Buchungen'],
  ['finanziert', 'Finanzierte Positionen'],
  ['einstellungen', 'Einstellungen'],
]

function AccountDetails({ account: a, funded, plan, actual, balance, data, update, month, tx }) {
  const [tab, setTab] = useState('abgleich')
  const set = (fn) => update((d) => { const x = d.accounts.find((y) => y.id === a.id); if (x) fn(x) })

  return (
    <div className="border-t border-line bg-surface-2/40 px-4 pb-4 pt-2 md:pl-[52px]">
      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-lg px-3 py-1.5 text-[13px] transition ${tab === id ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'abgleich' && <Reconcile account={a} balance={balance} month={month} tx={tx} />}
      {tab === 'buchungen' && <MonthTransactions account={a} month={month} tx={tx} positions={allPositions(data)} />}
      {tab === 'finanziert' && <Funding account={a} funded={funded} plan={plan} actual={actual} data={data} set={set} month={month} />}
      {tab === 'einstellungen' && <AccountSettings account={a} data={data} update={update} set={set} tx={tx} />}
    </div>
  )
}

function Reconcile({ account: a, balance, month, tx }) {
  const [entry, setEntry] = useState({ date: lastDayOf(month), amount: 0 })
  const checks = balanceCheck(a, tx.balances, tx.transactions).slice().reverse()

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
    <div className="grid gap-5 md:grid-cols-[220px_1fr]">
      <div>
        <div className="text-[12px] text-ink-3">Berechneter Saldo</div>
        <div className="num text-[22px] font-semibold">{fmtCHF(balance.amount)}</div>
        <div className="text-[12px] text-ink-3">{balance.since ? `ab Saldo vom ${fmtDate(balance.since)} + spätere Buchungen` : 'noch kein Saldo eingetragen'}</div>
        <div className="mt-3 text-[12px] text-ink-3">Tatsächlichen Saldo eintragen</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <input type="date" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} className="num w-[136px] rounded-md border border-line bg-surface px-1.5 py-1 text-[13px] outline-none focus:border-accent" />
          <div className="w-28 rounded-md border border-line bg-surface"><AmountInput value={entry.amount} onChange={(v) => setEntry({ ...entry, amount: v })} /></div>
          <Button onClick={addBalance}>Eintragen</Button>
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {checks.length === 0 && <p className="text-[12px] text-ink-3">Der erste eingetragene Saldo dient als Startpunkt. Beim CSV-Import wird der Kontostand automatisch übernommen.</p>}
        {checks.map((b) => (
          <div key={b.id} className="group flex items-center gap-2 border-b border-line py-1.5 text-[13px] last:border-b-0">
            <span className="num w-20 text-ink-2">{fmtDate(b.date)}</span>
            <span className="num flex-1 text-right">{fmtCHF(b.amount)}</span>
            <span className="w-44 text-right">
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
            <span className="w-6">{b.source === 'csv' ? <span className="text-[10px] text-ink-3" title="aus CSV-Import">CSV</span> : null}</span>
            <IconButton title="Saldo löschen" className="opacity-0 group-hover:opacity-100 hover:text-bad" onClick={() => tx.removeBalance(b.id)}>{Icon.trash}</IconButton>
          </div>
        ))}
      </div>
    </div>
  )
}

function MonthTransactions({ account: a, month, tx, positions }) {
  const list = tx.transactions.filter((t) => t.accountId === a.id && monthOf(t.date) === month).sort((x, y) => y.date.localeCompare(x.date))
  const counted = list.filter((t) => t.status !== 'ignored')
  const outflow = counted.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0)
  const inflow = counted.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const posName = (t) => (t.splits?.length ? 'Aufgeteilt' : positions.find((p) => p.id === t.positionId)?.name)
  if (!list.length) return <p className="text-[13px] text-ink-3">Keine Buchungen in {monthLabel(month)}.</p>
  return (
    <div>
      <div className="mb-2 text-[13px] text-ink-2">
        {list.length} Buchungen · Abflüsse <span className="num">{fmtCHF(outflow)}</span> · Zuflüsse <span className="num">{fmtCHF(inflow)}</span>
        <span className="text-ink-3"> (ohne ignorierte)</span>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {list.map((t) => (
          <div key={t.id} className={`flex items-center gap-3 border-b border-line py-1.5 text-[13px] last:border-b-0 ${t.status === 'ignored' ? 'text-ink-3' : ''}`}>
            <span className="num w-20 shrink-0 text-ink-2">{fmtDate(t.date)}</span>
            <span className="min-w-0 flex-1 truncate">{t.text}</span>
            <span className="hidden w-40 shrink-0 truncate text-[12px] text-ink-3 sm:block">{t.status === 'ignored' ? 'ignoriert' : posName(t) || 'nicht zugeordnet'}</span>
            <span className={`num w-28 shrink-0 text-right ${t.amount > 0 ? 'text-good' : ''}`}>{fmtCHF(t.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Funding({ account: a, funded, plan, actual, data, set }) {
  return (
    <div className="grid gap-5 md:grid-cols-[220px_1fr]">
      <div className="text-[13px]">
        <div className="flex justify-between"><span className="text-ink-2">Budget</span><span className="num">{fmtCHF(plan)}</span></div>
        <div className="flex justify-between"><span className="text-ink-2">Effektiv zugeordnet</span><span className={`num ${actual > plan ? 'text-bad' : 'text-good'}`}>{fmtCHF(actual)}</span></div>
        <p className="mt-2 text-[12px] text-ink-3">Rücklagen unter den finanzierten Positionen ergeben das Rücklagen-Soll, das mit dem Saldo verglichen wird.</p>
      </div>
      <div>
        <div className="flex flex-wrap gap-1.5">
          {funded.length === 0 && <span className="text-[12px] text-ink-3">Noch keine Positionen.</span>}
          {funded.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-surface py-0.5 pl-2.5 pr-1 text-[12px] ring-1 ring-line">
              {p.name}{p.periodic && <span className="text-ink-3" title="Rücklage">↻</span>}
              <button className="grid size-4 place-items-center rounded-full text-ink-3 hover:bg-line hover:text-ink" onClick={() => set((x) => { x.funds = x.funds.filter((id) => id !== p.id) })} title="Entfernen">×</button>
            </span>
          ))}
        </div>
        <div className="mt-2 max-w-sm rounded-lg border border-line bg-surface">
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
    </div>
  )
}

function AccountSettings({ account: a, data, update, set, tx }) {
  const candidates = parentCandidates(a, data.accounts)
  const hasChildren = data.accounts.some((c) => c.parentId === a.id)
  const remove = async () => {
    const n = tx.transactions.filter((t) => t.accountId === a.id).length
    const kids = data.accounts.filter((c) => c.parentId === a.id).length
    const msg = [
      n ? `${n} Buchungen bleiben erhalten, sind danach aber keinem Konto mehr zugeordnet.` : 'Das Konto wird entfernt.',
      kids ? `${kids} Unterkonten werden zu eigenständigen Konten.` : '',
    ].filter(Boolean).join(' ')
    const ok = await askDelete({ title: `Konto «${a.name}» löschen?`, message: msg })
    if (ok) update((d) => {
      d.accounts = d.accounts.filter((x) => x.id !== a.id)
      for (const c of d.accounts) if (c.parentId === a.id) delete c.parentId
    })
  }
  const label = 'mb-1 text-[12px] text-ink-3'
  const field = 'rounded-md border border-line bg-surface px-2 py-1 text-[13px] outline-none focus:border-accent'
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <div className={label}>Name</div>
        <div className="w-56 rounded-md border border-line bg-surface"><TextInput value={a.name} onChange={(v) => set((x) => { x.name = v })} className="text-[13px]" /></div>
      </div>
      <div>
        <div className={label}>Art</div>
        <select value={a.type} onChange={(e) => set((x) => { x.type = e.target.value })} className={field}>
          {Object.entries(ACCOUNT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <div>
        <div className={label}>Gehört zu</div>
        <select
          value={a.parentId || ''}
          disabled={hasChildren}
          title={hasChildren ? 'Dieses Konto hat selbst Unterkonten' : 'z. B. Pocket → Revolut «Erspartes»'}
          onChange={(e) => set((x) => { if (e.target.value) x.parentId = e.target.value; else delete x.parentId })}
          className={`${field} disabled:opacity-50`}
        >
          <option value="">– eigenständig –</option>
          {candidates.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <Button variant="danger" className="ml-auto" onClick={remove}>{Icon.trash} Konto löschen</Button>
    </div>
  )
}
