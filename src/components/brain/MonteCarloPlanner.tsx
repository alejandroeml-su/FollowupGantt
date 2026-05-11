'use client'

/**
 * Wave P20-B · Brain Strategist — Monte Carlo Planner UI.
 *
 * Cliente que dispara `runMonteCarloAcrossProjects` y renderiza:
 *   - KPI superior: probabilidad de cumplir targetDate (opcional).
 *   - Tabla por proyecto: P10/P50/P90/spread.
 *   - Sparkline SVG inline del histograma del proyecto seleccionado.
 *
 * Sin libs externas (recharts NO usado aquí — sparkline custom).
 */

import { useMemo, useState, useTransition } from 'react'
import { clsx } from 'clsx'
import {
  Dices,
  AlertTriangle,
  Sparkles,
  CalendarCheck2,
  TrendingUp,
} from 'lucide-react'
import { runMonteCarloAcrossProjects } from '@/lib/brain/strategist/monte-carlo-actions'

type RunResponse = Awaited<ReturnType<typeof runMonteCarloAcrossProjects>>
type ProjectResult = RunResponse['result']['projects'][number]

export interface MonteCarloPlannerProps {
  /** Cantidad de proyectos activos en el workspace (pre-cargado SSR). */
  activeProjectCount: number
}

export function MonteCarloPlanner({ activeProjectCount }: MonteCarloPlannerProps) {
  const [iterations, setIterations] = useState(10_000)
  const [targetDate, setTargetDate] = useState<string>('')
  const [response, setResponse] = useState<RunResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const insufficient = activeProjectCount < 2

  const run = () => {
    setError(null)
    startTransition(async () => {
      try {
        const res = await runMonteCarloAcrossProjects({
          iterations,
          targetDate: targetDate
            ? new Date(`${targetDate}T23:59:59.000Z`).toISOString()
            : undefined,
        })
        setResponse(res)
        setSelectedProjectId(res.result.projects[0]?.projectId ?? null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al simular')
      }
    })
  }

  const selectedProject = useMemo<ProjectResult | null>(() => {
    if (!response || !selectedProjectId) return null
    return (
      response.result.projects.find((p) => p.projectId === selectedProjectId) ??
      null
    )
  }, [response, selectedProjectId])

  return (
    <div className="flex-1 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/20">
            <Dices className="h-6 w-6 text-violet-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">
              Monte Carlo Cross-Project
            </h2>
            <p className="text-sm text-muted-foreground">
              Simulador probabilístico de cierre · P10/P50/P90 con N(media, σ) por tarea
              + cross-deps · {activeProjectCount} proyectos activos.
            </p>
          </div>
        </div>
      </header>

      {insufficient && (
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
          <Sparkles className="mx-auto h-10 w-10 text-muted-foreground opacity-50" />
          <p className="mt-3 text-sm text-foreground">
            Se requieren al menos 2 proyectos activos para una simulación cross-project útil.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Activa más proyectos (status ACTIVE o PLANNING) y vuelve a esta página.
          </p>
        </div>
      )}

      {!insufficient && (
        <div className="space-y-6">
          {/* Controles */}
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_auto]">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Iteraciones
                <select
                  value={iterations}
                  onChange={(e) => setIterations(Number(e.target.value))}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  disabled={isPending}
                >
                  <option value={1000}>1,000 (rápido)</option>
                  <option value={10000}>10,000 (recomendado)</option>
                  <option value={50000}>50,000 (alta precisión)</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Fecha objetivo (opcional)
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  disabled={isPending}
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={run}
                  disabled={isPending}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50 sm:w-auto"
                >
                  <Dices className={clsx('h-4 w-4', isPending && 'animate-pulse')} />
                  {isPending
                    ? 'Simulando…'
                    : `Ejecutar Monte Carlo (${iterations.toLocaleString('es-MX')})`}
                </button>
              </div>
            </div>
          </section>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {!response && !error && !isPending && (
            <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
              <TrendingUp className="mx-auto h-10 w-10 text-muted-foreground opacity-50" />
              <p className="mt-3 text-sm text-foreground">
                Pulsa <strong>Ejecutar Monte Carlo</strong> para correr la simulación.
              </p>
            </div>
          )}

          {response && (
            <>
              <KpiBanner response={response} />
              <ProjectTable
                response={response}
                selectedProjectId={selectedProjectId}
                onSelect={setSelectedProjectId}
              />
              {selectedProject && <Sparkline project={selectedProject} />}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function KpiBanner({ response }: { response: RunResponse }) {
  const { result, probabilityOnTime, targetDate, scanned } = response
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    })

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <KpiCard
        icon={CalendarCheck2}
        tone="violet"
        label="Cierre portafolio · P50"
        value={fmtDate(result.portfolio.totalFinishP50)}
        sub={`P10 ${fmtDate(result.portfolio.totalFinishP10)} · P90 ${fmtDate(result.portfolio.totalFinishP90)}`}
      />
      <KpiCard
        icon={TrendingUp}
        tone="emerald"
        label={
          probabilityOnTime !== null && targetDate
            ? `Probabilidad de cumplir ${fmtDate(targetDate)}`
            : 'Probabilidad de cumplir target'
        }
        value={
          probabilityOnTime !== null
            ? `${Math.round(probabilityOnTime * 100)}%`
            : '—'
        }
        sub={
          probabilityOnTime === null
            ? 'Selecciona una fecha objetivo para calcular.'
            : probabilityOnTime > 0.75
              ? 'Alta confianza · plan ejecutable.'
              : probabilityOnTime > 0.4
                ? 'Confianza media · monitorea cuellos.'
                : 'Baja confianza · re-planea o reduce alcance.'
        }
      />
      <KpiCard
        icon={Dices}
        tone="amber"
        label="Cobertura del análisis"
        value={`${scanned.projects} proyectos`}
        sub={`${scanned.tasks} tareas · ${scanned.crossDeps} cross-deps · ${result.iterations.toLocaleString('es-MX')} iter`}
      />
    </section>
  )
}

function KpiCard({
  icon: Icon,
  tone,
  label,
  value,
  sub,
}: {
  icon: typeof Dices
  tone: 'violet' | 'emerald' | 'amber'
  label: string
  value: string
  sub: string
}) {
  const toneClasses = {
    violet: 'from-violet-500/15 border-violet-500/30 text-violet-300',
    emerald: 'from-emerald-500/15 border-emerald-500/30 text-emerald-300',
    amber: 'from-amber-500/15 border-amber-500/30 text-amber-300',
  }[tone]
  return (
    <article
      className={clsx(
        'rounded-xl border bg-gradient-to-br via-card to-card p-4',
        toneClasses,
      )}
    >
      <header className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </header>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </article>
  )
}

function ProjectTable({
  response,
  selectedProjectId,
  onSelect,
}: {
  response: RunResponse
  selectedProjectId: string | null
  onSelect: (id: string) => void
}) {
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    })
  const fmtSpreadDays = (p10Iso: string, p90Iso: string) => {
    const ms = new Date(p90Iso).getTime() - new Date(p10Iso).getTime()
    return Math.round(ms / (1000 * 60 * 60 * 24))
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-violet-200">
          Cierre por proyecto · {response.result.projects.length}
        </h3>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-background/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Proyecto</th>
              <th className="px-4 py-2 text-left">P10</th>
              <th className="px-4 py-2 text-left">P50</th>
              <th className="px-4 py-2 text-left">P90</th>
              <th className="px-4 py-2 text-right">Spread (días)</th>
            </tr>
          </thead>
          <tbody>
            {response.result.projects.map((p) => {
              const isSelected = p.projectId === selectedProjectId
              const spread = fmtSpreadDays(p.p10, p.p90)
              return (
                <tr
                  key={p.projectId}
                  onClick={() => onSelect(p.projectId)}
                  className={clsx(
                    'cursor-pointer border-t border-border transition-colors',
                    isSelected
                      ? 'bg-violet-500/15 text-foreground'
                      : 'hover:bg-background/40',
                  )}
                >
                  <td className="px-4 py-2 font-medium">{p.projectName}</td>
                  <td className="px-4 py-2 text-emerald-300">{fmtDate(p.p10)}</td>
                  <td className="px-4 py-2 text-foreground">{fmtDate(p.p50)}</td>
                  <td className="px-4 py-2 text-rose-300">{fmtDate(p.p90)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {spread}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Sparkline({ project }: { project: ProjectResult }) {
  // Histograma binned ya viene del simulador.
  const { bins, min, max, binSizeDays } = project.histogram
  const maxBin = bins.reduce((m, v) => (v > m ? v : m), 0)
  const W = 480
  const H = 110
  const padX = 4
  const padY = 8
  const usableW = W - padX * 2
  const usableH = H - padY * 2
  const barW = usableW / bins.length

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-violet-200">
          Distribución · {project.projectName}
        </h3>
        <p className="text-[10px] text-muted-foreground">
          mean {project.meanDays.toFixed(1)}d · σ {project.stdDays.toFixed(1)}d ·
          rango {min.toFixed(0)}–{max.toFixed(0)}d · bin {binSizeDays.toFixed(1)}d
        </p>
      </header>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-28 w-full"
        role="img"
        aria-label={`Histograma de ${project.projectName}`}
      >
        {bins.map((count, i) => {
          const h = maxBin === 0 ? 0 : (count / maxBin) * usableH
          const x = padX + i * barW
          const y = H - padY - h
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={Math.max(1, barW - 1)}
              height={h}
              className="fill-violet-500/80"
            />
          )
        })}
        <line
          x1={padX}
          x2={W - padX}
          y1={H - padY}
          y2={H - padY}
          className="stroke-border"
          strokeWidth={1}
        />
      </svg>
    </section>
  )
}
