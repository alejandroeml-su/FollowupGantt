import {
  Activity,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Target,
  Award,
  Users,
  AlertOctagon,
  CheckSquare,
  LineChart,
  Gauge,
  Briefcase,
  Sparkles,
  Minus,
} from 'lucide-react'
import type { KPIBundle, KPIValue } from '@/lib/kpi-calc'

type Props = {
  kpis: KPIBundle
}

const TONE_STYLES = {
  success: {
    text: 'text-emerald-300',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    ring: 'ring-emerald-500/30',
    accent: 'from-emerald-500/20 to-emerald-500/0',
    dot: 'bg-emerald-400',
  },
  warning: {
    text: 'text-amber-300',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    ring: 'ring-amber-500/30',
    accent: 'from-amber-500/20 to-amber-500/0',
    dot: 'bg-amber-400',
  },
  danger: {
    text: 'text-rose-300',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    ring: 'ring-rose-500/30',
    accent: 'from-rose-500/20 to-rose-500/0',
    dot: 'bg-rose-400',
  },
  neutral: {
    text: 'text-slate-300',
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/30',
    ring: 'ring-slate-500/30',
    accent: 'from-slate-500/15 to-slate-500/0',
    dot: 'bg-slate-400',
  },
} as const

function formatCurrency(n: number | null): string {
  if (n == null || !isFinite(n)) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

function formatNumber(n: number | null, digits = 2): string {
  if (n == null || !isFinite(n)) return '—'
  return n.toFixed(digits)
}

function formatPercent(n: number | null, digits = 1): string {
  if (n == null || !isFinite(n)) return '—'
  return `${n.toFixed(digits)}%`
}

function ToneIcon({ tone }: { tone: KPIValue['tone'] }) {
  if (tone === 'success') return <TrendingUp className="h-3 w-3" />
  if (tone === 'warning') return <Minus className="h-3 w-3" />
  if (tone === 'danger') return <TrendingDown className="h-3 w-3" />
  return <Minus className="h-3 w-3" />
}

export function KPIDashboardView({ kpis }: Props) {
  return (
    <div className="space-y-6">
      <HeroRow pv={kpis.pv} ev={kpis.ev} ac={kpis.ac} totals={kpis.totals} />

      <SectionHeader
        title="Rendimiento del Cronograma y Costo"
        subtitle="Earned Value Management · PMBOK"
        icon={<Gauge className="h-4 w-4" />}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <IndexCard
          title="SPI"
          subtitle="Schedule Performance Index"
          value={kpis.spi}
          icon={<Activity className="h-4 w-4" />}
          formatter={(v) => formatNumber(v, 2)}
          benchmark={1}
        />
        <IndexCard
          title="CPI"
          subtitle="Cost Performance Index"
          value={kpis.cpi}
          icon={<Gauge className="h-4 w-4" />}
          formatter={(v) => formatNumber(v, 2)}
          benchmark={1}
        />
        <VarianceCard
          title="SV"
          subtitle="Schedule Variance"
          value={kpis.sv}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <VarianceCard
          title="CV"
          subtitle="Cost Variance"
          value={kpis.cv}
          icon={<DollarSign className="h-4 w-4" />}
        />
      </div>

      <SectionHeader
        title="Rentabilidad y Gobernanza del Portafolio"
        subtitle="KPIs Estratégicos"
        icon={<Briefcase className="h-4 w-4" />}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="ROI"
          subtitle="Return on Investment"
          value={kpis.roi}
          icon={<DollarSign className="h-4 w-4" />}
          formatter={(v) => formatPercent(v, 1)}
        />
        <MetricCard
          title="Tasa de Éxito"
          subtitle="Proyectos completados en tiempo y costo"
          value={kpis.successRate}
          icon={<Award className="h-4 w-4" />}
          formatter={(v) => formatPercent(v, 0)}
          showProgress
        />
        <MetricCard
          title="Utilización de Recursos"
          subtitle="Esfuerzo real / planificado"
          value={kpis.resourceUtilization}
          icon={<Users className="h-4 w-4" />}
          formatter={(v) => formatPercent(v, 0)}
          showProgress
        />
        <MetricCard
          title="Scope Creep"
          subtitle="Tareas fuera del plan inicial"
          value={kpis.scopeCreep}
          icon={<AlertOctagon className="h-4 w-4" />}
          formatter={(v) => formatPercent(v, 0)}
          showProgress
          invertProgress
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-1">
          <PlannedVsActualCard data={kpis.plannedVsActual} />
        </div>
        <div className="xl:col-span-2">
          <TrendCard trend={kpis.trend} />
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Hero row (PV / EV / AC + totales)
// ─────────────────────────────────────────────────────────────

function HeroRow({
  pv,
  ev,
  ac,
  totals,
}: {
  pv: number
  ev: number
  ac: number
  totals: KPIBundle['totals']
}) {
  const items = [
    {
      label: 'Planned Value',
      abbr: 'PV',
      value: formatCurrency(pv),
      accent: 'from-indigo-500/30 via-indigo-500/10 to-transparent',
      iconColor: 'text-indigo-300',
      icon: <Target className="h-4 w-4" />,
    },
    {
      label: 'Earned Value',
      abbr: 'EV',
      value: formatCurrency(ev),
      accent: 'from-cyan-500/30 via-cyan-500/10 to-transparent',
      iconColor: 'text-cyan-300',
      icon: <Sparkles className="h-4 w-4" />,
    },
    {
      label: 'Actual Cost',
      abbr: 'AC',
      value: formatCurrency(ac),
      accent: 'from-violet-500/30 via-violet-500/10 to-transparent',
      iconColor: 'text-violet-300',
      icon: <DollarSign className="h-4 w-4" />,
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
      {items.map((it) => (
        <div
          key={it.abbr}
          className={`relative overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60 p-5 backdrop-blur`}
        >
          <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${it.accent}`} />
          <div className="relative">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                {it.label}
              </span>
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900/80 ${it.iconColor}`}
              >
                {it.icon}
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight text-white">{it.value}</span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {it.abbr}
              </span>
            </div>
          </div>
        </div>
      ))}

      <div className="relative overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60 p-5 backdrop-blur">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/20 via-emerald-500/5 to-transparent" />
        <div className="relative">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Alcance del portafolio
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900/80 text-emerald-300">
              <Briefcase className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <Stat label="Proyectos" value={totals.projects.toString()} />
            <Stat label="Activos" value={totals.activeProjects.toString()} />
            <Stat label="Tareas" value={totals.tasks.toString()} />
            <Stat label="Cerradas" value={totals.completedTasks.toString()} />
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between rounded-md bg-slate-950/40 px-2 py-1">
      <span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-100">{value}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Section header
// ─────────────────────────────────────────────────────────────

function SectionHeader({
  title,
  subtitle,
  icon,
}: {
  title: string
  subtitle: string
  icon: React.ReactNode
}) {
  return (
    <div className="flex items-end justify-between border-b border-slate-800/60 pb-2">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-500/15 text-indigo-300">
          {icon}
        </span>
        <div>
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <p className="text-[11px] text-slate-500">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Index card (SPI, CPI con gauge visual)
// ─────────────────────────────────────────────────────────────

function IndexCard({
  title,
  subtitle,
  value,
  icon,
  formatter,
  benchmark,
}: {
  title: string
  subtitle: string
  value: KPIValue
  icon: React.ReactNode
  formatter: (v: number | null) => string
  benchmark: number
}) {
  const tone = TONE_STYLES[value.tone]
  const displayValue = formatter(value.value)
  const gaugePct = value.value != null ? Math.min(Math.max(value.value / (benchmark * 1.4), 0), 1) * 100 : 0

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-slate-900/60 p-5 backdrop-blur transition ${tone.border}`}
    >
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${tone.accent}`} />
      <div className="relative">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-lg font-bold tracking-tight text-white">{title}</p>
            <p className="text-[11px] text-slate-500">{subtitle}</p>
          </div>
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950/60 ${tone.text}`}>
            {icon}
          </span>
        </div>

        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-4xl font-bold tracking-tight text-white">{displayValue}</span>
          <span className={`text-xs font-medium ${tone.text}`}>/ {benchmark.toFixed(2)}</span>
        </div>

        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-800/60">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${value.tone === 'success' ? 'from-emerald-500 to-emerald-400' : value.tone === 'warning' ? 'from-amber-500 to-amber-400' : value.tone === 'danger' ? 'from-rose-500 to-rose-400' : 'from-slate-500 to-slate-400'}`}
            style={{ width: `${gaugePct}%` }}
          />
        </div>

        <div className={`mt-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${tone.bg} ${tone.text}`}>
          <ToneIcon tone={value.tone} />
          {value.label}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">{value.hint}</p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Variance card (SV, CV con formato moneda)
// ─────────────────────────────────────────────────────────────

function VarianceCard({
  title,
  subtitle,
  value,
  icon,
}: {
  title: string
  subtitle: string
  value: KPIValue
  icon: React.ReactNode
}) {
  const tone = TONE_STYLES[value.tone]
  const signed = value.value != null ? (value.value >= 0 ? '+' : '') + formatCurrency(value.value) : '—'

  return (
    <div className={`relative overflow-hidden rounded-2xl border bg-slate-900/60 p-5 backdrop-blur transition ${tone.border}`}>
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${tone.accent}`} />
      <div className="relative">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-lg font-bold tracking-tight text-white">{title}</p>
            <p className="text-[11px] text-slate-500">{subtitle}</p>
          </div>
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950/60 ${tone.text}`}>
            {icon}
          </span>
        </div>

        <div className="mt-4">
          <span className={`text-3xl font-bold tracking-tight ${tone.text}`}>{signed}</span>
        </div>

        <div className={`mt-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${tone.bg} ${tone.text}`}>
          <ToneIcon tone={value.tone} />
          {value.label}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">{value.hint}</p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Metric card con barra de progreso opcional
// ─────────────────────────────────────────────────────────────

function MetricCard({
  title,
  subtitle,
  value,
  icon,
  formatter,
  showProgress,
  invertProgress,
}: {
  title: string
  subtitle: string
  value: KPIValue
  icon: React.ReactNode
  formatter: (v: number | null) => string
  showProgress?: boolean
  invertProgress?: boolean
}) {
  const tone = TONE_STYLES[value.tone]
  const display = formatter(value.value)
  const pct = value.value != null ? Math.min(Math.max(value.value, 0), 100) : 0
  const barPct = invertProgress ? Math.min(100, pct) : pct

  return (
    <div className={`relative overflow-hidden rounded-2xl border bg-slate-900/60 p-5 backdrop-blur transition ${tone.border}`}>
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${tone.accent}`} />
      <div className="relative">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-semibold text-white">{title}</p>
            <p className="text-[11px] text-slate-500">{subtitle}</p>
          </div>
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950/60 ${tone.text}`}>
            {icon}
          </span>
        </div>

        <div className="mt-4 flex items-baseline gap-2">
          <span className={`text-3xl font-bold tracking-tight ${tone.text}`}>{display}</span>
        </div>

        {showProgress && value.value != null && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-800/60">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${value.tone === 'success' ? 'from-emerald-500 to-emerald-400' : value.tone === 'warning' ? 'from-amber-500 to-amber-400' : value.tone === 'danger' ? 'from-rose-500 to-rose-400' : 'from-slate-500 to-slate-400'}`}
              style={{ width: `${barPct}%` }}
            />
          </div>
        )}

        <div className={`mt-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${tone.bg} ${tone.text}`}>
          <ToneIcon tone={value.tone} />
          {value.label}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">{value.hint}</p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Planned vs Actual (barras comparativas)
// ─────────────────────────────────────────────────────────────

function PlannedVsActualCard({ data }: { data: KPIBundle['plannedVsActual'] }) {
  const tone = TONE_STYLES[data.ratio.tone]
  const max = Math.max(data.planned, data.actual, 1)
  const plannedPct = (data.planned / max) * 100
  const actualPct = (data.actual / max) * 100

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60 p-5 backdrop-blur">
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${tone.accent}`} />
      <div className="relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-950/60 text-indigo-300">
              <CheckSquare className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-white">Planned vs Actual</h3>
              <p className="text-[11px] text-slate-500">Rendimiento de tareas en el periodo</p>
            </div>
          </div>
          <div className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${tone.bg} ${tone.text}`}>
            <ToneIcon tone={data.ratio.tone} />
            {data.ratio.label}
          </div>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="h-2 w-2 rounded-full bg-indigo-400" />
                Planificadas a la fecha
              </span>
              <span className="font-semibold text-slate-200">{data.planned}</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800/60">
              <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-400" style={{ width: `${plannedPct}%` }} />
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
                Completadas
              </span>
              <span className="font-semibold text-slate-200">{data.actual}</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800/60">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${data.ratio.tone === 'success' ? 'from-emerald-500 to-emerald-400' : data.ratio.tone === 'warning' ? 'from-amber-500 to-amber-400' : data.ratio.tone === 'danger' ? 'from-rose-500 to-rose-400' : 'from-slate-500 to-slate-400'}`}
                style={{ width: `${actualPct}%` }}
              />
            </div>
          </div>

          <div className="rounded-lg border border-slate-800/60 bg-slate-950/40 p-3">
            <p className="text-[11px] text-slate-500">Cumplimiento</p>
            <p className={`text-2xl font-bold ${tone.text}`}>{formatPercent(data.ratio.value, 1)}</p>
            <p className="mt-1 text-[11px] text-slate-500">{data.ratio.hint}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Trend chart (Sparkline SVG custom)
// ─────────────────────────────────────────────────────────────

function TrendCard({ trend }: { trend: KPIBundle['trend'] }) {
  const width = 600
  const height = 180
  const padding = { top: 20, right: 20, bottom: 30, left: 40 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const allValues = trend.flatMap((t) => [t.pv, t.ev, t.ac])
  const maxVal = Math.max(...allValues, 1)

  const points = (key: 'pv' | 'ev' | 'ac') =>
    trend
      .map((t, i) => {
        const x = padding.left + (trend.length > 1 ? (i / (trend.length - 1)) * innerW : innerW / 2)
        const y = padding.top + innerH - (t[key] / maxVal) * innerH
        return `${x},${y}`
      })
      .join(' ')

  const areaPath = (key: 'pv' | 'ev' | 'ac') => {
    if (trend.length === 0) return ''
    const pts = trend.map((t, i) => {
      const x = padding.left + (trend.length > 1 ? (i / (trend.length - 1)) * innerW : innerW / 2)
      const y = padding.top + innerH - (t[key] / maxVal) * innerH
      return { x, y }
    })
    const firstX = pts[0].x
    const lastX = pts[pts.length - 1].x
    const baseY = padding.top + innerH
    return `M ${firstX},${baseY} L ${pts.map((p) => `${p.x},${p.y}`).join(' L ')} L ${lastX},${baseY} Z`
  }

  const hasData = allValues.some((v) => v > 0)

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60 p-5 backdrop-blur">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-transparent" />
      <div className="relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-950/60 text-indigo-300">
              <LineChart className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-white">Tendencia EVM — Últimos 6 meses</h3>
              <p className="text-[11px] text-slate-500">PV vs EV vs AC por mes de creación</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <LegendDot color="bg-indigo-400" label="PV" />
            <LegendDot color="bg-cyan-400" label="EV" />
            <LegendDot color="bg-violet-400" label="AC" />
          </div>
        </div>

        {hasData ? (
          <svg viewBox={`0 0 ${width} ${height}`} className="mt-4 w-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="gradPv" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgb(99, 102, 241)" stopOpacity="0.35" />
                <stop offset="100%" stopColor="rgb(99, 102, 241)" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="gradEv" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgb(34, 211, 238)" stopOpacity="0.35" />
                <stop offset="100%" stopColor="rgb(34, 211, 238)" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="gradAc" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgb(167, 139, 250)" stopOpacity="0.35" />
                <stop offset="100%" stopColor="rgb(167, 139, 250)" stopOpacity="0" />
              </linearGradient>
            </defs>

            {[0.25, 0.5, 0.75, 1].map((r) => (
              <line
                key={r}
                x1={padding.left}
                x2={width - padding.right}
                y1={padding.top + innerH * (1 - r)}
                y2={padding.top + innerH * (1 - r)}
                stroke="rgb(30, 41, 59)"
                strokeDasharray="2 4"
              />
            ))}

            <path d={areaPath('pv')} fill="url(#gradPv)" />
            <path d={areaPath('ev')} fill="url(#gradEv)" />
            <path d={areaPath('ac')} fill="url(#gradAc)" />

            <polyline points={points('pv')} fill="none" stroke="rgb(99, 102, 241)" strokeWidth="2" />
            <polyline points={points('ev')} fill="none" stroke="rgb(34, 211, 238)" strokeWidth="2" />
            <polyline points={points('ac')} fill="none" stroke="rgb(167, 139, 250)" strokeWidth="2" />

            {trend.map((t, i) => {
              const x =
                padding.left + (trend.length > 1 ? (i / (trend.length - 1)) * innerW : innerW / 2)
              return (
                <text
                  key={t.month}
                  x={x}
                  y={height - 8}
                  fontSize="10"
                  fill="rgb(100, 116, 139)"
                  textAnchor="middle"
                >
                  {t.month.slice(5)}
                </text>
              )
            })}
          </svg>
        ) : (
          <div className="mt-4 flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-800 bg-slate-950/40 text-xs text-slate-500">
            Sin datos de EVM en el periodo
          </div>
        )}
      </div>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-slate-400">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  )
}
