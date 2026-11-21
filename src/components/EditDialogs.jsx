import { useState } from 'react'
import { Button, IconButton, AmountInput, Icon, Field, Segmented, inputCls, Modal } from './ui.jsx'
import PositionSelect from './PositionSelect.jsx'
import SplitEditor from './SplitEditor.jsx'
import { amountAt, monthKey, monthLabel, setAmountAt } from '../lib/calc.js'
import { monthOf, yearOf } from '../lib/tx.js'
import { RECURRING_INTERVALS, nextOccurrence, scaleSplits, todayStr } from '../lib/recurring.js'

/**
 * Bearbeiten-Fenster für Buchungen, Wiederholungen und offene Zahlungen.
 * Intern sind Beträge und Aufteilungen immer positiv; das Vorzeichen kommt erst beim Speichern dazu.
 */

const abs = (splits) => (splits?.length ? splits.map((x) => ({ positionId: x.positionId, amount: Math.abs(x.amount) })) : null)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const INTERVALS = RECURRING_INTERVALS.map(([v, l]) => [v, l[0].toUpperCase() + l.slice(1)])

/** Gemeinsamer Zustand: Formular, Änderung erkannt, Betrag ändern passt die Aufteilung anteilig an. */
function useForm(initial) {
  const [init] = useState(initial)
  const [f, setF] = useState(initial)
  const set = (k, v) => setF((x) => {
    const n = { ...x, [k]: v }
    if (k === 'amount' && x.splits && v > 0) n.splits = scaleSplits(x.splits, v)
    return n
  })
  return { f, set, setF, dirty: !same(f, init), init }
}

/** Position oder Aufteilung, mit Aufteilungs-Editor unter dem Feld. */
function PositionField({ data, f, set, month, text, sign = -1, className = 'md:col-span-6' }) {
  const [edit, setEdit] = useState(false)
  return (
    <>
      <Field as="div" label="Position" className={className}>
        <div className="flex items-center gap-1">
          {f.splits ? (
            <button type="button" onClick={() => setEdit((v) => !v)} className={`${inputCls} flex items-center gap-1.5 text-left hover:bg-surface-2`} title="Aufteilung bearbeiten">
              {Icon.split}<span className="truncate">Aufgeteilt auf {f.splits.length} Positionen</span>
            </button>
          ) : (
            <div className={`${inputCls} flex items-center px-1`}>
              <PositionSelect data={data} month={month} value={f.positionId} onChange={(v) => set('positionId', v)} />
            </div>
          )}
          <IconButton
            type="button"
            title={f.amount > 0 ? 'Auf mehrere Positionen aufteilen' : 'Zuerst den Betrag eingeben'}
            disabled={!(f.amount > 0)}
            className={`shrink-0 disabled:opacity-40 ${edit ? 'text-accent' : ''}`}
            onClick={() => setEdit((v) => !v)}
          >
            {Icon.split}
          </IconButton>
        </div>
      </Field>
      {edit && (
        <div className="rounded-lg border border-line bg-surface-2/40 px-4 py-3 md:col-span-12">
          <SplitEditor
            key={f.amount}
            data={data}
            t={{ text: text || 'Buchung', amount: sign * f.amount, date: `${month}-01`, positionId: f.positionId, splits: f.splits }}
            onCancel={() => setEdit(false)}
            onSave={(splits) => {
              set('splits', abs(splits))
              if (splits) set('positionId', null)
              setEdit(false)
            }}
          />
        </div>
      )}
    </>
  )
}

const Footer = ({ problems, dirty, onCancel, onSave }) => (
  <>
    {problems.length > 0 && dirty && <span className="mr-auto text-[12px] text-warn">{problems[0]}</span>}
    <Button variant="ghost" onClick={onCancel}>Abbrechen</Button>
    <Button variant="primary" disabled={!dirty || problems.length > 0} onClick={onSave}>{Icon.check} Speichern</Button>
  </>
)

const accountOptions = (data) => data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)

// ── Buchung ─────────────────────────────────────────────────────────────────

/**
 * Buchung bearbeiten. CSV-Buchungen: Datum, Betrag und Konto kommen vom Kontoauszug und bleiben fest.
 * Bei einer manuellen Umbuchung werden Datum und Betrag auch auf der Gegenbuchung angepasst.
 */
