import { useState } from 'react'
import { Card, Button, AmountInput, TextInput, Stat, Badge, Icon } from './ui.jsx'
import { fmtCHF, fmtDate } from '../lib/format.js'
import { addMonths, monthKey, monthLabel, uid } from '../lib/calc.js'
import { allocations } from '../lib/tx.js'
import { todayStr } from '../lib/recurring.js'
import { confirmAndDelete } from '../lib/deletion.js'
import { LOAN_PLANS, loanFirstReceipt, loanInId, loanMonthly, loanOutId, loanStart, loanStatus, loansOverview } from '../lib/loans.js'

// Einheitliche Höhe für alle Eingabefelder (Datum, Auswahl, Zahl, Betrag, Text)
const field = 'h-8 rounded-md border border-line bg-surface px-2 text-[13px] outline-none focus:border-accent'
// Rahmen für AmountInput/TextInput, die ihren eigenen (unsichtbaren) Rahmen mitbringen
const wrap = 'h-8 overflow-hidden rounded-md border border-line bg-surface focus-within:border-accent'
const inner = 'h-full rounded-none border-0 text-[13px]'
const label = 'mb-1 text-[12px] text-ink-3'

export default function Loans({ data, update, month, tx, setView }) {
  const [name, setName] = useState('')
  const loans = data.loans || []
  const all = tx.allTransactions || tx.transactions
  const current = monthKey()
  const overview = loansOverview(loans, all, current)
  const monthTotal = loans.reduce((s, l) => s + loanMonthly(l, month, all), 0)

  const add = () => {
    update((d) => {
      d.loans = d.loans || []
      d.loans.push({
        id: uid(),
        name: name.trim() || 'Neues Darlehen',
        amount: 0,
        createdAt: todayStr(), // Datum und Konto der Einzahlung kommen aus der verknüpften Buchung
        interestRate: 0,
        plan: 'free',
        note: '',
      })
    })
    setName('')
  }

  // Offene zuerst, zurückbezahlte am Ende
  const sorted = loans
    .map((l, i) => ({ loan: l, index: i, status: loanStatus(l, all, current) }))
    .sort((a, b) => Number(a.status.done) - Number(b.status.done))

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Offene Darlehen" value={fmtCHF(overview.outstanding)} hint={overview.count ? `${overview.count} offen` : 'keine offenen Darlehen'} />
        <Stat label="Nächste Fälligkeit" value={overview.nextDue ? fmtDate(overview.nextDue) : '–'} hint="nächste Rate oder Rückzahlung" />
        <Stat label={`Im Budget · ${monthLabel(month)}`} value={fmtCHF(monthTotal)} hint="Raten und Rücklagen für Rückzahlungen" />
      </div>

      {sorted.map(({ loan, index, status }) => (
        <LoanCard key={loan.id} loan={loan} index={index} status={status} data={data} update={update} month={month} tx={tx} all={all} />
      ))}

      <div className="flex items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Name des Darlehens, z. B. Darlehen Peter"
          className="flex-1 bg-transparent px-1 text-[14px] outline-none placeholder:text-ink-3"
        />
        <Button onClick={add}>{Icon.plus} Darlehen hinzufügen</Button>
      </div>

      <p className="text-[12px] text-ink-3">
        Verknüpfe die Buchungen unter{' '}
        <button className="text-accent hover:underline" onClick={() => setView('transactions')}>Buchungen</button>{' '}
        mit den Positionen «… – erhalten» (zählt nicht als Einnahme) und «… – Rückzahlung» (senkt die Restschuld).
        Raten und Rücklagen für eine einmalige Rückzahlung fliessen ins Budget ein.
      </p>
    </div>
  )
}

