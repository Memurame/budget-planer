import { useState } from 'react'
import { Card, Button, AmountInput, Icon } from './ui.jsx'
import PositionSelect from './PositionSelect.jsx'
import { fmtCHF, fmtDate } from '../lib/format.js'
import { monthLabel, uid } from '../lib/calc.js'
import { monthOf, yearOf } from '../lib/tx.js'
import { RECURRING_INTERVALS, nextOccurrence, todayStr } from '../lib/recurring.js'

const KINDS = [
  ['expense', 'Ausgabe'],
  ['credit', 'Gutschrift'],
  ['transfer', 'Umbuchung'],
]
const REPEAT = [[0, 'Einmalig'], ...RECURRING_INTERVALS.map(([v, l]) => [v, l[0].toUpperCase() + l.slice(1)])]
const LAST_ACCOUNT = 'lastManualAccount'

function Segmented({ value, options, onChange }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1 text-[13px] transition ${value === v ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-surface-2'}`}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

const Field = ({ label, children, className = '', hint }) => (
  <label className={`flex flex-col gap-1 text-[12px] font-medium text-ink-3 ${className}`}>
    {label}
    {children}
    {hint && <span className="text-[11px] font-normal text-ink-3">{hint}</span>}
  </label>
)
const inputCls = 'h-9 w-full rounded-lg border border-line bg-surface px-3 text-[14px] font-normal text-ink outline-none focus:border-accent'

/**
 * Buchung erfassen: Ausgabe, Gutschrift oder Umbuchung zwischen zwei Konten –
 * einmalig oder wiederkehrend (monatlich, vierteljährlich, jährlich).
 */
export default function EntryForm({ data, update, tx, month, onDone, onCancel }) {
  const today = todayStr()
  const accounts = data.accounts
  const remembered = (() => { try { return localStorage.getItem(LAST_ACCOUNT) } catch { return null } })()
  const defaultAccount = accounts.find((a) => a.id === remembered)?.id || accounts[0]?.id || ''
  const [f, setF] = useState({
    kind: 'expense',
    date: today.startsWith(month) ? today : `${month}-01`,
    text: '',
    amount: 0,
    accountId: defaultAccount,
    toAccountId: accounts.find((a) => a.id !== defaultAccount)?.id || '',
    positionId: null,
    repeat: 0,
    endMonth: '',
  })
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const transfer = f.kind === 'transfer'
  const needsAccount = accounts.length > 0

  const problems = [
    !(f.amount > 0) && 'Betrag fehlt',
    !transfer && !f.text.trim() && 'Text fehlt',
    needsAccount && !f.accountId && 'Konto fehlt',
    transfer && (!f.toAccountId || f.toAccountId === f.accountId) && 'Zwei verschiedene Konten wählen',
    transfer && accounts.length < 2 && 'Für eine Umbuchung braucht es mindestens zwei Konten',
  ].filter(Boolean)

  const save = async () => {
    if (problems.length) return
    const text = f.text.trim() || 'Umbuchung'
    try { localStorage.setItem(LAST_ACCOUNT, f.accountId) } catch {}

    if (f.repeat) {
      const tpl = {
        id: uid(),
        kind: f.kind,
        text,
        amount: Math.abs(f.amount),
        accountId: f.accountId || null,
        toAccountId: transfer ? f.toAccountId : undefined,
        positionId: transfer ? null : f.positionId,
        interval: f.repeat,
        day: Number(f.date.slice(8, 10)),
        startMonth: monthOf(f.date),
        endMonth: f.endMonth || undefined,
      }
      update((d) => { d.recurring = [...(d.recurring || []), tpl] })
      const next = nextOccurrence(tpl, today)
      onDone(`Wiederkehrende Buchung «${text}» angelegt${f.date <= today ? ' – fällige Termine bis heute wurden erzeugt' : ''}${next ? `, nächste am ${fmtDate(next)}` : ''}.`)
      return
    }

    if (tx.isClosed(monthOf(f.date)) && !confirm(`${monthLabel(monthOf(f.date))} ist abgeschlossen. Trotzdem erfassen?`)) return
    await tx.ensureYears([yearOf(f.date)])
    const base = { date: f.date, bookedDate: f.date, text, source: 'manual', override: true }
    if (transfer) {
      const a = `man-${uid()}`, b = `man-${uid()}`
      tx.addTx([
        { ...base, id: a, accountId: f.accountId, amount: -Math.abs(f.amount), status: 'ignored', positionId: null, linkedId: b, kind: 'Umbuchung' },
        { ...base, id: b, accountId: f.toAccountId, amount: Math.abs(f.amount), status: 'ignored', positionId: null, linkedId: a, kind: 'Umbuchung' },
      ])
      const from = accounts.find((x) => x.id === f.accountId)?.name, to = accounts.find((x) => x.id === f.toAccountId)?.name
      onDone(`Umbuchung ${fmtCHF(f.amount)} von «${from}» nach «${to}» erfasst.`)
    } else {
      tx.addTx({
        ...base,
        id: `man-${uid()}`,
        accountId: f.accountId || null,
        amount: f.kind === 'credit' ? Math.abs(f.amount) : -Math.abs(f.amount),
        status: f.positionId ? 'manual' : 'open',
        positionId: f.positionId,
      })
      onDone(`Buchung «${text}» erfasst.`)
    }
  }

  const accountOptions = accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)

  return (
    <Card
      title="Buchung erfassen"
      subtitle="Für Zahlungen ohne Kontoauszug, z. B. direkt vom Lohnkonto, oder für Umbuchungen zwischen eigenen Konten"
      actions={<Segmented value={f.kind} options={KINDS} onChange={(v) => set('kind', v)} />}
    >
      <form
        onSubmit={(e) => { e.preventDefault(); save() }}
        className="grid gap-x-4 gap-y-3 md:grid-cols-12"
      >
        <Field label="Datum" className="md:col-span-3" hint={f.repeat ? 'erster Termin; Tag gilt für alle Wiederholungen' : undefined}>
          <input type="date" value={f.date} onChange={(e) => e.target.value && set('date', e.target.value)} className={`${inputCls} num`} />
        </Field>
        <Field label="Betrag (CHF)" className="md:col-span-3">
          <div className={`${inputCls} flex items-center gap-1 px-1`}>
            <span className={`pl-2 text-[15px] font-semibold ${f.kind === 'credit' ? 'text-good' : f.kind === 'expense' ? 'text-bad' : 'text-ink-3'}`}>
              {f.kind === 'credit' ? '+' : f.kind === 'expense' ? '−' : '⇄'}
            </span>
            <AmountInput value={f.amount} onChange={(v) => set('amount', Math.abs(v))} className="h-7" />
          </div>
        </Field>
        <Field label={transfer ? 'Text (optional)' : 'Text'} className="md:col-span-6">
          <input value={f.text} onChange={(e) => set('text', e.target.value)} placeholder={transfer ? 'z. B. Einzahlung Ferien-Space' : f.kind === 'credit' ? 'z. B. Rückerstattung Krankenkasse' : 'z. B. Versicherung'} className={inputCls} />
        </Field>

        {transfer ? (
          <>
            <Field label="Von Konto" className="md:col-span-6">
              <select value={f.accountId} onChange={(e) => set('accountId', e.target.value)} className={inputCls}>{accountOptions}</select>
            </Field>
            <Field label="Nach Konto" className="md:col-span-6" hint="Umbuchungen zählen nicht als Ausgabe; beide Konten werden im Saldo-Abgleich berücksichtigt.">
              <select value={f.toAccountId} onChange={(e) => set('toAccountId', e.target.value)} className={inputCls}>
                <option value="">– wählen –</option>
                {accountOptions}
              </select>
            </Field>
          </>
        ) : (
          <>
            <Field label="Konto" className="md:col-span-6">
              {needsAccount ? (
                <select value={f.accountId} onChange={(e) => set('accountId', e.target.value)} className={inputCls}>{accountOptions}</select>
              ) : (
                <div className={`${inputCls} flex items-center text-ink-3`}>Noch keine Konten – unter «Konten» anlegen</div>
              )}
            </Field>
            <Field label="Position" className="md:col-span-6">
              <div className={`${inputCls} flex items-center px-1`}>
                <PositionSelect data={data} value={f.positionId} onChange={(v) => set('positionId', v)} />
              </div>
            </Field>
          </>
        )}

        <div className="flex flex-wrap items-end gap-4 md:col-span-12">
          <Field label="Wiederholen">
            <Segmented value={f.repeat} options={REPEAT} onChange={(v) => set('repeat', v)} />
          </Field>
          {f.repeat > 0 && (
            <Field label="Bis (optional)">
              <input type="month" value={f.endMonth} min={monthOf(f.date)} onChange={(e) => set('endMonth', e.target.value)} className={`${inputCls} num w-44`} />
            </Field>
          )}
          <div className="ml-auto flex items-center gap-3">
            {problems.length > 0 && (f.amount > 0 || f.text) && <span className="text-[12px] text-warn">{problems[0]}</span>}
            <Button type="button" variant="ghost" onClick={onCancel}>Abbrechen</Button>
            <Button type="submit" variant="primary" disabled={problems.length > 0}>
              {Icon.check} {f.repeat ? 'Wiederholung anlegen' : 'Speichern'}
            </Button>
          </div>
        </div>
      </form>
    </Card>
  )
}
