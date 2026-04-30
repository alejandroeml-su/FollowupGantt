'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { clsx } from 'clsx'
import type { SerializedTask } from '@/lib/types'
import { updateTaskDates, shiftTaskDates } from '@/lib/actions/schedule'
import { createDependency } from '@/lib/actions/dependencies'
import { useHorizontalDrag } from '@/lib/hooks/useHorizontalDrag'
import { TaskWithContextMenu } from './TaskContextMenuItems'
import { TaskDrawer } from './TaskDrawer'
import { TaskDrawerContent } from './TaskDrawerContent'
import { useUIStore } from '@/lib/stores/ui'
import { useTaskShortcuts } from '@/lib/hooks/useTaskShortcuts'
import { toast } from './Toaster'
import { TaskFiltersBar } from './TaskFiltersBar'
import { EMPTY_TASK_FILTERS, filterTasks, type TaskFilters } from '@/lib/taskFilters'
import {
  GanttDependencyLayer,
  type GanttDependencyEdge,
  type GanttTaskPosition,
} from './GanttDependencyLayer'

type ParentOption = Pick<SerializedTask, 'id' | 'title' | 'mnemonic'> & {
  project?: { id: string; name: string } | null
  projectId?: string
}

/** CPM info por tarea (subset serializable que llega del RSC). */
export type GanttCpmInfo = {
  id: string
  ES: number
  EF: number
  LS: number
  LF: number
  totalFloat: number
  isCritical: boolean
}

/** Dependencia serializable con tipo Prisma (mapeada a 2-letras para la capa SVG). */
export type GanttDependencyDescriptor = {
  predecessorId: string
  successorId: string
  type: 'FS' | 'SS' | 'FF' | 'SF'
  lagDays: number
}

type Props = {
  tasks: SerializedTask[]
  /** Primera fecha visible (UTC, inclusive) */
  rangeStart: string
  /** Días a mostrar */
  rangeDays: number
  projects: { id: string; name: string; areaId?: string | null }[]
  users: { id: string; name: string }[]
  gerencias?: { id: string; name: string }[]
  areas?: { id: string; name: string; gerenciaId?: string | null }[]
  allTasks?: ParentOption[]
  /** Resultados CPM agregados de todos los proyectos visibles (HU-1.2). */
  cpmByTaskId?: Record<string, GanttCpmInfo>
  /** Dependencias inter-tareas (todas las que conectan tareas visibles). */
  dependencies?: GanttDependencyDescriptor[]
  /** Si CPM detectó al menos un ciclo en cualquier proyecto, render banner. */
  hasCpmCycle?: boolean
}

const DAY_WIDTH = 40 // px por día — balance legibilidad / densidad
const ROW_HEIGHT = 40 // px — altura fija por fila para alinear SVG <-> barras

function parseISO(s: string | null | undefined): Date | null {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function daysBetween(from: Date, to: Date): number {
  const MS = 86_400_000
  return Math.round(
    (Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) -
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) /
      MS,
  )
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + days)
  return out
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function announce(msg: string) {
  const region = document.getElementById('a11y-live')
  if (region) {
    region.textContent = ''
    setTimeout(() => (region.textContent = msg), 20)
  }
}

function parseActionError(err: unknown): { code: string; detail: string } {
  const msg = err instanceof Error ? err.message : String(err)
  const m = msg.match(/^\[([A-Z_]+)\]\s*(.+)$/)
  return m ? { code: m[1], detail: m[2] } : { code: 'UNKNOWN', detail: msg }
}

