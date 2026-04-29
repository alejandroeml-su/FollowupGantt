'use client'

import { useMemo } from 'react'
import { clsx } from 'clsx'
import {
  computeCpm,
  type CpmInput,
  type CpmDependencyInput,
} from '@/lib/scheduling/cpm'
import {
  GanttDependencyLayer,
  type GanttDependencyEdge,
  type GanttTaskPosition,
} from '@/components/interactions/GanttDependencyLayer'

const PROJECT_START = new Date('2026-05-01T00:00:00Z')
const DAY_WIDTH = 40
const RANGE_DAYS = 30
const ROW_HEIGHT = 40
const LABEL_WIDTH = 200

interface DemoTask {
  id: string
  title: string
  duration: number
  isMilestone: boolean
}

const DEMO_TASKS: DemoTask[] = [
  { id: 't1', title: 'Kick-off',                  duration: 1, isMilestone: false },
  { id: 't2', title: 'Análisis requerimientos',   duration: 4, isMilestone: false },
  { id: 't3', title: 'Diseño UI',                 duration: 5, isMilestone: false },
  { id: 't4', title: 'Diseño backend',            duration: 4, isMilestone: false },
  { id: 't5', title: 'Hito · Diseño aprobado',    duration: 0, isMilestone: true  },
  { id: 't6', title: 'Implementación frontend',   duration: 6, isMilestone: false },
  { id: 't7', title: 'Implementación backend',    duration: 7, isMilestone: false },
  { id: 't8', title: 'QA',                        duration: 3, isMilestone: false },
  { id: 't9', title: 'UAT',                       duration: 2, isMilestone: false },
  { id: 't10', title: 'Hito · Go-Live',           duration: 0, isMilestone: true  },
]

const DEMO_DEPS: CpmDependencyInput[] = [
  { predecessorId: 't1', successorId: 't2', type: 'FS', lag: 0 },
  { predecessorId: 't2', successorId: 't3', type: 'FS', lag: 0 },
  { predecessorId: 't2', successorId: 't4', type: 'FS', lag: 0 },
  { predecessorId: 't7', successorId: 't8', type: 'FS', lag: 0 },
  { predecessorId: 't8', successorId: 't9', type: 'FS', lag: 0 },
]

// Para un demo más rico añadimos 2 deps extra que conectan el hito con
// implementación y el cierre — total 7 deps FS (cumple "≥ 5").
const ALL_DEPS: CpmDependencyInput[] = [
  ...DEMO_DEPS,
  { predecessorId: 't3', successorId: 't5', type: 'FS', lag: 0 },
  { predecessorId: 't4', successorId: 't5', type: 'FS', lag: 0 },
  { predecessorId: 't5', successorId: 't6', type: 'FS', lag: 0 },
  { predecessorId: 't5', successorId: 't7', type: 'FS', lag: 0 },
  { predecessorId: 't9', successorId: 't10', type: 'FS', lag: 0 },
]