export function TxEditDialog({ data, tx, t, partner, onClose, onSaved, onOpenRecurring, queueSuggestions }) {
  const csv = t.source === 'csv'
  const ignored = t.status === 'ignored'
  const pair = partner && /Umbuchung/.test(t.kind || '') && partner.source !== 'csv' && !csv ? partner : null
  const { f, set, dirty, init } = useForm({
    date: t.date,
    amount: Math.abs(t.amount),
    credit: t.amount > 0,
    text: t.text,
    accountId: t.accountId || '',
    positionId: t.positionId || null,
    splits: abs(t.splits),
  })

  const problems = [
    !csv && !(f.amount > 0) && 'Betrag fehlt',
    !f.text.trim() && 'Text fehlt',
    !f.date && 'Datum fehlt',
  ].filter(Boolean)

  const save = async () => {
    if (problems.length) return
    const closed = [...new Set([monthOf(t.date), monthOf(f.date)])].filter((m) => tx.isClosed(m))
    if (closed.length && !confirm(`${closed.map(monthLabel).join(', ')} ist abgeschlossen. Trotzdem ändern?`)) return
    if (!csv) await tx.ensureYears([yearOf(f.date)])
    const sign = csv || pair ? Math.sign(t.amount) || -1 : f.credit ? 1 : -1
    const amount = csv ? t.amount : sign * f.amount
    const posChanged = f.positionId !== init.positionId || !same(f.splits, init.splits)
    tx.updateTx(t.id, (x) => {
      x.text = f.text.trim()
      x.override = true
      if (!csv) {
        x.date = f.date
        x.bookedDate = f.date
        x.amount = amount
        x.accountId = f.accountId || null
      }
      if (!ignored && posChanged) {
        x.ruleId = null
        if (f.splits) { x.splits = f.splits.map((s) => ({ positionId: s.positionId, amount: sign * s.amount })); x.positionId = null }
        else { delete x.splits; x.positionId = f.positionId }
        x.status = f.splits || f.positionId ? 'manual' : 'open'
      } else if (!ignored && x.splits && !csv) {
        // Betrag/Art geändert → Aufteilung mit neuem Vorzeichen/Betrag übernehmen
        x.splits = (f.splits || []).map((s) => ({ positionId: s.positionId, amount: sign * s.amount }))
      }
    })
    if (pair && (f.date !== t.date || f.amount !== init.amount)) {
      tx.updateTx(pair.id, (x) => { x.date = f.date; x.bookedDate = f.date; x.amount = -amount; x.override = true })
    }
    if (!ignored && posChanged && f.positionId && !f.splits) queueSuggestions?.([t], f.positionId)
    onSaved?.('Buchung gespeichert.')
    onClose()
  }

  return (
    <Modal
      title="Buchung bearbeiten"
      subtitle={csv ? 'Aus dem Kontoauszug: Datum, Betrag und Konto sind fest.' : pair ? 'Umbuchung: Datum und Betrag werden auch auf der Gegenbuchung angepasst.' : undefined}
      dirty={dirty}
      onClose={onClose}
      footer={<Footer problems={problems} dirty={dirty} onCancel={onClose} onSave={save} />}
    >
      {t.source === 'recurring' && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-[13px] text-ink-2">
          Aus einer Wiederholung erzeugt – Änderungen gelten nur für diesen Termin.
          {onOpenRecurring && <button type="button" className="ml-auto font-medium text-accent hover:underline" onClick={() => (!dirty || confirm('Änderungen verwerfen?')) && onOpenRecurring()}>Zur Wiederholung</button>}
        </div>
      )}
      <div className="grid gap-x-4 gap-y-3 md:grid-cols-12">
        {!csv && !pair && (
          <div className="md:col-span-12">
            <Segmented value={f.credit ? 'credit' : 'expense'} options={[['expense', 'Ausgabe'], ['credit', 'Gutschrift']]} onChange={(v) => set('credit', v === 'credit')} />
          </div>
        )}
        <Field label="Datum" className="md:col-span-4">
          <input type="date" value={f.date} disabled={csv} onChange={(e) => e.target.value && set('date', e.target.value)} className={`${inputCls} num`} />
        </Field>
        <Field label="Betrag (CHF)" className="md:col-span-4">
          {csv ? (
            <div className={`${inputCls} num flex items-center justify-end text-ink-3`}>{(t.amount > 0 ? '+' : '−') + Math.abs(t.amount).toFixed(2)}</div>
          ) : (
            <div className={`${inputCls} flex items-center gap-1 px-1`}>
              <span className={`pl-2 text-[15px] font-semibold ${pair ? 'text-ink-3' : f.credit ? 'text-good' : 'text-bad'}`}>{pair ? '⇄' : f.credit ? '+' : '−'}</span>
              <AmountInput value={f.amount} onChange={(v) => set('amount', Math.abs(v))} className="h-7" />
            </div>
          )}
        </Field>
        <Field label="Konto" className="md:col-span-4">
          <select value={f.accountId} disabled={csv} onChange={(e) => set('accountId', e.target.value)} className={inputCls}>
            <option value="">– ohne Konto –</option>
            {accountOptions(data)}
          </select>
        </Field>
        <Field label="Text" className={ignored ? 'md:col-span-12' : 'md:col-span-6'}>
          <input value={f.text} onChange={(e) => set('text', e.target.value)} className={inputCls} />
        </Field>
        {!ignored && <PositionField data={data} f={f} set={set} month={monthOf(f.date)} text={f.text} sign={csv ? Math.sign(t.amount) || -1 : f.credit ? 1 : -1} />}
      </div>
    </Modal>
  )
}

