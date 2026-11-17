import { allPositions } from '../lib/tx.js'
import { isActiveAt } from '../lib/calc.js'

/**
 * Auswahl einer Budget-Position, gruppiert nach Budget-Gruppe.
 * Mit `month` werden Positionen ausgeblendet, die in diesem Monat deaktiviert sind
 * (die aktuell gewählte bleibt sichtbar, mit Hinweis).
 */
export default function PositionSelect({ data, value, onChange, month, placeholder = '– Position wählen –', className = '', allowIgnore = false, ...props }) {
  const all = allPositions(data)
  const inactive = (p) => !!month && !isActiveAt(p.item, month)
  const positions = all.filter((p) => !inactive(p) || p.id === value)
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
            <option key={p.id} value={p.id}>{p.name}{inactive(p) ? ' (deaktiviert)' : ''}</option>
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
