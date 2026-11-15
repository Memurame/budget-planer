import { Chart, BarController, LineController, DoughnutController, ArcElement, BarElement, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js'
import { readColors } from './theme.js'
import { fmtCHF, fmtCHF0 } from './format.js'

Chart.register(BarController, LineController, DoughnutController, ArcElement, BarElement, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend)

/** Gemeinsame, zurückhaltende Diagramm-Optionen; `theme` erzwingt Neuberechnung bei Wechsel. */
export function baseOptions(_theme, { horizontal = false, legend = false, stacked = false } = {}) {
  const c = readColors()
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily
  Chart.defaults.font.size = 12
  Chart.defaults.color = c.ink2
  const valueAxis = {
    stacked,
    beginAtZero: true,
    grid: { color: c.line, drawTicks: false },
    border: { display: false },
    ticks: { color: c.ink3, padding: 8, callback: (v) => fmtCHF0(v).replace('CHF', '').trim() },
  }
  const catAxis = { stacked, grid: { display: false }, border: { color: c.line }, ticks: { color: c.ink2, padding: 6 } }
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    interaction: { mode: 'nearest', axis: horizontal ? 'y' : 'x', intersect: false },
    plugins: {
      legend: { display: legend, position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2, color: c.ink2, padding: 14 } },
      tooltip: {
        backgroundColor: c.surface,
        titleColor: c.ink,
        bodyColor: c.ink2,
        borderColor: c.line,
        borderWidth: 1,
        padding: 10,
        boxPadding: 4,
        usePointStyle: true,
        callbacks: { label: (ctx) => ` ${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${fmtCHF(ctx.parsed[horizontal ? 'x' : 'y'] ?? ctx.parsed)}` },
      },
    },
    scales: horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
  }
}

export const barStyle = { borderRadius: 4, borderSkipped: 'start', maxBarThickness: 36 }
export { readColors }
