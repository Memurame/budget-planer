import { allPositions } from '../lib/tx.js'

/** Auswahl einer Budget-Position, gruppiert nach Budget-Gruppe. */
export default function PositionSelect({ data, value, onChange, placeholder = '– Position wählen –', className = '', allowIgnore = false, ...props }) {
  const positions = allPositions(data)
  const groups = [...new Set(positions.map((p) => p.group))]
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value || null)}
      className={`w-full min-w-0 truncate rounded-md border border-transparent bg-transparent px-1 py-1 outline-none hover:border-line focus:border-accent ${value ? '' : 'text-ink-3'} ${className}`}
      {...props}
    >
      <option value="">{placeholder}</option>
      {allowIgnore && <option value="__ignore">Ignorieren (keine Ausgabe)</option>}
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {positions.filter((p) => p.group === g).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

export const positionName = (data, id) => {
  const p = allPositions(data).find((x) => x.id === id)
  return p ? p.name : null
}
