'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, MessageSquare } from 'lucide-react'
import { clsx } from 'clsx'
import type { SerializedTask } from '@/lib/types'
import type { BaselineSnapshot } from '@/lib/scheduling/baseline-snapshot'
import {
  buildVarianceMap,
  type TaskVariance,
  type VarianceClassification,
} from '@/lib/scheduling/baseline-variance'
import { GanttBaselineLayer } from './GanttBaselineLayer'
import { updateTaskDates, shiftTaskDates } from '@/lib/actions/schedule'
import {
  createDependency,
  deleteDependency,
  updateDependency,
} from '@/lib/actions/dependencies'
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
import {
  DependencyEditor,
  type DependencyEditorPayload,
} from './DependencyEditor'
import { CaptureBaselineButton } from './CaptureBaselineButton'
import { BaselineSelector, type BaselineOption } from './BaselineSelector'
import { BaselineTrendPanel } from './BaselineTrendPanel'
import { BaselineTrendToggle } from './BaselineTrendToggle'
import { ExportExcelButton } from './ExportExcelButton'
import { ExportMspButton } from './ExportMspButton'
import { DownloadTemplateButton } from './DownloadTemplateButton'
import { ImportExcelButton } from './ImportExcelButton'
import { ImportMspButton } from './ImportMspButton'
import { getBaselineSnapshot } from '@/lib/actions/baselines'

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
  /** Id de la fila en BD; necesario para `updateDependency` (HU-1.4). */
  id: string
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
  /** HU-3.1 — conteo de tareas no archivadas por proyecto, para habilitar el botón de captura. */
  taskCountByProject?: Record<string, number>
  /** HU-3.1/3.2 — conteo de líneas base por proyecto (cap soft 20). */
  baselineCountByProject?: Record<string, number>
  /** HU-3.2 — listado descriptivo de líneas base por proyecto, para el selector. */
  baselinesByProject?: Record<string, BaselineOption[]>
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
  taskCountByProject,
  baselineCountByProject,
  baselinesByProject,
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
  // HU-2.3 — toggle global "Solo ruta crítica" persistido en zustand. Al
  // activarse, el filtro se aplica DESPUÉS de los TaskFilters habituales
  // para que ambos puedan combinarse (p. ej. ruta crítica de un proyecto).
  const criticalOnly = useUIStore((s) => s.criticalOnly)
  const toggleCriticalOnly = useUIStore((s) => s.toggleCriticalOnly)
  const filteredByBar = useMemo(() => filterTasks(local, filters), [local, filters])
  const visibleLocal = useMemo(() => {
    if (!criticalOnly) return filteredByBar
    if (!cpmByTaskId) return filteredByBar
    return filteredByBar.filter((t) => cpmByTaskId[t.id]?.isCritical === true)
  }, [filteredByBar, criticalOnly, cpmByTaskId])
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
      const msg =
        code === 'DEPENDENCY_VIOLATION'
          ? `Dependencia · ${detail}`
          : code === 'NEGATIVE_FLOAT'
            ? `Holgura negativa · ${detail}`
            : code === 'CYCLE_DETECTED'
              ? `Ciclo detectado · ${detail}`
              : detail
      toast.error(msg)
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
            : code === 'NEGATIVE_FLOAT'
              ? `Holgura negativa · ${detail}`
              : code === 'CYCLE_DETECTED'
                ? `Ciclo detectado · ${detail}`
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

  // Pointer move global mientras dura el modo conexión — actualiza la punta
  // de la línea temporal y resuelve hover-target consultando el dataset
  // `data-gantt-task-id` de los elementos bajo el cursor. Usamos pointer
  // events (no mouse events) porque el handle inicia el drag con
  // `onPointerDown + preventDefault`, lo que suprime los mouse events
  // sintetizados subsecuentes (mousemove/mouseup) en el mismo gesto.
  useEffect(() => {
    if (!connection) return
    const onMove = (e: PointerEvent) => {
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
                : code === 'NEGATIVE_FLOAT'
                  ? `Holgura negativa · ${detail}`
                  : detail
        toast.error(msg)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConnection(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
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
      .filter((d) =>
        // HU-2.3 — en modo solo-crítica, ambos extremos deben estar en la
        // ruta crítica. Esto se cumple automáticamente cuando filtramos
        // visibleLocal por isCritical (visibleIdSet ya solo contiene
        // críticas), pero lo dejamos explícito como defensa en profundidad
        // por si se cambia el orden del filtrado.
        criticalOnly
          ? criticalIds.has(d.predecessorId) && criticalIds.has(d.successorId)
          : true,
      )
      .map((d) => ({
        id: d.id,
        predecessorId: d.predecessorId,
        successorId: d.successorId,
        type: d.type,
        lagDays: d.lagDays,
        isCritical:
          criticalIds.has(d.predecessorId) && criticalIds.has(d.successorId),
      }))
  }, [dependencies, visibleIdSet, criticalIds, criticalOnly])

  // HU-2.3 — anuncio vivo cuando cambia el toggle, con conteo en vivo.
  // Usamos un ref para evitar anunciar en el primer render (estado inicial
  // hidratado desde localStorage no debe disparar feedback sonoro).
  const criticalOnlyMounted = useRef(false)
  useEffect(() => {
    if (!criticalOnlyMounted.current) {
      criticalOnlyMounted.current = true
      return
    }
    if (criticalOnly) {
      announce(
        `Mostrando solo ruta crítica: ${visibleLocal.length} tarea${
          visibleLocal.length !== 1 ? 's' : ''
        }, ${edges.length} dependencia${edges.length !== 1 ? 's' : ''}`,
      )
    } else {
      announce('Mostrando todas las tareas')
    }
    // visibleLocal/edges se evalúan en el render donde el toggle cambió,
    // por lo que no necesitamos suscribirnos a ellos como deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criticalOnly])

  // ─── HU-1.4 · estado del editor de dependencias y del menú contextual ───
  //
  // `contextMenu` se setea al click derecho sobre la flecha → renderiza un
  // mini-popover con [Editar / Cambiar tipo › / Eliminar]. El sub-menú
  // "Cambiar tipo" llama updateDependency directamente; los otros items
  // abren el `DependencyEditor` (Dialog).
  const [editorState, setEditorState] = useState<{
    payload: DependencyEditorPayload
    position: { x: number; y: number }
  } | null>(null)
  const [depMenu, setDepMenu] = useState<{
    edge: GanttDependencyEdge
    position: { x: number; y: number }
  } | null>(null)

  // Mapa rápido id → tarea para construir el payload del editor (mnemonic+title).
  const taskById = useMemo(() => {
    const m = new Map<string, SerializedTask>()
    for (const t of local) m.set(t.id, t)
    return m
  }, [local])

  function buildEditorPayload(
    edge: GanttDependencyEdge,
  ): DependencyEditorPayload | null {
    const dep = dependencies?.find((d) => d.id === edge.id)
    if (!dep) return null
    const pred = taskById.get(dep.predecessorId)
    const succ = taskById.get(dep.successorId)
    if (!pred || !succ) return null
    return {
      id: dep.id,
      predecessorId: dep.predecessorId,
      successorId: dep.successorId,
      type: dep.type,
      lagDays: dep.lagDays,
      predecessor: { mnemonic: pred.mnemonic, title: pred.title },
      successor: { mnemonic: succ.mnemonic, title: succ.title },
    }
  }

  function openEditorFromEdge(
    edge: GanttDependencyEdge,
    pos: { x: number; y: number },
  ) {
    const payload = buildEditorPayload(edge)
    if (!payload) {
      toast.error('No se pudo cargar la dependencia')
      return
    }
    setEditorState({ payload, position: pos })
  }

  async function changeDepType(
    edge: GanttDependencyEdge,
    nextType: 'FS' | 'SS' | 'FF' | 'SF',
  ) {
    if (edge.type === nextType) return
    try {
      await updateDependency({ id: edge.id, type: nextType })
      toast.success(`Tipo cambiado a ${nextType}`)
      announce(`Tipo cambiado a ${nextType}`)
    } catch (err) {
      const { code, detail } = parseActionError(err)
      toast.error(
        code === 'CYCLE_DETECTED' ? `Ciclo detectado · ${detail}` : detail,
      )
    }
  }

  async function deleteEdge(edge: GanttDependencyEdge) {
    try {
      await deleteDependency({
        predecessorId: edge.predecessorId,
        successorId: edge.successorId,
      })
      toast.success('Dependencia eliminada')
      announce('Dependencia eliminada')
    } catch (err) {
      const { detail } = parseActionError(err)
      toast.error(detail)
    }
  }

  // HU-3.1/3.2 · proyecto activo derivado del filtro. La línea base se
  // captura/lista por-proyecto, así que requerimos selección explícita.
  // Si el usuario no ha filtrado, los controles de baseline quedan
  // disabled con tooltip explicativo.
  const activeProjectId = filters.projectId ?? null
  const activeProjectName = useMemo(() => {
    if (!activeProjectId) return null
    return projects.find((p) => p.id === activeProjectId)?.name ?? null
  }, [activeProjectId, projects])
  const activeBaselineCount =
    activeProjectId && baselineCountByProject
      ? baselineCountByProject[activeProjectId] ?? 0
      : 0
  const activeTaskCount =
    activeProjectId && taskCountByProject
      ? taskCountByProject[activeProjectId] ?? 0
      : 0
  const activeBaselines =
    activeProjectId && baselinesByProject
      ? baselinesByProject[activeProjectId] ?? []
      : []

  // HU-3.3 · lazy load del snapshot de la línea base activa. El zustand
  // `activeBaselineId[projectId]` guarda la selección persistida; cuando
  // cambia, hacemos fetch del snapshot completo (server action cacheable
  // implícitamente por React + revalidatePath en captureBaseline).
  //
  // Cache local en `loadedSnapshotRef` evita refetches innecesarios si el
  // mismo id ya está cargado (p. ej. al cambiar criticalOnly).
  const activeBaselineIdForProject = useUIStore((s) =>
    activeProjectId ? s.activeBaselineId[activeProjectId] ?? null : null,
  )
  const [overlaySnapshot, setOverlaySnapshot] = useState<{
    id: string
    projectId: string
    version: number
    snapshot: BaselineSnapshot
  } | null>(null)

  // El reset síncrono al cambiar de proyecto/baseline es deliberado para
  // evitar que el render intermedio muestre el snapshot anterior con el
  // mapa de tareas nuevo (mismatch visual). El lint warn de
  // `set-state-in-effect` aplica para cascadas, no para sincronización
  // con un id externo (zustand).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!activeProjectId || !activeBaselineIdForProject) {
      setOverlaySnapshot(null)
      return
    }
    let cancelled = false
    const run = async () => {
      try {
        const result = await getBaselineSnapshot(activeBaselineIdForProject)
        if (cancelled) return
        if (!result || result.projectId !== activeProjectId) {
          setOverlaySnapshot(null)
          return
        }
        setOverlaySnapshot(result)
      } catch (err) {
        if (cancelled) return
        const { code, detail } = parseActionError(err)
        toast.error(
          code === 'INVALID_SNAPSHOT'
            ? `Línea base corrupta · ${detail}`
            : `No se pudo cargar la línea base · ${detail}`,
        )
        setOverlaySnapshot(null)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [activeProjectId, activeBaselineIdForProject])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Mapa de varianza pre-calculado para que cada fila aplique borde sin
  // recomputar en cada render. Keyed por (overlaySnapshot, visibleLocal).
  const varianceMap = useMemo<Map<string, TaskVariance>>(() => {
    if (!overlaySnapshot) return new Map()
    return buildVarianceMap(
      visibleLocal.map((t) => ({
        id: t.id,
        startDate: t.startDate ?? null,
        endDate: t.endDate ?? null,
      })),
      overlaySnapshot.snapshot,
    )
  }, [overlaySnapshot, visibleLocal])

  const overlayCapturedAt = overlaySnapshot
    ? overlaySnapshot.snapshot.capturedAt.slice(0, 10)
    : null

  return (
    <>
      <TaskFiltersBar
        value={filters}
        onChange={setFilters}
        gerencias={gerencias}
        areas={areas}
        projects={projects}
        users={users}
        showCriticalOnly
        className="rounded-lg mb-4 border border-border"
      />

      <div
        data-testid="gantt-baselines-toolbar"
        className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/20 px-4 py-2"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Líneas base
        </span>
        <CaptureBaselineButton
          projectId={activeProjectId}
          projectName={activeProjectName}
          taskCount={activeTaskCount}
          baselineCount={activeBaselineCount}
        />
        <BaselineSelector
          projectId={activeProjectId}
          baselines={activeBaselines}
        />
        <BaselineTrendToggle
          projectId={activeProjectId}
          hasActiveBaseline={activeBaselineIdForProject != null}
        />
        <span
          aria-hidden
          className="ml-2 inline-block h-5 w-px bg-border"
        />
        <ExportExcelButton
          projectId={activeProjectId}
          taskCount={activeTaskCount}
        />
        <ExportMspButton
          projectId={activeProjectId}
          taskCount={activeTaskCount}
        />
        <ImportExcelButton projectId={activeProjectId} />
        <ImportMspButton projectId={activeProjectId} />
        <DownloadTemplateButton />
      </div>

      {hasCpmCycle && (
        <div
          role="alert"
          className="mb-3 rounded-md border border-red-500/40 bg-red-950/30 px-3 py-2 text-xs text-red-300"
        >
          CPM: se detectó al menos un ciclo en las dependencias. Las flechas
          afectadas se omiten hasta que se rompa el ciclo.
        </div>
      )}

      <div className="flex gap-3">
      <div
        data-testid="gantt-board"
        className="flex-1 min-w-0 rounded-xl border border-border bg-subtle/80 shadow-sm"
      >
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
          <div className="flex flex-col items-center gap-3 p-8 text-center text-sm text-muted-foreground">
            <p>
              {criticalOnly
                ? 'No hay tareas en la ruta crítica para este rango de fechas.'
                : local.length === 0
                  ? 'No hay tareas planificadas en este rango.'
                  : 'Ninguna tarea coincide con los filtros.'}
            </p>
            {criticalOnly && (
              <button
                type="button"
                onClick={() => toggleCriticalOnly(false)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
              >
                Mostrar todas las tareas
              </button>
            )}
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
              {/* HU-3.3 · capa de barras fantasma (línea base). z-5, debajo de
                  filas/barras reales (z-10) y de las flechas (z-20). El
                  componente se monta solo si hay snapshot activo cuyo
                  projectId coincide con el filtro de proyecto. */}
              {overlaySnapshot && (
                <GanttBaselineLayer
                  tasks={visibleLocal}
                  snapshot={overlaySnapshot.snapshot}
                  baselineVersion={overlaySnapshot.version}
                  dayWidth={DAY_WIDTH}
                  rangeStart={start}
                  rangeDays={rangeDays}
                  rowHeight={ROW_HEIGHT}
                />
              )}

              {/* HU-3.3 · pill leyenda flotante. z-30 para quedar sobre las
                  flechas SVG (z-20) y por debajo de cualquier modal (z-50). */}
              {overlaySnapshot && (
                <div
                  data-testid="gantt-baseline-legend"
                  role="status"
                  aria-live="polite"
                  className={clsx(
                    'pointer-events-none absolute right-2 top-2 z-30 inline-flex items-center gap-2',
                    'rounded-full border border-border bg-popover/95 px-3 py-1.5',
                    'text-[11px] text-muted-foreground shadow-sm backdrop-blur',
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    <span
                      aria-hidden
                      className="inline-block h-[2px] w-4 rounded bg-foreground/80"
                    />
                    <span className="text-foreground/80">Activa</span>
                  </span>
                  <span aria-hidden className="text-border">
                    ·
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span
                      aria-hidden
                      className="inline-block h-0 w-4 rounded border-t-2 border-dashed border-muted-foreground/60"
                    />
                    <span>
                      Línea base v.{overlaySnapshot.version}
                      {overlayCapturedAt ? ` (cap. ${overlayCapturedAt})` : ''}
                    </span>
                  </span>
                </div>
              )}

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
                  variance={varianceMap.get(task.id) ?? null}
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

              {/* Capa SVG superpuesta — flechas de dependencias FS (HU-1.2).
                  HU-1.4: clic derecho sobre la flecha abre el mini-menú. */}
              {edges.length > 0 && (
                <GanttDependencyLayer
                  tasks={positions}
                  dependencies={edges}
                  width={totalWidth}
                  height={canvasHeight}
                  onDependencyContextMenu={(edge, ev) => {
                    setDepMenu({
                      edge,
                      position: { x: ev.clientX, y: ev.clientY },
                    })
                  }}
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

      <BaselineTrendPanel projectId={activeProjectId} tasks={visibleLocal} />
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

      {/* HU-1.4 · mini-menú contextual sobre la flecha. Implementado a mano
          (no Radix ContextMenu) porque el trigger es un <path> SVG y los
          primitives de Radix esperan un trigger DOM-element con eventos
          delegables; lanzar el menú vía coordenadas sigue siendo accesible
          si cerramos con Escape y outside-click. */}
      {depMenu && (
        <DependencyArrowMenu
          edge={depMenu.edge}
          position={depMenu.position}
          onClose={() => setDepMenu(null)}
          onEdit={() => {
            const pos = depMenu.position
            const edge = depMenu.edge
            setDepMenu(null)
            openEditorFromEdge(edge, pos)
          }}
          onChangeType={async (next) => {
            const edge = depMenu.edge
            setDepMenu(null)
            await changeDepType(edge, next)
          }}
          onDelete={async () => {
            const edge = depMenu.edge
            setDepMenu(null)
            await deleteEdge(edge)
          }}
        />
      )}

      <DependencyEditor
        dependency={editorState?.payload ?? null}
        position={editorState?.position ?? null}
        onClose={() => setEditorState(null)}
      />
    </>
  )
}

// ─────────────────── Mini-menú de la flecha (HU-1.4) ───────────────────

function DependencyArrowMenu({
  edge,
  position,
  onClose,
  onEdit,
  onChangeType,
  onDelete,
}: {
  edge: GanttDependencyEdge
  position: { x: number; y: number }
  onClose: () => void
  onEdit: () => void
  onChangeType: (next: 'FS' | 'SS' | 'FF' | 'SF') => void
  onDelete: () => void
}) {
  const [showSubmenu, setShowSubmenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onDocMouseDown = (e: MouseEvent) => {
      if (!ref.current) return
      if (e.target instanceof Node && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDocMouseDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDocMouseDown)
    }
  }, [onClose])

  const ITEM = clsx(
    'flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm text-foreground',
    'hover:bg-secondary/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-500',
  )

  // Anclaje al click. Clamp básico al viewport.
  const W = typeof window !== 'undefined' ? window.innerWidth : 1024
  const H = typeof window !== 'undefined' ? window.innerHeight : 768
  const left = Math.max(8, Math.min(position.x, W - 240))
  const top = Math.max(8, Math.min(position.y, H - 220))

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Acciones de dependencia"
      className="fixed z-50 min-w-[220px] overflow-visible rounded-[10px] border border-border bg-card p-1 shadow-lg"
      style={{ left, top }}
    >
      <button type="button" role="menuitem" className={ITEM} onClick={onEdit}>
        <span>Editar dependencia…</span>
      </button>
      <div
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={showSubmenu}
        tabIndex={0}
        onMouseEnter={() => setShowSubmenu(true)}
        onMouseLeave={() => setShowSubmenu(false)}
        onFocus={() => setShowSubmenu(true)}
        onBlur={() => setShowSubmenu(false)}
        className="relative"
      >
        <button type="button" className={ITEM}>
          <span>Cambiar tipo</span>
          <span aria-hidden>›</span>
        </button>
        {showSubmenu && (
          <div
            className="absolute left-full top-0 ml-1 min-w-[120px] rounded-[10px] border border-border bg-card p-1 shadow-lg"
            role="menu"
          >
            {(['FS', 'SS', 'FF', 'SF'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="menuitemradio"
                aria-checked={edge.type === t}
                disabled={edge.type === t}
                onClick={() => onChangeType(t)}
                className={clsx(
                  ITEM,
                  edge.type === t && 'bg-indigo-500/15 text-indigo-200',
                )}
              >
                <span>{t}</span>
                {edge.type === t && (
                  <span aria-hidden className="text-xs">
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <div role="separator" className="my-1 h-px bg-border" />
      <button
        type="button"
        role="menuitem"
        onClick={onDelete}
        className={clsx(ITEM, 'text-red-400 hover:bg-red-500/10')}
      >
        <span>Eliminar dependencia</span>
      </button>
    </div>
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
  variance,
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
  /** HU-3.3 · varianza pre-calculada respecto a la línea base activa. */
  variance?: TaskVariance | null
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

  // HU-3.3 · clase de borde según severidad de la varianza vs baseline.
  // Solo aplicamos borde extra si la severidad es ≥ minor; on-plan se
  // queda con el borde por defecto del CPM/tipo. La doble codificación
  // (color + icono + tooltip <title>) cubre WCAG AA.
  const varianceClass = (variance?.classification ?? null) as
    | VarianceClassification
    | null
  const varianceBorder =
    varianceClass === 'critical'
      ? 'border-2 border-red-500'
      : varianceClass === 'moderate'
        ? 'border-2 border-amber-500'
        : varianceClass === 'minor'
          ? 'border-2 border-amber-500/60'
          : ''
  const varianceTooltip =
    variance && variance.deltaDays != null && variance.classification !== 'on-plan'
      ? `\n─────────────────────\nDesvío vs línea base: ${
          variance.deltaDays > 0 ? '+' : ''
        }${variance.deltaDays} día${
          Math.abs(variance.deltaDays) !== 1 ? 's' : ''
        }`
      : ''

  // Tooltip CPM (HU-2.2): forward+backward pass visible en hover. Usamos
  // \n (saltos nativos del attribute `title`) ya que Radix Tooltip no está
  // disponible en el stack (ver AGENTS.md). El formato emula MS Project.
  const float = cpm?.totalFloat ?? 0
  const slackTight = !!cpm && !cpm.isCritical && float > 0 && float <= 3
  const slackNegative = !!cpm && float < 0
  const cpmTooltip = cpm
    ? `${task.mnemonic ? `${task.mnemonic} · ` : ''}${task.title}\n` +
      `─────────────────────\n` +
      `ES: día ${cpm.ES} · EF: día ${cpm.EF}\n` +
      `LS: día ${cpm.LS} · LF: día ${cpm.LF}\n` +
      `Float: ${cpm.totalFloat} día${Math.abs(cpm.totalFloat) !== 1 ? 's' : ''}\n` +
      `─────────────────────` +
      (cpm.isCritical
        ? `\n[Crítica]`
        : slackNegative
          ? `\n⚠ Float negativo — restricción imposible`
          : slackTight
            ? `\nSlack apretado`
            : '')
    : task.title

  // Slot absoluto por fila — incluye línea horizontal de fila + barra/hito.
  // `pointer-events-none` en el contenedor permite que la capa SVG de
  // dependencias (renderizada al final del canvas) reciba clic derecho sobre
  // las flechas. Los hijos que necesitan eventos (barra, hito, label "Sin
  // fechas") restauran `pointer-events-auto` explícitamente.
  return (
    <div
      className="pointer-events-none absolute inset-x-0"
      style={{ top: index * rowHeight, height: rowHeight }}
    >
      {/* Línea horizontal de la fila (separador). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 border-b border-border/30"
      />

      {!hasDates && (
        <div
          className="pointer-events-auto absolute left-2 top-1/2 z-10 inline-flex -translate-y-1/2 items-center rounded border border-dashed border-border px-2 py-1 text-xs text-muted-foreground"
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
          title={cpmTooltip + varianceTooltip}
          style={{
            left,
            width,
            transform: bodyDrag.isDragging
              ? `translateX(${bodyDrag.deltaPx}px)`
              : undefined,
          }}
          className={clsx(
            'pointer-events-auto group/bar absolute top-1/2 z-10 h-6 -translate-y-1/2 rounded-md shadow-sm',
            'flex cursor-grab active:cursor-grabbing',
            'border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500',
            // HU-2.2: jerarquía visual por slack.
            //   negative → rojo destructivo (restricción imposible)
            //   crítica  → rojo (float = 0, ya implementado)
            //   tight    → ámbar (slack ∈ (0, 3])
            //   default  → color por tipo (PMI/scrum)
            slackNegative
              ? 'border-red-600/80 bg-red-950/40'
              : isCritical
                ? 'border-red-500/60 bg-red-900/40'
                : slackTight
                  ? 'border-amber-500/60 bg-amber-900/30'
                  : task.type === 'PMI_TASK'
                    ? 'border-emerald-500/50 bg-emerald-900/40'
                    : 'border-indigo-500/50 bg-indigo-900/40',
            // HU-3.3 · borde de variance vs baseline (override visual). Se
            // aplica DESPUÉS del border de tipo/CPM para que prevalezca
            // el indicador de desvío contra la línea base.
            varianceBorder,
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

          {/* HU-2.2 · Indicador de float negativo (restricción imposible).
              Renderizado encima del progreso, no bloquea drag. */}
          {slackNegative && (
            <span
              aria-hidden
              className="pointer-events-none absolute right-2 top-1/2 z-10 -translate-y-1/2 text-[10px] font-bold text-red-200"
              title={`Float ${cpm?.totalFloat}`}
            >
              ⚠
            </span>
          )}

          {/* HU-3.3 · Indicador de variance moderada/crítica vs baseline.
              Se ubica al borde derecho cuando hay slack negativo no para
              no solaparse con su icono. Doble codificación: borde +
              icono + tooltip — un usuario daltónico distingue por la
              forma del triángulo y por el tooltip. */}
          {(varianceClass === 'moderate' || varianceClass === 'critical') &&
            !slackNegative && (
              <span
                aria-hidden
                className={clsx(
                  'pointer-events-none absolute right-1.5 top-1/2 z-10 -translate-y-1/2',
                  varianceClass === 'critical' ? 'text-red-300' : 'text-amber-300',
                )}
                title={`Desvío vs línea base: ${
                  variance?.deltaDays != null && variance.deltaDays > 0 ? '+' : ''
                }${variance?.deltaDays ?? 0}d`}
              >
                <AlertTriangle
                  className={clsx(
                    varianceClass === 'critical' ? 'h-3.5 w-3.5' : 'h-3 w-3',
                  )}
                />
              </span>
            )}

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
              z-20 para quedar por encima del handle de resize. Usamos
              onPointerDown (no onMouseDown) para alinearnos con el sistema
              de eventos del body-drag (`useHorizontalDrag` también usa
              pointer events). Si solo usáramos `onMouseDown`, el navegador
              dispara `pointerdown` PRIMERO al padre, donde body-drag
              ejecutaría `preventDefault()` y cancelaría el `mousedown`
              siguiente del handle, impidiendo iniciar la conexión. */}
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
              onPointerDown={(e) => {
                if (e.button !== 0) return
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
            'pointer-events-auto absolute z-10 h-4 w-4 shadow-[0_0_10px_rgba(251,191,36,0.4)]',
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