export function PocGanttClient() {
  const cpm = useMemo(() => {
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: DEMO_TASKS.map((t) => ({
        id: t.id,
        duration: t.duration,
        isMilestone: t.isMilestone,
      })),
      dependencies: ALL_DEPS,
    }
    return computeCpm(input)
  }, [])

  // Set de IDs críticas para colorear flechas y barras
  const criticalSet = useMemo(
    () => new Set(cpm.criticalPath),
    [cpm.criticalPath],
  )

  // Posiciones (relativas al contenedor del grid, no al label izquierdo)
  const positions = useMemo<GanttTaskPosition[]>(() => {
    return DEMO_TASKS.map((t, i) => {
      const r = cpm.results.get(t.id)
      const es = r?.ES ?? 0
      const ef = r?.EF ?? 0
      const left = es * DAY_WIDTH
      const right = Math.max(left + DAY_WIDTH, ef * DAY_WIDTH)
      const middleY = i * ROW_HEIGHT + ROW_HEIGHT / 2
      return { id: t.id, left, right, middleY }
    })
  }, [cpm.results])

  // Edges para la capa SVG: marca como críticas las que conectan dos
  // tareas críticas (heurística simple para POC).
  const edges = useMemo<GanttDependencyEdge[]>(() => {
    return ALL_DEPS.map((d) => ({
      predecessorId: d.predecessorId,
      successorId: d.successorId,
      type: d.type,
      isCritical:
        criticalSet.has(d.predecessorId) && criticalSet.has(d.successorId),
    }))
  }, [criticalSet])

  const totalGridWidth = RANGE_DAYS * DAY_WIDTH
  const totalGridHeight = DEMO_TASKS.length * ROW_HEIGHT

  return (
    <div className="space-y-4">
      <div className="flex gap-6 text-xs text-muted-foreground">
        <div>
          <span className="text-foreground font-medium">Duración:</span>{' '}
          {cpm.projectDuration} días
        </div>
        <div>
          <span className="text-foreground font-medium">Ruta crítica:</span>{' '}
          {cpm.criticalPath.join(' → ')}
        </div>
        <div>
          <span className="text-foreground font-medium">Warnings:</span>{' '}
          {cpm.warnings.length}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-subtle/80 shadow-sm">
        {/* Header de días */}
        <div className="flex border-b border-border">
          <div
            className="flex shrink-0 items-center border-r border-border bg-card p-3 text-sm font-medium text-foreground/90"
            style={{ width: LABEL_WIDTH }}
          >
            Tarea
          </div>
          <div
            className="flex bg-background/95"
            style={{ width: totalGridWidth }}
          >
            {Array.from({ length: RANGE_DAYS }).map((_, i) => {
              const d = new Date(PROJECT_START)
              d.setUTCDate(d.getUTCDate() + i)
              const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6
              return (
                <div
                  key={i}
                  className={clsx(
                    'shrink-0 border-r border-border/50 p-2 text-center text-[10px] font-medium uppercase',
                    isWeekend
                      ? 'bg-card/60 text-muted-foreground'
                      : 'text-muted-foreground',
                  )}
                  style={{ width: DAY_WIDTH }}
                >
                  <div>{d.getUTCDate()}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Grid de tareas */}
        <div className="flex">
          {/* Columna labels */}
          <div
            className="shrink-0 border-r border-border"
            style={{ width: LABEL_WIDTH }}
          >
            {DEMO_TASKS.map((t) => {
              const isCritical = criticalSet.has(t.id)
              return (
                <div
                  key={t.id}
                  className={clsx(
                    'flex items-center px-3 text-sm border-b border-border/50',
                    isCritical && 'text-red-400 font-medium',
                  )}
                  style={{ height: ROW_HEIGHT }}
                  title={t.title}
                >
                  <span className="truncate">{t.title}</span>
                </div>
              )
            })}
          </div>

          {/* Lienzo del Gantt: posición relative para anclar el SVG absoluto */}
          <div
            className="relative"
            style={{ width: totalGridWidth, height: totalGridHeight }}
          >
            {/* Grid columnas (líneas verticales) */}
            <div aria-hidden className="pointer-events-none absolute inset-0 flex">
              {Array.from({ length: RANGE_DAYS }).map((_, i) => (
                <div
                  key={i}
                  className="shrink-0 border-r border-border/30"
                  style={{ width: DAY_WIDTH }}
                />
              ))}
            </div>

            {/* Filas (línea horizontal por fila) */}
            {DEMO_TASKS.map((t, i) => (
              <div
                key={t.id}
                className="absolute left-0 right-0 border-b border-border/30"
                style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
              />
            ))}

            {/* Barras de tareas */}
            {DEMO_TASKS.map((t, i) => {
              const r = cpm.results.get(t.id)
              if (!r) return null
              const isCritical = r.isCritical
              const left = r.ES * DAY_WIDTH
              const width = Math.max(
                t.isMilestone ? 16 : DAY_WIDTH,
                (r.EF - r.ES) * DAY_WIDTH,
              )
              const middleY = i * ROW_HEIGHT + ROW_HEIGHT / 2

              if (t.isMilestone) {
                return (
                  <div
                    key={t.id}
                    className={clsx(
                      'absolute z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 shadow',
                      isCritical ? 'bg-red-500' : 'bg-amber-400',
                    )}
                    style={{ left: left + DAY_WIDTH / 2, top: middleY }}
                    title={`${t.title} (${r.startDate.toISOString().slice(0, 10)})`}
                  />
                )
              }
              return (
                <div
                  key={t.id}
                  className={clsx(
                    'absolute z-10 h-6 -translate-y-1/2 rounded-md border shadow-sm',
                    isCritical
                      ? 'border-red-500/50 bg-red-900/40'
                      : 'border-emerald-500/50 bg-emerald-900/40',
                  )}
                  style={{ left, width, top: middleY }}
                  title={`${t.title} · ES=${r.ES} EF=${r.EF} float=${r.totalFloat}`}
                />
              )
            })}

            {/* Capa SVG con flechas */}
            <GanttDependencyLayer
              tasks={positions}
              dependencies={edges}
              width={totalGridWidth}
              height={totalGridHeight}
            />
          </div>
        </div>
      </div>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Datos CPM crudos</summary>
        <pre className="mt-2 overflow-auto rounded bg-card p-3 text-[11px]">
          {JSON.stringify(
            {
              projectDuration: cpm.projectDuration,
              criticalPath: cpm.criticalPath,
              warnings: cpm.warnings,
              results: Array.from(cpm.results.values()),
            },
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  )
}
