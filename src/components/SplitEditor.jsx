import { useState } from 'react'
import { Button, IconButton, AmountInput, Icon } from './ui.jsx'
import PositionSelect from './PositionSelect.jsx'
import { fmtCHF } from '../lib/format.js'
import { monthOf } from '../lib/tx.js'

/**
 * Buchung auf mehrere Positionen aufteilen. Beträge werden positiv eingegeben (Anteil der Buchung);
 * die Summe muss dem Buchungsbetrag entsprechen. Der Rest kann mit einem Klick in eine Zeile übernommen werden.
 */
export default function SplitEditor({ data, t, onSave, onCancel }) {
  const sign = t.amount < 0 ? -1 : 1
  const total = Math.abs(t.amount)
  const initial = t.splits?.length
    ? t.splits.map((x) => ({ positionId: x.positionId, amount: Math.abs(x.amount) }))
    : [{ positionId: t.positionId, amount: total }, { positionId: null, amount: 0 }]
  const [rows, setRows] = useState(initial)
  const sum = Math.round(rows.reduce((a, r) => a + (Number(r.amount) || 0), 0) * 100) / 100
  const rest = Math.round((total - sum) * 100) / 100
  const valid = rows.length >= 2 && Math.abs(rest) < 0.005 && rows.every((r) => r.positionId && r.amount > 0)
  const set = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  return (
    <div className="text-[13px]">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">«{t.text}» aufteilen – total {fmtCHF(total)}</span>
        <span className={Math.abs(rest) < 0.005 ? 'text-good' : 'text-warn'}>{Math.abs(rest) < 0.005 ? '✓ vollständig verteilt' : `noch ${fmtCHF(rest)} zu verteilen`}</span>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="mb-1.5 flex items-center gap-2">
          <div className="w-72 rounded-md border border-line bg-surface"><PositionSelect data={data} month={monthOf(t.date)} value={r.positionId} onChange={(v) => set(i, 'positionId', v)} /></div>
          <div className="w-32 rounded-md border border-line bg-surface"><AmountInput value={r.amount} onChange={(v) => set(i, 'amount', Math.abs(v))} /></div>
          {Math.abs(rest) >= 0.005 && (
            <button type="button" className="rounded px-1.5 py-0.5 text-[12px] text-accent hover:bg-accent-soft" onClick={() => set(i, 'amount', Math.round(((Number(r.amount) || 0) + rest) * 100) / 100)}>Rest hierher</button>
          )}
          {rows.length > 2 && <IconButton type="button" title="Zeile entfernen" className="hover:text-bad" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>{Icon.trash}</IconButton>}
        </div>
      ))}
      <div className="mt-2 flex items-center gap-2">
        <Button type="button" variant="ghost" className="-ml-3" onClick={() => setRows((rs) => [...rs, { positionId: null, amount: Math.max(0, rest) }])}>{Icon.plus} Zeile</Button>
        <div className="ml-auto flex gap-2">
          {t.splits?.length > 0 && <Button type="button" variant="ghost" onClick={() => onSave(null)}>Aufteilung entfernen</Button>}
          <Button type="button" variant="ghost" onClick={onCancel}>Abbrechen</Button>
          <Button type="button" variant="primary" disabled={!valid} onClick={() => onSave(rows.map((r) => ({ positionId: r.positionId, amount: Math.round(sign * r.amount * 100) / 100 })))}>Aufteilung speichern</Button>
        </div>
      </div>
    </div>
  )
}