export function GanttBoardClient({
  tasks,
  rangeStart,
  rangeDays,
  projects,
  users,
  gerencias = [],
  areas = [],
  cpmByTaskId,
  dependencies,
  hasCpmCycle,
}: Props) {
  const start = useMemo(() => new Date(rangeStart), [rangeStart])
  const days = useMemo(
    () =>
      Array.from({ length: rangeDays }, (_, i) => {
        const d = addDays(start, i)
        return d
      }),
    [start, rangeDays],
  )

  const [local, setLocal] = useState(tasks)
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_TASK_FILTERS)
  const visibleLocal = useMemo(() => filterTasks(local, filters), [local, filters])
  // Re-sync con el snapshot del server tras revalidatePath (patrón RSC).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(tasks)
  }, [tasks])

  const [focusedId, setFocusedId] = useState<string | null>(local[0]?.id ?? null)
  const orderedIds = useMemo(() => visibleLocal.map((t) => t.id), [visibleLocal])

  const drawerTaskId = useUIStore((s) => s.drawerTaskId)
  const drawerTask = useMemo(
    () => local.find((t) => t.id === drawerTaskId) ?? null,
    [local, drawerTaskId],
  )

  useTaskShortcuts({
    focusedTaskId: focusedId,
    orderedTaskIds: orderedIds,
    onFocus: setFocusedId,
  })

  // Keyboard shift/resize sobre la barra con foco
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!focusedId) return
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable)
          return
      }
      const task = local.find((t) => t.id === focusedId)
      if (!task) return
      const s = parseISO(task.startDate)
      const eD = parseISO(task.endDate)
      if (!s || !eD) return

      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      if (!dir) return

      // Shift = resize end date; Alt = resize start; sin modifier = shift ambos
      if (e.shiftKey) {
        e.preventDefault()
        commitDates(task.id, s, addDays(eD, dir), 'resize-end')
      } else if (e.altKey) {
        e.preventDefault()
        commitDates(task.id, addDays(s, dir), eD, 'resize-start')
      } else if (!e.ctrlKey && !e.metaKey) {
        // Evitar colisión con ArrowLeft/Right del shortcut hook (que usa up/down)
        e.preventDefault()
        commitShift(task.id, dir)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId, local])

  async function commitShift(id: string, deltaDays: number) {
    // Optimista
    setLocal((prev) =>
      prev.map((t) =>
        t.id !== id
          ? t
          : {
              ...t,
              startDate: t.startDate
                ? addDays(new Date(t.startDate), deltaDays).toISOString()
                : null,
              endDate: t.endDate
                ? addDays(new Date(t.endDate), deltaDays).toISOString()
                : null,
            },
      ),
    )
    try {
      await shiftTaskDates(id, deltaDays)
      const t = local.find((x) => x.id === id)
      const s = t && parseISO(t.startDate)
      const e = t && parseISO(t.endDate)
      announce(
        `Tarea desplazada ${deltaDays > 0 ? '+' : ''}${deltaDays} día${Math.abs(deltaDays) !== 1 ? 's' : ''}` +
          (s && e ? ` · ${fmt(addDays(s, deltaDays))} → ${fmt(addDays(e, deltaDays))}` : ''),
      )
    } catch (err) {
      const { code, detail } = parseActionError(err)
      toast.error(code === 'DEPENDENCY_VIOLATION' ? `Dependencia · ${detail}` : detail)
      setLocal(tasks)
    }
  }

  async function commitDates(
    id: string,
    startDate: Date,
    endDate: Date,
    kind: 'shift' | 'resize-start' | 'resize-end',
  ) {
    setLocal((prev) =>
      prev.map((t) =>
        t.id !== id
          ? t
          : {
              ...t,
              startDate: startDate.toISOString(),
              endDate: endDate.toISOString(),
            },
      ),
    )
    try {
      await updateTaskDates(id, startDate, endDate)
      announce(
        `${kind === 'resize-start' ? 'Inicio' : kind === 'resize-end' ? 'Fin' : 'Fechas'} ajustado: ${fmt(startDate)} → ${fmt(endDate)}`,
      )
    } catch (err) {
      const { code, detail } = parseActionError(err)
      toast.error(
        code === 'INVALID_RANGE'
          ? `Rango inválido · ${detail}`
          : code === 'DEPENDENCY_VIOLATION'
            ? `Dependencia · ${detail}`
            : detail,
      )
      setLocal(tasks)
    }
  }

  const totalWidth = rangeDays * DAY_WIDTH
  const canvasHeight = Math.max(ROW_HEIGHT, visibleLocal.length * ROW_HEIGHT)

  // ─── HU-1.3: modo conexión (drag-handle para crear dependencia) ───
  //
  // `connection.from` apunta al taskId origen y a las coordenadas (en el
  // sistema del canvas) del punto donde nació el drag — ahí ancla la línea
  // SVG. `cursor` se actualiza en cada mousemove. `targetTaskId` se setea
  // cuando el cursor está dentro de una barra (hover-target). `mouseup`
  // cierra el modo: si hay target válido → invoca server action; si no
  // (drop fuera o Escape) → cancela.
  const canvasRef = useRef<HTMLDivElement>(null)
  const [connection, setConnection] = useState<{
    fromTaskId: string
    fromX: number
    fromY: number
    cursorX: number
    cursorY: number
    targetTaskId: string | null
  } | null>(null)
  const connectionRef = useRef(connection)
  connectionRef.current = connection

  /**
   * Convierte coordenadas globales (clientX/Y del MouseEvent) al sistema
   * de píxeles del canvas. Si no hay canvas montado (caso degenerado),
   * retorna {0,0}.
   */
  const toCanvasCoords = useCallback((clientX: number, clientY: number) => {
    const el = canvasRef.current
    if (!el) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    return { x: clientX - r.left, y: clientY - r.top }
  }, [])

  const beginConnection = useCallback(
    (taskId: string, fromX: number, fromY: number) => {
      setConnection({
        fromTaskId: taskId,
        fromX,
        fromY,
        cursorX: fromX,
        cursorY: fromY,
        targetTaskId: null,
      })
    },
    [],
  )

  // Mousemove global mientras dura el modo conexión — actualiza la punta
  // de la línea temporal y resuelve hover-target consultando el dataset
  // `data-gantt-task-id` de los elementos bajo el cursor.
  useEffect(() => {
    if (!connection) return
    const onMove = (e: MouseEvent) => {
      const cur = connectionRef.current
      if (!cur) return
      const { x, y } = toCanvasCoords(e.clientX, e.clientY)
      // Detección de target via elementsFromPoint — funciona aunque la
      // capa SVG esté encima (es pointer-events:none).
      let targetId: string | null = null
      if (typeof document !== 'undefined') {
        const els = document.elementsFromPoint(e.clientX, e.clientY)
        for (const el of els) {
          if (!(el instanceof HTMLElement)) continue
          const id = el.dataset.ganttTaskId
          if (id && id !== cur.fromTaskId) {
            targetId = id
            break
          }
        }
      }
      setConnection({ ...cur, cursorX: x, cursorY: y, targetTaskId: targetId })
    }
    const onUp = async () => {
      const cur = connectionRef.current
      setConnection(null)
      if (!cur) return
      const targetId = cur.targetTaskId
      if (!targetId) return
      // Self-dep ya filtrado en mousemove (targetId !== fromTaskId).
      try {
        await createDependency({
          predecessorId: cur.fromTaskId,
          successorId: targetId,
          type: 'FS',
          lagDays: 0,
        })
        toast.success('Dependencia FS creada')
      } catch (err) {
        const { code, detail } = parseActionError(err)
        const msg =
          code === 'CYCLE_DETECTED'
            ? `Ciclo detectado · ${detail}`
            : code === 'DEPENDENCY_EXISTS'
              ? `Ya existe · ${detail}`
              : code === 'CROSS_PROJECT'
                ? `Proyectos distintos · ${detail}`
                : detail
        toast.error(msg)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConnection(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [connection, toCanvasCoords])

  // Posiciones de barras visibles (para la capa SVG). Solo tareas con fechas
  // dentro del rango aparecen aquí; el resto no tiene flechas.
  const positions = useMemo<GanttTaskPosition[]>(() => {
    const result: GanttTaskPosition[] = []
    visibleLocal.forEach((task, i) => {
      const s = parseISO(task.startDate)
      const e = parseISO(task.endDate)
      if (!s || !e) return
      const startDay = Math.max(0, daysBetween(start, s))
      const endDay = Math.min(rangeDays, daysBetween(start, e) + 1)
      if (endDay <= 0 || startDay >= rangeDays) return
      const left = startDay * DAY_WIDTH
      const width = Math.max(DAY_WIDTH, (endDay - startDay) * DAY_WIDTH)
      const right = left + width
      const middleY = i * ROW_HEIGHT + ROW_HEIGHT / 2
      result.push({ id: task.id, left, right, middleY })
    })
    return result
  }, [visibleLocal, start, rangeDays])

  // Edges para la capa SVG: solo los que conectan tareas visibles. La capa
  // del POC ya filtra por type !== 'FS'; las demás se difieren a HU-1.3.
  const visibleIdSet = useMemo(
    () => new Set(visibleLocal.map((t) => t.id)),
    [visibleLocal],
  )
  const criticalIds = useMemo(() => {
    const out = new Set<string>()
    if (!cpmByTaskId) return out
    for (const id of visibleIdSet) {
      if (cpmByTaskId[id]?.isCritical) out.add(id)
    }
    return out
  }, [cpmByTaskId, visibleIdSet])
  const edges = useMemo<GanttDependencyEdge[]>(() => {
    if (!dependencies) return []
    return dependencies
      .filter(
        (d) => visibleIdSet.has(d.predecessorId) && visibleIdSet.has(d.successorId),
      )
      .map((d) => ({
        predecessorId: d.predecessorId,
        successorId: d.successorId,
        type: d.type,
        isCritical:
          criticalIds.has(d.predecessorId) && criticalIds.has(d.successorId),
      }))
  }, [dependencies, visibleIdSet, criticalIds])

  return (
    <>
      <TaskFiltersBar
        value={filters}
        onChange={setFilters}
        gerencias={gerencias}
        areas={areas}
        projects={projects}
        users={users}
        className="rounded-lg mb-4 border border-border"
      />

      {hasCpmCycle && (
        <div
          role="alert"
          className="mb-3 rounded-md border border-red-500/40 bg-red-950/30 px-3 py-2 text-xs text-red-300"
        >
          CPM: se detectó al menos un ciclo en las dependencias. Las flechas
          afectadas se omiten hasta que se rompa el ciclo.
        </div>
      )}

      <div className="rounded-xl border border-border bg-subtle/80 shadow-sm">
        {/* Header: etiquetas de nombre + escala de días */}
        <div className="flex border-b border-border">
          <div className="flex w-64 shrink-0 items-center border-r border-border bg-card p-4 text-sm font-medium text-foreground/90">
            Nombre de la Tarea
          </div>
          <div
            className="flex overflow-x-auto bg-background/95"
            style={{ minWidth: totalWidth }}
          >
            {days.map((d) => {
              const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6
              return (
                <div
                  key={d.toISOString()}
                  className={clsx(
                    'shrink-0 border-r border-border/50 p-2 text-center text-[10px] font-medium uppercase',
                    isWeekend ? 'bg-card/60 text-muted-foreground' : 'text-muted-foreground',
                  )}
                  style={{ width: DAY_WIDTH }}
                >
                  <div>{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                  <div className="text-muted-foreground">{d.getUTCDate()}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Cuerpo: dos columnas hermanas (labels + canvas relative compartido). */}
        {visibleLocal.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {local.length === 0
              ? 'No hay tareas planificadas en este rango.'
              : 'Ninguna tarea coincide con los filtros.'}
          </div>
        ) : (
          <div className="flex">
            {/* Columna de labels — una fila por tarea, alineada en altura con el canvas. */}
            <div className="w-64 shrink-0 border-r border-border">
              {visibleLocal.map((task) => (
                <GanttLabelRow
                  key={task.id}
                  task={task}
                  focused={focusedId === task.id}
                  onFocus={() => setFocusedId(task.id)}
                  rowHeight={ROW_HEIGHT}
                />
              ))}
            </div>

            {/* Canvas único: relative para anclar la capa SVG global y todas las barras. */}
            <div
              ref={canvasRef}
              className={clsx('relative', connection && 'cursor-crosshair')}
              style={{ width: totalWidth, height: canvasHeight, minWidth: totalWidth }}
            >
              {/* Tinte de fines de semana — columnas verticales por día. */}
              <div aria-hidden className="pointer-events-none absolute inset-0 flex">
                {days.map((d, i) => {
                  const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6
                  return (
                    <div
                      key={i}
                      className={clsx(
                        'shrink-0 border-r border-border/30',
                        isWeekend && 'bg-card/40',
                      )}
                      style={{ width: DAY_WIDTH }}
                    />
                  )
                })}
              </div>

              {/* Líneas horizontales por fila + zona clickeable de la fila. */}
              {visibleLocal.map((task, i) => (
                <GanttBarSlot
                  key={task.id}
                  task={task}
                  index={i}
                  focused={focusedId === task.id}
                  onFocus={() => setFocusedId(task.id)}
                  rangeStart={start}
                  rangeDays={rangeDays}
                  rowHeight={ROW_HEIGHT}
                  cpm={cpmByTaskId?.[task.id]}
                  onShift={(delta) => commitShift(task.id, delta)}
                  onResizeStart={(delta) => {
                    const s = parseISO(task.startDate)
                    const e = parseISO(task.endDate)
                    if (!s || !e) return
                    commitDates(task.id, addDays(s, delta), e, 'resize-start')
                  }}
                  onResizeEnd={(delta) => {
                    const s = parseISO(task.startDate)
                    const e = parseISO(task.endDate)
                    if (!s || !e) return
                    commitDates(task.id, s, addDays(e, delta), 'resize-end')
                  }}
                  // HU-1.3: drag-handle activo solo si la tarea tiene fechas;
                  // se renderiza un círculo en el borde derecho de la barra.
                  isConnectionTarget={connection?.targetTaskId === task.id}
                  onConnectStart={(x, y) => beginConnection(task.id, x, y)}
                />
              ))}

              {/* Capa SVG superpuesta — flechas de dependencias FS (HU-1.2). */}
              {edges.length > 0 && (
                <GanttDependencyLayer
                  tasks={positions}
                  dependencies={edges}
                  width={totalWidth}
                  height={canvasHeight}
                />
              )}

              {/* HU-1.3: línea temporal del modo conexión. Va por encima
                  de la capa de dependencias persistentes. */}
              {connection && (
                <svg
                  aria-hidden
                  className="pointer-events-none absolute left-0 top-0"
                  width={totalWidth}
                  height={canvasHeight}
                  style={{ overflow: 'visible' }}
                >
                  <line
                    x1={connection.fromX}
                    y1={connection.fromY}
                    x2={connection.cursorX}
                    y2={connection.cursorY}
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeDasharray="4 2"
                    className={
                      connection.targetTaskId
                        ? 'text-emerald-500'
                        : 'text-indigo-500'
                    }
                  />
                </svg>
              )}
            </div>
          </div>
        )}
      </div>

      <TaskDrawer
        breadcrumbs={
          drawerTask ? (
            <>
              {drawerTask.project?.name}
              {' › '}
              <span className="text-foreground/90">
                #{drawerTask.id.substring(0, 6)}
              </span>
            </>
          ) : null
        }
        onNext={() => {
          if (!drawerTaskId) return
          const i = orderedIds.indexOf(drawerTaskId)
          const n = orderedIds[i + 1]
          if (n) useUIStore.getState().openDrawer(n)
        }}
        onPrev={() => {
          if (!drawerTaskId) return
          const i = orderedIds.indexOf(drawerTaskId)
          const p = orderedIds[i - 1]
          if (p) useUIStore.getState().openDrawer(p)
        }}
      >
        {drawerTask ? (
          <TaskDrawerContent
            task={drawerTask}
            projects={projects}
            users={users}
          />
        ) : null}
      </TaskDrawer>
    </>
  )
}

// ─────────────────── Label Row (columna izquierda) ───────────────────

function GanttLabelRow({
  task,
  focused,
  onFocus,
  rowHeight,
}: {
  task: SerializedTask
  focused: boolean
  onFocus: () => void
  rowHeight: number
}) {
  const openDrawer = useUIStore((st) => st.openDrawer)
  return (
    <TaskWithContextMenu ctx={{ taskId: task.id }}>
      <div
        className={clsx(
          'group flex cursor-pointer items-center gap-3 border-b border-border/50 px-4 transition-colors',
          focused ? 'bg-secondary/60' : 'hover:bg-secondary/30',
        )}
        style={{ height: rowHeight }}
        onClick={() => {
          onFocus()
          openDrawer(task.id)
        }}
      >
        <div
          className={clsx(
            'h-2 w-2 rounded-full',
            task.type === 'PMI_TASK' ? 'bg-emerald-500' : 'bg-indigo-500',
          )}
        />
        <span
          className="truncate text-sm font-medium text-foreground/90 group-hover:text-white"
          title={task.title}
        >
          {task.title}
        </span>
        {(task.comments?.length ?? 0) > 0 && (
          <span className="flex flex-shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground">
            <MessageSquare className="h-3 w-3" />
            {task.comments?.length}
          </span>
        )}
      </div>
    </TaskWithContextMenu>
  )
}

// ─────────────────── Bar Slot (canvas absoluto por fila) ───────────────────

function GanttBarSlot({
  task,
  index,
  focused,
  onFocus,
  rangeStart,
  rangeDays,
  rowHeight,
  cpm,
  onShift,
  onResizeStart,
  onResizeEnd,
  isConnectionTarget,
  onConnectStart,
}: {
  task: SerializedTask
  index: number
  focused: boolean
  onFocus: () => void
  rangeStart: Date
  rangeDays: number
  rowHeight: number
  cpm?: GanttCpmInfo
  onShift: (deltaDays: number) => void
  onResizeStart: (deltaDays: number) => void
  onResizeEnd: (deltaDays: number) => void
  /** True cuando el cursor está sobre esta barra durante un drag de conexión. */
  isConnectionTarget?: boolean
  /** Inicia el modo conexión desde esta barra (HU-1.3). x/y son coords del canvas. */
  onConnectStart?: (canvasX: number, canvasY: number) => void
}) {
  const s = parseISO(task.startDate)
  const e = parseISO(task.endDate)
  const hasDates = !!s && !!e

  // Px desde rangeStart
  const startDay = s ? Math.max(0, daysBetween(rangeStart, s)) : null
  const endDay = e
    ? Math.min(rangeDays, daysBetween(rangeStart, e) + 1)
    : null
  const left = startDay != null ? startDay * DAY_WIDTH : 0
  const width =
    startDay != null && endDay != null
      ? Math.max(DAY_WIDTH, (endDay - startDay) * DAY_WIDTH)
      : 0

  const bodyRef = useRef<HTMLDivElement>(null)

  const bodyDrag = useHorizontalDrag({
    dayWidth: DAY_WIDTH,
    onCommit: (deltaDays) => {
      if (deltaDays) onShift(deltaDays)
    },
  })
  const leftDrag = useHorizontalDrag({
    dayWidth: DAY_WIDTH,
    onCommit: (deltaDays) => {
      if (deltaDays) onResizeStart(deltaDays)
    },
  })
  const rightDrag = useHorizontalDrag({
    dayWidth: DAY_WIDTH,
    onCommit: (deltaDays) => {
      if (deltaDays) onResizeEnd(deltaDays)
    },
  })

  const isMilestone = !!task.isMilestone
  const progress = task.progress ?? 0
  const isCritical = !!cpm?.isCritical

  // Tooltip CPM (HU-2.4 simplificada): se construye solo si hay datos CPM.
  const cpmTooltip = cpm
    ? `${task.title}\n` +
      `ES: día ${cpm.ES} · EF: día ${cpm.EF}\n` +
      `LS: día ${cpm.LS} · LF: día ${cpm.LF}\n` +
      `Float: ${cpm.totalFloat} día${Math.abs(cpm.totalFloat) !== 1 ? 's' : ''}` +
      (cpm.isCritical ? '  · Crítica' : '')
    : task.title

  // Slot absoluto por fila — incluye línea horizontal de fila + barra/hito.
  return (
    <div
      className="absolute inset-x-0"
      style={{ top: index * rowHeight, height: rowHeight }}
    >
      {/* Línea horizontal de la fila (separador). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 border-b border-border/30"
      />

      {!hasDates && (
        <div
          className="absolute left-2 top-1/2 z-10 inline-flex -translate-y-1/2 items-center rounded border border-dashed border-border px-2 py-1 text-xs text-muted-foreground"
          onClick={onFocus}
        >
          Sin fechas
        </div>
      )}

      {hasDates && !isMilestone && (
        <div
          ref={bodyRef}
          role="slider"
          tabIndex={0}
          aria-label={`Barra de ${task.title}`}
          aria-valuemin={0}
          aria-valuemax={rangeDays}
          aria-valuenow={startDay ?? 0}
          aria-valuetext={`${fmt(s)} a ${fmt(e)}`}
          data-gantt-task-id={task.id}
          onFocus={onFocus}
          title={cpmTooltip}
          style={{
            left,
            width,
            transform: bodyDrag.isDragging
              ? `translateX(${bodyDrag.deltaPx}px)`
              : undefined,
          }}
          className={clsx(
            'group/bar absolute top-1/2 z-10 h-6 -translate-y-1/2 rounded-md shadow-sm',
            'flex cursor-grab active:cursor-grabbing',
            'border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500',
            isCritical
              ? 'border-red-500/60 bg-red-900/40'
              : task.type === 'PMI_TASK'
                ? 'border-emerald-500/50 bg-emerald-900/40'
                : 'border-indigo-500/50 bg-indigo-900/40',
            focused && 'ring-2 ring-indigo-500/60',
            isConnectionTarget && 'outline outline-2 outline-offset-2 outline-emerald-500',
            bodyDrag.isDragging && 'opacity-80',
          )}
          {...bodyDrag.dragProps}
        >
          {/* progreso (overlay clipeado) */}
          <div
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-md"
            aria-hidden
          >
            <div
              className={clsx(
                'h-full transition-all',
                isCritical
                  ? 'bg-red-500'
                  : task.type === 'PMI_TASK'
                    ? 'bg-emerald-500'
                    : 'bg-indigo-500',
              )}
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* handle izquierdo */}
          <div
            role="button"
            aria-label="Redimensionar inicio"
            className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize bg-white/10 hover:bg-white/20"
            {...leftDrag.dragProps}
            onClick={(e) => e.stopPropagation()}
          />
          {/* handle derecho */}
          <div
            role="button"
            aria-label="Redimensionar fin"
            className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-white/10 hover:bg-white/20"
            {...rightDrag.dragProps}
            onClick={(e) => e.stopPropagation()}
          />

          {/* HU-1.3 · drag-handle de conexión (borde derecho, hover-only).
              z-20 para quedar por encima del handle de resize. La detención
              del propagation evita que el mousedown active el body-drag
              antes de iniciar el modo conexión. */}
          {onConnectStart && (
            <div
              role="button"
              aria-label={`Crear dependencia desde ${task.title}`}
              className={clsx(
                'absolute right-0 top-1/2 z-20 h-2 w-2 -translate-y-1/2 translate-x-1/2 rounded-full',
                'cursor-crosshair bg-indigo-400 opacity-0 transition-opacity',
                'group-hover/bar:opacity-70 hover:opacity-100',
                isCritical && 'bg-red-400',
              )}
              onMouseDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                // Coordenadas del centro del handle en el sistema del canvas.
                // Como la barra está absoluta dentro del canvas, basta con
                // (left + width, middleY).
                const x = (left ?? 0) + (width ?? 0)
                const y = index * rowHeight + rowHeight / 2
                onConnectStart(x, y)
              }}
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}

      {hasDates && isMilestone && (
        <div
          role="img"
          aria-label={`Hito ${task.title} el ${fmt(s)}`}
          tabIndex={0}
          data-gantt-task-id={task.id}
          onFocus={onFocus}
          style={{
            left: left + DAY_WIDTH / 2 - 8,
            top: '50%',
            transform: bodyDrag.isDragging
              ? `translate(0, -50%) translateX(${bodyDrag.deltaPx}px) rotate(45deg)`
              : 'translate(0, -50%) rotate(45deg)',
          }}
          className={clsx(
            'absolute z-10 h-4 w-4 shadow-[0_0_10px_rgba(251,191,36,0.4)]',
            isCritical ? 'bg-red-500' : 'bg-amber-400',
            focused && 'ring-2 ring-amber-300',
            isConnectionTarget && 'outline outline-2 outline-offset-2 outline-emerald-500',
          )}
          title={cpmTooltip}
          {...bodyDrag.dragProps}
        />
      )}
    </div>
  )
}
