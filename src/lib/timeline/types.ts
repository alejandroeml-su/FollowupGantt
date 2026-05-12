/**
 * US-4.2 Timeline View — tipos compartidos.
 *
 * Distinto al Gantt:
 *   - Sin CPM, sin baselines
 *   - Eje X continuo con zoom (semanas / meses / trimestres)
 *   - Agrupable verticalmente (Project / Epic / Sprint / Status / Assignee)
 *   - Barras read-only (drawer al click); sin drag-drop reorder
 */

export type TimelineZoom = 'WEEKS' | 'MONTHS' | 'QUARTERS'

export type TimelineGroupBy =
  | 'PROJECT'
  | 'EPIC'
  | 'SPRINT'
  | 'STATUS'
  | 'ASSIGNEE'

export interface TimelineTask {
  id: string
  mnemonic: string | null
  title: string
  status: string
  priority: string
  type: string
  /** ISO o null. */
  startDate: string | null
  /** ISO o null. */
  endDate: string | null
  progress: number // 0-100
  isMilestone: boolean
  projectId: string
  projectName: string
  /** Gerencia heredada del Project.area.gerencia para reusar TaskFilters. */
  gerenciaId: string | null
  /** Área heredada del Project.area para reusar TaskFilters. */
  areaId: string | null
  epicId: string | null
  epicName: string | null
  epicColor: string | null
  sprintId: string | null
  sprintName: string | null
  assignee: { id: string; name: string } | null
  /** Espejo de `assignee?.id` para casar con `TaskFilters.assigneeId`. */
  assigneeId: string | null
}

export interface TimelineGroup {
  /** Identificador único del grupo (project.id / epic.id / etc). */
  key: string
  /** Etiqueta visible. */
  label: string
  /** Color tag opcional (Epic color, Project area color, etc). */
  color?: string | null
  /** Tareas pertenecientes al grupo, ordenadas por startDate asc. */
  tasks: TimelineTask[]
}

export interface TimelineWindow {
  /** Inicio del rango visible (UTC midnight). */
  start: Date
  /** Fin del rango visible (UTC midnight, exclusivo). */
  end: Date
  /** Total de días en la ventana. */
  totalDays: number
  /** Etiqueta del rango (ej. "May 2026 – Jul 2026"). */
  label: string
  /** Marcas mayores en el eje (cabecera ancha). */
  majorTicks: Array<{ date: Date; label: string; positionPct: number }>
  /** Marcas menores (días, semanas o meses según zoom). */
  minorTicks: Array<{ date: Date; positionPct: number }>
}
