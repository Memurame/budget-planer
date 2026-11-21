import { useState } from 'react'
import { Card, Button, IconButton, AmountInput, Icon, Field, Segmented, inputCls } from './ui.jsx'
import PositionSelect from './PositionSelect.jsx'
import SplitEditor from './SplitEditor.jsx'
import { fmtCHF, fmtDate } from '../lib/format.js'
import { monthLabel, uid } from '../lib/calc.js'
import { monthOf, yearOf } from '../lib/tx.js'
import { RECURRING_INTERVALS, nextOccurrence, todayStr } from '../lib/recurring.js'

const KINDS = [
  ['expense', 'Ausgabe'],
  ['credit', 'Gutschrift'],
  ['transfer', 'Umbuchung'],
]
const INTERVALS = RECURRING_INTERVALS.map(([v, l]) => [v, l[0].toUpperCase() + l.slice(1)])
const REPEAT = [[0, 'Einmalig'], ...INTERVALS]
const LAST_ACCOUNT = 'lastManualAccount'

/**
 * Buchung erfassen: Ausgabe, Gutschrift oder Umbuchung zwischen zwei Konten –
 * einmalig oder wiederkehrend (monatlich, vierteljährlich, jährlich).
 */
/**
 * `initial` füllt das Formular vor (z. B. aus einer offenen Zahlung); dann nur Ausgabe, ohne Wiederholung.
 * `recurring`: nur wiederkehrende Buchungen (Tab «Wiederkehrend») – ohne «Einmalig», Start mit «Monatlich».
 */
export default function EntryForm({ data, update, tx, month, onDone, onCancel, initial, recurring }) {
  const today = todayStr()
  const accounts = data.accounts
  const remembered = (() => { try { return localStorage.getItem(LAST_ACCOUNT) } catch { return null } })()
  const defaultAccount = accounts.find((a) => a.id === remembered)?.id || accounts[0]?.id || ''
  const [f, setF] = useState({
    kind: 'expense',
    date: initial?.date || (today.startsWith(month) ? today : `${month}-01`),
    text: initial?.text || '',
    amount: initial?.amount || 0,
    accountId: (initial?.accountId && accounts.some((a) => a.id === initial.accountId) ? initial.accountId : defaultAccount),
    toAccountId: accounts.find((a) => a.id !== defaultAccount)?.id || '',
    positionId: initial?.positionId || null,
    splits: initial?.splits?.length ? initial.splits : null, // Aufteilung (aus einer offenen Zahlung)
    repeat: recurring ? INTERVALS[0][0] : 0,
    endMonth: '',
  })
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const [editSplit, setEditSplit] = useState(false)
  const transfer = f.kind === 'transfer'
  const needsAccount = accounts.length > 0

  const problems = [
    !(f.amount > 0) && 'Betrag fehlt',
    !transfer && !f.text.trim() && 'Text fehlt',
    needsAccount && !f.accountId && 'Konto fehlt',
    !transfer && f.splits && Math.abs(f.splits.reduce((s, x) => s + Math.abs(x.amount), 0) - f.amount) >= 0.005 && 'Aufteilung passt nicht zum Betrag – bitte anpassen',
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
        positionId: transfer || f.splits ? null : f.positionId,
        ...(!transfer && f.splits ? { splits: f.splits.map((x) => ({ positionId: x.positionId, amount: Math.abs(x.amount) })) } : {}),
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
        status: f.positionId || f.splits ? 'manual' : 'open',
        positionId: f.splits ? null : f.positionId,
        ...(f.splits ? { splits: f.splits.map((x) => ({ positionId: x.positionId, amount: f.kind === 'credit' ? Math.abs(x.amount) : -Math.abs(x.amount) })) } : {}),
      })
      onDone(`Buchung «${text}» erfasst.`)
    }
  }

  const accountOptions = accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)

  return (
    <Card
      title={initial ? 'Offene Zahlung als Buchung erfassen' : 'Buchung erfassen'}
      subtitle={
        initial
          ? 'Betrag, Datum, Konto und Position bei Bedarf anpassen. Nach dem Speichern verschwindet die offene Zahlung.'
          : 'Für Zahlungen ohne Kontoauszug, z. B. direkt vom Lohnkonto, oder für Umbuchungen zwischen eigenen Konten'
      }
      actions={initial ? null : <Segmented value={f.kind} options={KINDS} onChange={(v) => set('kind', v)} />}
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
            <Field as="div" label="Position" className="md:col-span-6">
              {f.splits ? (
                <button type="button" onClick={() => setEditSplit((v) => !v)} className={`${inputCls} flex items-center gap-1.5 text-left hover:bg-surface-2`} title="Aufteilung bearbeiten">
                  {Icon.split}<span className="truncate">Aufgeteilt auf {f.splits.length} Positionen</span>
                </button>
              ) : (
                <div className="flex items-center gap-1">
                  <div className={`${inputCls} flex items-center px-1`}>
                    <PositionSelect data={data} month={f.date ? f.date.slice(0, 7) : undefined} value={f.positionId} onChange={(v) => set('positionId', v)} />
                  </div>
                  <IconButton
                    type="button"
                    title={f.amount > 0 ? 'Auf mehrere Positionen aufteilen' : 'Zuerst den Betrag eingeben'}
                    disabled={!(f.amount > 0)}
                    className={`shrink-0 disabled:opacity-40 ${editSplit ? 'text-accent' : ''}`}
                    onClick={(e) => { e.preventDefault(); setEditSplit((v) => !v) }}
                  >
                    {Icon.split}
                  </IconButton>
                </div>
              )}
            </Field>
            {editSplit && (
              <div className="rounded-lg border border-line bg-surface-2/40 px-4 py-3 md:col-span-12">
                <SplitEditor
                  data={data}
                  t={{ text: f.text || 'Buchung', amount: f.kind === 'credit' ? Math.abs(f.amount) : -Math.abs(f.amount), date: f.date, positionId: f.positionId, splits: f.splits }}
                  onCancel={() => setEditSplit(false)}
                  onSave={(splits) => { set('splits', splits); setEditSplit(false) }}
                />
              </div>
            )}
          </>
        )}

        <div className="flex flex-wrap items-end gap-4 md:col-span-12">
          {!initial && (
            <Field label="Wiederholen">
              <Segmented value={f.repeat} options={recurring ? INTERVALS : REPEAT}onChange={(v) => set('repeat', v)} />
            </Field>
          )}
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
