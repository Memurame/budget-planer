import { useEffect, useRef, useState } from 'react'
import { fmtCHF, fmtNum, parseAmount } from '../lib/format.js'

export function Card({ title, subtitle, actions, children, className = '', padded = true }) {
  return (
    <section className={`rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'px-5 pb-5' : ''}>{children}</div>
    </section>
  )
}

export function Button({ children, variant = 'default', className = '', ...props }) {
  const styles = {
    default: 'border border-line bg-surface hover:bg-surface-2 text-ink',
    primary: 'bg-accent text-white hover:brightness-110 border border-transparent',
    ghost: 'text-ink-2 hover:bg-surface-2 border border-transparent',
    danger: 'border border-line text-bad hover:bg-surface-2',
    destructive: 'border border-transparent bg-bad text-white hover:brightness-110',
  }
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition disabled:opacity-40 ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function IconButton({ title, children, className = '', ...props }) {
  return (
    <button
      title={title}
      aria-label={title}
      className={`grid size-7 place-items-center rounded-md text-ink-3 transition hover:bg-surface-2 hover:text-ink ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

/** Betragsfeld: zeigt formatiert an, akzeptiert 1'234.50 oder 1234,5. Übernimmt bei Enter/Verlassen. */
export function AmountInput({ value, onChange, className = '', placeholder = '0.00', ...props }) {
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState('')
  const ref = useRef(null)

  const commit = () => {
    setFocused(false)
    const v = text.trim() === '' ? 0 : Math.round(parseAmount(text) * 100) / 100
    if (v !== value) onChange(v)
  }

  return (
    <input
      ref={ref}
      inputMode="decimal"
      className={`num ${/\bw-/.test(className) ? "" : "w-full"} rounded-md border border-transparent bg-transparent px-2 py-1 text-right outline-none transition hover:border-line focus:border-accent focus:bg-surface ${className}`}
      value={focused ? text : value ? fmtNum(value) : ''}
      placeholder={placeholder}
      onFocus={(e) => { setFocused(true); setText(value ? String(value) : ''); requestAnimationFrame(() => e.target.select()) }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') ref.current.blur()
        if (e.key === 'Escape') { setText(value ? String(value) : ''); requestAnimationFrame(() => ref.current.blur()) }
      }}
      {...props}
    />
  )
}

/** Textfeld, das erst beim Verlassen übernimmt (verhindert Speichern bei jedem Tastendruck). */
export function TextInput({ value, onChange, className = '', ...props }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const ref = useRef(null)
  return (
    <input
      ref={ref}
      className={`${/\bw-/.test(className) ? "" : "w-full"} min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 outline-none transition hover:border-line focus:border-accent focus:bg-surface ${className}`}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onChange(text)}
      onKeyDown={(e) => e.key === 'Enter' && ref.current.blur()}
      {...props}
    />
  )
}

export function Stat({ label, value, hint, tone }) {
  const toneCls = tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : 'text-ink'
  return (
    <div className="rounded-2xl border border-line bg-surface px-5 py-4">
      <div className="text-[13px] text-ink-3">{label}</div>
      <div className={`num mt-1 text-[26px] font-semibold tracking-tight ${toneCls}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[12px] text-ink-3">{hint}</div>}
    </div>
  )
}

export function Progress({ value, tone = 'accent' }) {
  const v = Math.max(0, Math.min(1, value || 0))
  const color = tone === 'good' ? 'bg-good' : tone === 'warn' ? 'bg-warn' : 'bg-accent'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${v * 100}%` }} />
    </div>
  )
}

export function Badge({ children, tone = 'neutral', title }) {
  const cls = {
    neutral: 'bg-surface-2 text-ink-2',
    warn: 'bg-warn-soft text-warn',
    accent: 'bg-accent-soft text-accent',
    good: 'bg-[color-mix(in_oklab,var(--good)_14%,transparent)] text-good',
    bad: 'bg-[color-mix(in_oklab,var(--bad)_14%,transparent)] text-bad',
  }[tone]
  return <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>
}

export const Money = ({ v, className = '' }) => <span className={`num ${className}`}>{fmtCHF(v)}</span>

