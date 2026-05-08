'use client'

/**
 * Wave P12 (PMI 100% · HU-12.8) — EVM S-curve dashboard.
 *
 * Visualización clásica de PMBOK · Earned Value Management:
 *   - Curva S de PV (planeado) · EV (ganado) · AC (real costo).
 *   - KPIs CPI, SPI, EAC, VAC con semáforo verde/amarillo/rojo.
 *   - Botón "Capturar snapshot" para añadir punto a la serie.
 *
 * Renderizado SVG inline (sin librería extra) para preservar bundle
 * size y performance.
 */

import { useMemo, useState, useTransition } from 'react'
import {
  Activity,
  Camera,
  DollarSign,
  Gauge,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { captureEVMSnapshot } from '@/lib/actions/evm-snapshots'
import { toast } from '@/components/interactions/Toaster'

type Snapshot = {
  id: string
  snapshotDate: string
  plannedValue: number
  earnedValue: number
  actualCost: number
  budgetAtCompletion: number | null
  cpi: number | null
  spi: number | null
  estimateAtCompletion: number | null
  varianceAtCompletion: number | null
  notes: string | null
}

type Props = {
  projectId: string
  projectName: string
  budget: number | null
  currency: string
  snapshots: Snapshot[]
  currentUser: { id: string; name: string } | null
}

const CHART_W = 720
const CHART_H = 320
const PADDING = { top: 20, right: 20, bottom: 40, left: 60 }

function fmtMoney(v: number | null, currency: string) {
  if (v === null || v === undefined) return '—'
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(v)
}

function indexBadge(idx: number | null) {
  if (idx === null || idx === undefined)
    return { label: '—', classes: 'bg-zinc-500/20 text-zinc-300' }
  if (idx >= 0.95)
    return {
      label: idx.toFixed(2),
      classes: 'bg-emerald-500/20 text-emerald-200',
    }
  if (idx >= 0.85)
    return { label: idx.toFixed(2), classes: 'bg-amber-500/20 text-amber-200' }
  return { label: idx.toFixed(2), classes: 'bg-rose-500/20 text-rose-200' }
}

export function EVMDashboardClient({
  projectId,
  projectName,
  budget,
  currency,
  snapshots,
  currentUser,
}: Props) {
  const [notes, setNotes] = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null
  const cpi = indexBadge(latest?.cpi ?? null)
  const spi = indexBadge(latest?.spi ?? null)

  const chart = useMemo(() => {
    if (snapshots.length === 0) return null
    const innerW = CHART_W - PADDING.left - PADDING.right
    const innerH = CHART_H - PADDING.top - PADDING.bottom
    const allValues = snapshots.flatMap((s) => [
      s.plannedValue,
      s.earnedValue,
      s.actualCost,
    ])
    const maxY = Math.max(...allValues, budget ?? 0, 1) * 1.1
    const minDate = new Date(snapshots[0].snapshotDate).getTime()
    const maxDate = new Date(
      snapshots[snapshots.length - 1].snapshotDate,
    ).getTime()
    const dateRange = Math.max(1, maxDate - minDate)

    const xFor = (iso: string) =>
      PADDING.left +
      ((new Date(iso).getTime() - minDate) / dateRange) * innerW
    const yFor = (val: number) =>
      PADDING.top + innerH - (val / maxY) * innerH

    const path = (key: 'plannedValue' | 'earnedValue' | 'actualCost') =>
      snapshots
        .map((s, i) => `${i === 0 ? 'M' : 'L'} ${xFor(s.snapshotDate)} ${yFor(s[key])}`)
        .join(' ')

    const yTicks = [0, maxY * 0.25, maxY * 0.5, maxY * 0.75, maxY]

    return {
      pvPath: path('plannedValue'),
      evPath: path('earnedValue'),
      acPath: path('actualCost'),
      points: snapshots.map((s) => ({
        x: xFor(s.snapshotDate),
        ev: yFor(s.earnedValue),
        pv: yFor(s.plannedValue),
        ac: yFor(s.actualCost),
        date: s.snapshotDate,
      })),
      yTicks: yTicks.map((v) => ({ y: yFor(v), v })),
      bacLine: budget ? yFor(budget) : null,
    }
  }, [snapshots, budget])

  const handleCapture = () => {
    startTransition(async () => {
      try {
        await captureEVMSnapshot({
          projectId,
          notes: notes.trim() || undefined,
          actorId: currentUser?.id,
        })
        toast.success('Snapshot capturado')
        setNotes('')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-border bg-gradient-to-br from-indigo-500/10 via-card to-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-indigo-300">
              <Activity className="h-3.5 w-3.5" />
              Earned Value Management · Curva S
            </div>
            <h1 className="mt-1 text-2xl font-bold text-foreground">
              {projectName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {budget
                ? `BAC · ${fmtMoney(budget, currency)}`
                : 'Define un budget en el proyecto para activar EAC/VAC'}
            </p>
          </div>
          <button
            onClick={handleCapture}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            <Camera className="h-4 w-4" />
            Capturar snapshot
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard
            label="CPI"
            value={cpi.label}
            sub="EV / AC"
            classes={cpi.classes}
            icon={Gauge}
          />
          <KpiCard
            label="SPI"
            value={spi.label}
            sub="EV / PV"
            classes={spi.classes}
            icon={Gauge}
          />
          <KpiCard
            label="EAC"
            value={fmtMoney(latest?.estimateAtCompletion ?? null, currency)}
            sub="BAC / CPI"
            classes="bg-cyan-500/10 text-cyan-200 border border-cyan-500/30"
            icon={Target}
          />
          <KpiCard
            label="VAC"
            value={fmtMoney(latest?.varianceAtCompletion ?? null, currency)}
            sub={
              (latest?.varianceAtCompletion ?? 0) >= 0
                ? 'Bajo presupuesto'
                : 'Sobre presupuesto'
            }
            classes={
              (latest?.varianceAtCompletion ?? 0) >= 0
                ? 'bg-emerald-500/10 text-emerald-200 border border-emerald-500/30'
                : 'bg-rose-500/10 text-rose-200 border border-rose-500/30'
            }
            icon={
              (latest?.varianceAtCompletion ?? 0) >= 0
                ? TrendingUp
                : TrendingDown
            }
          />
        </div>
      </header>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <DollarSign className="h-4 w-4 text-indigo-300" />
          Curva S · PV · EV · AC
        </h2>

        {!chart ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground">
            <Activity className="h-10 w-10 opacity-30" />
            <p className="mt-3">Aún no hay snapshots capturados.</p>
            <p className="mt-1 text-xs">
              Captura el primero para iniciar la serie temporal.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <svg
                width={CHART_W}
                height={CHART_H}
                className="block min-w-full"
                viewBox={`0 0 ${CHART_W} ${CHART_H}`}
              >
                <defs>
                  <linearGradient id="evGrad" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity="0" />
                  </linearGradient>
                </defs>

                {chart.yTicks.map((t, i) => (
                  <g key={i}>
                    <line
                      x1={PADDING.left}
                      x2={CHART_W - PADDING.right}
                      y1={t.y}
                      y2={t.y}
                      stroke="rgb(82 82 91 / 0.3)"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={PADDING.left - 6}
                      y={t.y + 4}
                      textAnchor="end"
                      className="fill-current text-[10px] text-muted-foreground"
                      style={{ fill: 'currentColor', opacity: 0.6 }}
                    >
                      {fmtMoney(t.v, currency)}
                    </text>
                  </g>
                ))}

                {chart.bacLine !== null && (
                  <g>
                    <line
                      x1={PADDING.left}
                      x2={CHART_W - PADDING.right}
                      y1={chart.bacLine}
                      y2={chart.bacLine}
                      stroke="rgb(217 119 6)"
                      strokeDasharray="6 4"
                      strokeWidth="1.5"
                    />
                    <text
                      x={CHART_W - PADDING.right - 4}
                      y={chart.bacLine - 4}
                      textAnchor="end"
                      className="text-[10px] font-semibold"
                      fill="rgb(217 119 6)"
                    >
                      BAC
                    </text>
                  </g>
                )}

                <path
                  d={`${chart.evPath} L ${chart.points[chart.points.length - 1].x} ${PADDING.top + (CHART_H - PADDING.top - PADDING.bottom)} L ${chart.points[0].x} ${PADDING.top + (CHART_H - PADDING.top - PADDING.bottom)} Z`}
                  fill="url(#evGrad)"
                />

                <path d={chart.pvPath} fill="none" stroke="rgb(99 102 241)" strokeWidth="2" />
                <path d={chart.evPath} fill="none" stroke="rgb(16 185 129)" strokeWidth="2.5" />
                <path d={chart.acPath} fill="none" stroke="rgb(244 114 182)" strokeWidth="2" />

                {chart.points.map((p, i) => (
                  <g key={i}>
                    <circle cx={p.x} cy={p.pv} r="3" fill="rgb(99 102 241)" />
                    <circle cx={p.x} cy={p.ev} r="4" fill="rgb(16 185 129)" />
                    <circle cx={p.x} cy={p.ac} r="3" fill="rgb(244 114 182)" />
                  </g>
                ))}
              </svg>
            </div>

            <div className="mt-3 flex flex-wrap gap-4 border-t border-border pt-3 text-xs text-muted-foreground">
              <Legend color="rgb(99 102 241)" label="PV · Planned Value" />
              <Legend color="rgb(16 185 129)" label="EV · Earned Value" />
              <Legend color="rgb(244 114 182)" label="AC · Actual Cost" />
              {budget !== null && (
                <Legend color="rgb(217 119 6)" label="BAC · Budget at Completion" dashed />
              )}
            </div>
          </>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            Notas para próximo snapshot
          </h2>
          <span className="text-xs text-muted-foreground">
            Total snapshots: {snapshots.length}
          </span>
        </div>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Contexto del snapshot (cierre de fase, cambio de scope...)"
          className="w-full rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </section>

      {snapshots.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            Historial · {snapshots.length} snapshots
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-2 py-2 text-left">Fecha</th>
                  <th className="px-2 py-2 text-right">PV</th>
                  <th className="px-2 py-2 text-right">EV</th>
                  <th className="px-2 py-2 text-right">AC</th>
                  <th className="px-2 py-2 text-right">CPI</th>
                  <th className="px-2 py-2 text-right">SPI</th>
                  <th className="px-2 py-2 text-right">EAC</th>
                  <th className="px-2 py-2 text-left">Notas</th>
                </tr>
              </thead>
              <tbody>
                {[...snapshots].reverse().map((s) => (
                  <tr key={s.id} className="border-b border-border/50 text-foreground">
                    <td className="px-2 py-2">
                      {new Date(s.snapshotDate).toLocaleDateString('es-MX')}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {fmtMoney(s.plannedValue, currency)}
                    </td>
                    <td className="px-2 py-2 text-right text-emerald-300">
                      {fmtMoney(s.earnedValue, currency)}
                    </td>
                    <td className="px-2 py-2 text-right text-pink-300">
                      {fmtMoney(s.actualCost, currency)}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {s.cpi !== null ? s.cpi.toFixed(2) : '—'}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {s.spi !== null ? s.spi.toFixed(2) : '—'}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {fmtMoney(s.estimateAtCompletion, currency)}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {s.notes ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

function KpiCard({
  label,
  value,
  sub,
  classes,
  icon: Icon,
}: {
  label: string
  value: string
  sub: string
  classes: string
  icon: typeof Activity
}) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${classes}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider opacity-80">
          {label}
        </span>
        <Icon className="h-3.5 w-3.5 opacity-70" />
      </div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      <div className="mt-0.5 text-xs opacity-70">{sub}</div>
    </div>
  )
}

function Legend({
  color,
  label,
  dashed,
}: {
  color: string
  label: string
  dashed?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <svg width="22" height="6">
        <line
          x1="0"
          x2="22"
          y1="3"
          y2="3"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={dashed ? '4 3' : undefined}
        />
      </svg>
      <span>{label}</span>
    </div>
  )
}