// ── Wiederholung ────────────────────────────────────────────────────────────

/** Vorlage einer Wiederholung bearbeiten. Gilt für künftige Termine; erzeugte Buchungen bleiben. */
export function RecurringEditDialog({ data, tpl, update, onClose, onSaved }) {
  const transfer = tpl.kind === 'transfer'
  const next = nextOccurrence(tpl, todayStr())
  const fromDefault = next ? next.slice(0, 7) : monthKey()
  const { f, set, setF, dirty, init } = useForm({
    kind: tpl.kind,
    text: tpl.text,
    accountId: tpl.accountId || '',
    toAccountId: tpl.toAccountId || '',
    positionId: tpl.positionId || null,
    splits: abs(tpl.splits),
    amount: amountAt(tpl, fromDefault),
    from: fromDefault,
    interval: tpl.interval,
    day: Number(tpl.day) || 1,
    startMonth: tpl.startMonth,
    endMonth: tpl.endMonth || '',
  })
  // Monat «ab» wechseln → Betrag dieses Monats anzeigen (solange nicht selbst geändert)
  const setFrom = (m) => setF((x) => {
    const amount = x.amount === amountAt(tpl, x.from) ? amountAt(tpl, m) : x.amount
    return { ...x, from: m, amount, splits: x.splits && amount > 0 ? scaleSplits(x.splits, amount) : x.splits }
  })

  const problems = [
    !f.text.trim() && 'Text fehlt',
    !(f.amount > 0) && 'Betrag fehlt',
    !f.from && 'Monat für den Betrag fehlt',
    !(f.day >= 1 && f.day <= 31) && 'Tag muss zwischen 1 und 31 liegen',
    !f.startMonth && 'Start fehlt',
    f.endMonth && f.endMonth < f.startMonth && '«Bis» liegt vor dem Start',
    !f.accountId && 'Konto fehlt',
    transfer && (!f.toAccountId || f.toAccountId === f.accountId) && 'Zwei verschiedene Konten wählen',
  ].filter(Boolean)

  const save = () => {
    if (problems.length) return
    update((d) => {
      const x = (d.recurring || []).find((r) => r.id === tpl.id)
      if (!x) return
      x.text = f.text.trim()
      if (!transfer) x.kind = f.kind
      x.accountId = f.accountId
      if (transfer) x.toAccountId = f.toAccountId
      else if (f.splits) { x.splits = f.splits; x.positionId = null }
      else { delete x.splits; x.positionId = f.positionId }
      if (f.amount !== amountAt(x, f.from)) setAmountAt(x, f.from, f.amount)
      x.interval = Number(f.interval)
      x.day = Number(f.day)
      x.startMonth = f.startMonth
      if (f.endMonth) x.endMonth = f.endMonth
      else delete x.endMonth
    })
    onSaved?.(`Wiederholung «${f.text.trim()}» gespeichert.`)
    onClose()
  }

  return (
    <Modal
      title="Wiederholung bearbeiten"
      subtitle="Gilt für künftige Termine – bereits erzeugte Buchungen bleiben unverändert. Ein früherer Start erzeugt fällige Termine bis heute."
      dirty={dirty}
      onClose={onClose}
      footer={<Footer problems={problems} dirty={dirty} onCancel={onClose} onSave={save} />}
    >
      <div className="grid gap-x-4 gap-y-3 md:grid-cols-12">
        <div className="md:col-span-12">
          {transfer ? (
            <span className="text-[13px] text-ink-3">Umbuchung zwischen zwei Konten</span>
          ) : (
            <Segmented value={f.kind} options={[['expense', 'Ausgabe'], ['credit', 'Gutschrift']]} onChange={(v) => set('kind', v)} />
          )}
        </div>
        <Field label="Text" className="md:col-span-12">
          <input value={f.text} onChange={(e) => set('text', e.target.value)} className={inputCls} />
        </Field>
        <Field label="Betrag (CHF)" className="md:col-span-4">
          <div className={`${inputCls} flex items-center px-1`}><AmountInput value={f.amount} onChange={(v) => set('amount', Math.abs(v))} className="h-7" /></div>
        </Field>
        <Field label="Betrag gilt ab" className="md:col-span-4" hint={f.amount !== init.amount || f.from !== init.from ? 'frühere Termine behalten ihren Betrag' : undefined}>
          <input type="month" value={f.from} onChange={(e) => e.target.value && setFrom(e.target.value)} className={`${inputCls} num`} />
        </Field>
        <Field label={transfer ? 'Von Konto' : 'Konto'} className="md:col-span-4">
          <select value={f.accountId} onChange={(e) => set('accountId', e.target.value)} className={inputCls}>
            <option value="">– wählen –</option>
            {accountOptions(data)}
          </select>
        </Field>
        {transfer ? (
          <Field label="Nach Konto" className="md:col-span-6">
            <select value={f.toAccountId} onChange={(e) => set('toAccountId', e.target.value)} className={inputCls}>
              <option value="">– wählen –</option>
              {accountOptions(data)}
            </select>
          </Field>
        ) : (
          <PositionField data={data} f={f} set={set} month={f.from} text={f.text} sign={f.kind === 'credit' ? 1 : -1} className="md:col-span-12" />
        )}
        <Field label="Intervall" className="md:col-span-3">
          <select value={f.interval} onChange={(e) => set('interval', Number(e.target.value))} className={inputCls}>
            {INTERVALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Tag im Monat" className="md:col-span-3" hint="31 = jeweils Monatsende">
          <input type="number" min={1} max={31} value={f.day} onChange={(e) => set('day', Number(e.target.value))} className={`${inputCls} num`} />
        </Field>
        <Field label="Start" className="md:col-span-3">
          <input type="month" value={f.startMonth} onChange={(e) => e.target.value && set('startMonth', e.target.value)} className={`${inputCls} num`} />
        </Field>
        <Field label="Bis (optional)" className="md:col-span-3">
          <input type="month" value={f.endMonth} min={f.startMonth} onChange={(e) => set('endMonth', e.target.value)} className={`${inputCls} num`} />
        </Field>
      </div>
    </Modal>
  )
}

// ── Offene Zahlung ──────────────────────────────────────────────────────────

/** Offene Zahlung bearbeiten (Aufteilung wird wie bisher mit negativen Beträgen gespeichert). */
export function OpenPaymentEditDialog({ data, p, update, onClose }) {
  const { f, set, dirty } = useForm({
    text: p.text,
    amount: Math.abs(p.amount),
    dueDate: p.dueDate,
    accountId: p.accountId || '',
    positionId: p.positionId || null,
    splits: abs(p.splits),
    note: p.note || '',
  })
  const problems = [!f.text.trim() && 'Text fehlt', !(f.amount > 0) && 'Betrag fehlt', !f.dueDate && 'Fälligkeit fehlt'].filter(Boolean)

  const save = () => {
    if (problems.length) return
    update((d) => {
      const x = (d.openPayments || []).find((o) => o.id === p.id)
      if (!x) return
      Object.assign(x, { text: f.text.trim(), amount: f.amount, dueDate: f.dueDate, accountId: f.accountId || null, note: f.note })
      if (f.splits) { x.splits = f.splits.map((s) => ({ positionId: s.positionId, amount: -s.amount })); x.positionId = null }
      else { delete x.splits; x.positionId = f.positionId }
    })
    onClose()
  }

  return (
    <Modal title="Offene Zahlung bearbeiten" dirty={dirty} onClose={onClose} footer={<Footer problems={problems} dirty={dirty} onCancel={onClose} onSave={save} />}>
      <div className="grid gap-x-4 gap-y-3 md:grid-cols-12">
        <Field label="Text" className="md:col-span-12">
          <input value={f.text} onChange={(e) => set('text', e.target.value)} className={inputCls} />
        </Field>
        <Field label="Betrag (CHF)" className="md:col-span-4">
          <div className={`${inputCls} flex items-center px-1`}><AmountInput value={f.amount} onChange={(v) => set('amount', Math.abs(v))} className="h-7" /></div>
        </Field>
        <Field label="Fällig am" className="md:col-span-4">
          <input type="date" value={f.dueDate} onChange={(e) => e.target.value && set('dueDate', e.target.value)} className={`${inputCls} num`} />
        </Field>
        <Field label="Konto (optional)" className="md:col-span-4">
          <select value={f.accountId} onChange={(e) => set('accountId', e.target.value)} className={inputCls}>
            <option value="">–</option>
            {accountOptions(data)}
          </select>
        </Field>
        <PositionField data={data} f={f} set={set} month={f.dueDate?.slice(0, 7)} text={f.text} className="md:col-span-12" />
        <Field label="Notiz (optional)" className="md:col-span-12">
          <input value={f.note} onChange={(e) => set('note', e.target.value)} className={inputCls} />
        </Field>
      </div>
    </Modal>
  )
}