function LoanCard({ loan: l, index, status: st, data, update, month, tx, all }) {
  const set = (fn) => update((d) => fn(d.loans[index]))
  const linked = all
    .filter((t) => allocations(t).some((a) => a.positionId === loanInId(l) || a.positionId === loanOutId(l)))
    .sort((a, b) => b.date.localeCompare(a.date))
  const thisMonth = loanMonthly(l, month, all)
  // Datum und Konto der Einzahlung aus der verknüpften Buchung
  const receipt = loanFirstReceipt(l, all)
  const receiptAccount = receipt && data.accounts.find((a) => a.id === receipt.accountId)?.name

  const remove = () =>
    confirmAndDelete({
      title: `Darlehen «${l.name}» löschen?`,
      message: 'Das Darlehen wird entfernt.',
      ids: [loanInId(l), loanOutId(l)],
      update,
      tx,
      mutate: (d) => { d.loans = d.loans.filter((x) => x.id !== l.id) },
    })

  return (
    <Card
      title={<TextInput value={l.name} onChange={(v) => set((x) => { x.name = v })} className="-ml-2 text-[16px] font-semibold" />}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          {st.done ? <Badge tone="good">{Icon.check} zurückbezahlt</Badge> : <Badge tone="warn">offen</Badge>}
          <span>{LOAN_PLANS[l.plan] || LOAN_PLANS.free}</span>
          {Number(l.interestRate) > 0 && <span>· Zins {l.interestRate}% p.a.</span>}
          <span>
            ·{' '}
            {receipt ? (
              `eingegangen am ${fmtDate(receipt.date)}${receiptAccount ? ` auf ${receiptAccount}` : ''}`
            ) : (
              <span className="text-warn" title={`Unter «Buchungen» die Einzahlung der Position «${l.name} – erhalten» zuordnen`}>Einzahlung noch nicht verknüpft</span>
            )}
          </span>
        </span>
      }
      actions={<Button variant="danger" onClick={remove}>{Icon.trash} Löschen</Button>}
    >
      {/* Stand */}
      <div className="grid gap-4 md:grid-cols-4">
        <Figure label="Betrag" value={fmtCHF(st.amount)} />
        <Figure label="Zurückbezahlt" value={fmtCHF(st.repaid)} />
        <Figure label="Restschuld" value={fmtCHF(st.outstanding)} strong />
        <Figure
          label={l.plan === 'due' ? 'Fällig' : 'Nächste Rate'}
          value={st.next ? (st.next.date ? fmtDate(st.next.date) : monthLabel(st.next.month)) : '–'}
          hint={st.next ? fmtCHF(st.next.amount) : st.done ? 'nichts mehr offen' : 'kein Plan'}
        />
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-good" style={{ width: `${st.progress * 100}%` }} />
      </div>

      {/* Angaben */}
      <div className="mt-5 flex flex-wrap items-end gap-4">
        <div>
          <div className={label}>Betrag</div>
          <div className={`w-32 ${wrap}`}><AmountInput value={l.amount} onChange={(v) => set((x) => { x.amount = Math.abs(v) })} className={inner} /></div>
        </div>
        <div>
          <div className={label}>Zins % p.a.</div>
          <input
            type="number"
            min="0"
            step="0.1"
            value={l.interestRate ?? 0}
            onChange={(e) => set((x) => { x.interestRate = Math.max(0, Number(e.target.value) || 0) })}
            className={`num w-24 text-right ${field}`}
            title="Nur zur Information – Zinsen werden nicht berechnet"
          />
        </div>
        <div>
          <div className={label}>Rückzahlung</div>
          <select
            value={l.plan || 'free'}
            onChange={(e) =>
              set((x) => {
                x.plan = e.target.value
                // Vorgabe: erste Rate im Monat nach der Einzahlung (bzw. der Erfassung)
                if (x.plan === 'rate' && !x.rateStart) x.rateStart = addMonths((loanStart(l, all) || todayStr()).slice(0, 7), 1)
              })
            }
            className={field}
          >
            {Object.entries(LOAN_PLANS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {l.plan === 'rate' && (
          <>
            <div>
              <div className={label}>Rate pro Monat</div>
              <div className={`w-32 ${wrap}`}><AmountInput value={l.rate || 0} onChange={(v) => set((x) => { x.rate = Math.abs(v) })} className={inner} /></div>
            </div>
            <div>
              <div className={label}>Erste Rate</div>
              <input type="month" value={l.rateStart || ''} onChange={(e) => e.target.value && set((x) => { x.rateStart = e.target.value })} className={`num ${field}`} />
            </div>
          </>
        )}
        {l.plan === 'due' && (
          <div>
            <div className={label}>Zurückzahlen bis</div>
            <input type="date" value={l.dueDate || ''} onChange={(e) => e.target.value && set((x) => { x.dueDate = e.target.value })} className={`num ${field}`} />
          </div>
        )}
      </div>
      <div className="mt-3">
        <div className={label}>Notiz</div>
        <div className={wrap}><TextInput value={l.note || ''} onChange={(v) => set((x) => { x.note = v })} placeholder="z. B. Abmachungen, Kontakt" className={inner} /></div>
      </div>

      <p className="mt-3 text-[12px] text-ink-3">
        {planHint(l, thisMonth, month)}
        {Number(l.interestRate) > 0 && ' Der Zins ist nur vermerkt und wird nicht berechnet.'}
      </p>

      {/* Verknüpfte Buchungen */}
      <div className="mt-4">
        <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-3">Verknüpfte Buchungen</div>
        {linked.length === 0 ? (
          <p className="text-[12px] text-ink-3">
            Noch keine. Ordne unter «Buchungen» die Einzahlung «{l.name} – erhalten» und Rückzahlungen «{l.name} – Rückzahlung» zu.
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            {linked.map((t) => {
              const inflow = allocations(t).some((a) => a.positionId === loanInId(l))
              return (
                <div key={t.id} className="flex items-center gap-3 border-b border-line py-1.5 text-[13px] last:border-b-0">
                  <span className="num w-20 shrink-0 text-ink-2">{fmtDate(t.date)}</span>
                  <span className="min-w-0 flex-1 truncate">{t.text}</span>
                  <span className="w-28 shrink-0 text-[12px] text-ink-3">{inflow ? 'erhalten' : 'Rückzahlung'}</span>
                  <span className={`num w-28 shrink-0 text-right ${t.amount > 0 ? 'text-good' : ''}`}>{fmtCHF(t.amount)}</span>
                </div>
              )
            })}
          </div>
        )}
        {st.received > 0 && Math.abs(st.received - st.amount) >= 0.005 && (
          <p className="mt-1 text-[12px] text-warn">Laut Buchungen erhalten: {fmtCHF(st.received)} – weicht vom Betrag {fmtCHF(st.amount)} ab.</p>
        )}
      </div>
    </Card>
  )
}

function planHint(l, thisMonth, month) {
  if (l.plan === 'rate') {
    if (!Number(l.rate) || !l.rateStart) return 'Rate und ersten Monat eintragen – die Rate fliesst dann bis zur vollständigen Rückzahlung ins Budget.'
    return `Im Budget ${monthLabel(month)}: ${fmtCHF(thisMonth)}. Die Rate fliesst bis zur vollständigen Rückzahlung ins Budget.`
  }
  if (l.plan === 'due') {
    if (!l.dueDate) return 'Datum eintragen – die App verteilt den Betrag gleichmässig als Rücklage bis zur Fälligkeit.'
    return `Rücklage im Budget ${monthLabel(month)}: ${fmtCHF(thisMonth)} – gleichmässig verteilt vom Monat der Einzahlung (solange keine verknüpft ist: der Erfassung) bis ${monthLabel(l.dueDate.slice(0, 7))}.`
  }
  return 'Ohne festen Plan – nur die Restschuld wird verfolgt, nichts im Budget.'
}

function Figure({ label: l, value, hint, strong }) {
  return (
    <div>
      <div className="text-[12px] text-ink-3">{l}</div>
      <div className={`num ${strong ? 'text-[22px] font-semibold' : 'text-[18px]'}`}>{value}</div>
      {hint && <div className="text-[12px] text-ink-3">{hint}</div>}
    </div>
  )
}
