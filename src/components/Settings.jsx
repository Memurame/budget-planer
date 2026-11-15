import { useEffect, useState } from 'react'
import { Card, Button } from './ui.jsx'
import { chooseFile, exportCsv, getInfo, isDesktop, showInFolder } from '../lib/storage.js'
import { amountAt, flatRate, isPeriodic, itemMonthlyFlat, monthKey } from '../lib/calc.js'

const csvCell = (v) => {
  const s = typeof v === 'number' ? v.toFixed(2) : String(v ?? '')
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(data, key = monthKey()) {
  const rows = [['Bereich', 'Gruppe', 'Name', 'Monatlich', 'Jährlich', 'Fällig am', 'Intervall (Monate)']]
  data.income.forEach((i) => rows.push(['Einnahmen', '', i.name, amountAt(i, key), amountAt(i, key) * 12, '', '']))
  data.groups.forEach((g) => g.items.forEach((i) => rows.push(['Budget', g.name, i.name, itemMonthlyFlat(i, key), itemMonthlyFlat(i, key) * 12, isPeriodic(i) ? i.dueDate : '', i.intervalMonths || 1])))
  data.annual.forEach((a) => rows.push(['Jährliche Kosten', '', a.name, flatRate(a), a.amount * (12 / (a.intervalMonths || 12)), a.dueDate, a.intervalMonths]))
  data.deductions.forEach((d) => rows.push(['Sparen & Abzüge', '', d.name, amountAt(d, key), amountAt(d, key) * 12, '', '']))
  return rows.map((r) => r.map(csvCell).join(';')).join('\n')
}

export default function Settings({ data, theme, month }) {
  const [info, setInfo] = useState({ dataPath: '' })
  const [msg, setMsg] = useState('')
  useEffect(() => { getInfo().then(setInfo) }, [])

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 4000) }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Card title="Datei" subtitle="Budget, Konten und Regeln liegen in dieser Datei, Buchungen pro Jahr im Unterordner «buchungen». Pro Tag und Datei wird automatisch eine Sicherung im Unterordner «backups» angelegt.">
        <div className="num rounded-lg bg-surface-2 px-3 py-2 text-[13px] break-all">{info.dataPath}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {isDesktop && (
            <>
              <Button onClick={async () => { const r = await chooseFile(); if (r) { setInfo(r); flash('Speicherort geändert.') } }}>Speicherort ändern …</Button>
              <Button onClick={() => showInFolder()}>Im Dateimanager zeigen</Button>
            </>
          )}
          <Button onClick={async () => { const r = await exportCsv(toCsv(data, month)); if (r) flash(`Exportiert: ${r.path}`) }}>Als CSV exportieren (für Excel)</Button>
        </div>
      </Card>

      <Card title="Darstellung">
        <div className="inline-flex rounded-lg border border-line p-0.5">
          {[['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([v, l]) => (
            <button
              key={v}
              onClick={() => theme.setMode(v)}
              className={`rounded-md px-3 py-1.5 text-[13px] ${theme.mode === v ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-surface-2'}`}
            >
              {l}
            </button>
          ))}
        </div>
      </Card>

      {msg && <div className="text-[13px] text-good">{msg}</div>}
    </div>
  )
}