export const Icon = {
  plus: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>,
  trash: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></svg>,
  up: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10l4-4 4 4" /></svg>,
  down: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4" /></svg>,
  left: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10 4L6 8l4 4" /></svg>,
  right: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4l4 4-4 4" /></svg>,
  target: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2" /></svg>,
  warn: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2l6.5 11.5h-13L8 2zM8 6.5v3M8 11.5v.01" /></svg>,
  check: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>,
  link: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 014.5 9l1-1" /></svg>,
  eyeOff: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" /><path d="M3 13L13 3" /></svg>,
  upload: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M8 10V2.5M5 5.5l3-3 3 3M3 10.5v2h10v-2" /></svg>,
  split: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 8h4l3-4.5h4M6.5 8l3 4.5h4M12 2l1.5 1.5L12 5M12 11l1.5 1.5L12 14" /></svg>,
  lock: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 015 0v2" /></svg>,
  // Navigation
  receipt: <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M5 2.5h10v15l-2-1.3-1.7 1.3L10 16.2l-1.3 1.3L7 16.2l-2 1.3v-15z" /><path d="M7.5 6.5h5M7.5 9.5h5M7.5 12.5h3" strokeLinecap="round" /></svg>,
  wallet: <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M3 6.5A1.5 1.5 0 014.5 5H15v2.5" /><rect x="3" y="6.5" width="14" height="10" rx="1.5" /><path d="M13 11.5h1.5" strokeLinecap="round" /></svg>,
  home: <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M3 9l7-6 7 6v8H3V9z" /><path d="M8 17v-5h4v5" /></svg>,
  list: <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M7 5h10M7 10h10M7 15h10M3 5h.01M3 10h.01M3 15h.01" /></svg>,
  calendar: <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><rect x="3" y="4" width="14" height="13" rx="2" /><path d="M3 8h14M7 2.5v3M13 2.5v3" /></svg>,
  chart: <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 17h14M6 14V9M10 14V5M14 14v-3" /></svg>,
  gear: <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="10" cy="10" r="2.5" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" strokeLinecap="round" /></svg>,
  loan: <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><ellipse cx="8" cy="6" rx="4.5" ry="2" /><path d="M3.5 6v3c0 1.1 2 2 4.5 2s4.5-.9 4.5-2V6" /><path d="M3.5 9v3c0 1.1 2 2 4.5 2 .6 0 1.2-.05 1.7-.15" /><circle cx="14" cy="13.5" r="3" /><path d="M14 12v3" strokeLinecap="round" /></svg>,
  pause: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M6 4v8M10 4v8" /></svg>,
  play: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M5 3.5l7 4.5-7 4.5z" /></svg>,
}

// ── Lösch-Bestätigung: das Wort «löschen» muss eingetippt werden ─────────────
let openDeleteDialog = null

/** Öffnet den Lösch-Dialog. Liefert true, wenn der Benutzer «löschen» eingetippt und bestätigt hat. */
export function askDelete({ title, message }) {
  return new Promise((resolve) => {
    if (!openDeleteDialog) return resolve(false)
    openDeleteDialog({ title, message, resolve })
  })
}

/** Einmal in der App einbinden. */
export function DeleteDialogHost() {
  const [req, setReq] = useState(null)
  const [text, setText] = useState('')
  useEffect(() => {
    openDeleteDialog = (r) => { setText(''); setReq(r) }
    return () => { openDeleteDialog = null }
  }, [])
  if (!req) return null
  const ok = text.trim().toLowerCase() === 'löschen'
  const close = (result) => { req.resolve(result); setReq(null) }
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-[0_20px_60px_rgba(0,0,0,0.3)]" role="dialog" aria-modal="true">
        <h2 className="text-[16px] font-semibold">{req.title}</h2>
        <p className="mt-2 whitespace-pre-line text-[14px] text-ink-2">{req.message}</p>
        <label className="mt-4 block text-[13px] text-ink-2">
          Zum Bestätigen <b className="text-ink">löschen</b> eintippen:
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && ok) close(true); if (e.key === 'Escape') close(false) }}
            className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] outline-none focus:border-bad"
            placeholder="löschen"
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => close(false)}>Abbrechen</Button>
          <Button variant="destructive" disabled={!ok} onClick={() => close(true)}>Endgültig löschen</Button>
        </div>
      </div>
    </div>
  )
}
