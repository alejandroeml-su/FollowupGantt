import type { SerializedTask } from '@/lib/types'

/**
 * Catálogo de columnas disponibles en la Vista de Tabla. Cada entrada
 * declara cómo se renderiza el valor crudo y, cuando aplica, una clase
 * de alineación. El orden y la visibilidad los controla el usuario
 * desde `TableColumnsConfigurator` y persisten en localStorage vía
 * `useTableColumnPrefs`.
 *
 * Para añadir una columna nueva:
 *   1. Asegurar que el campo viene en `SerializedTask` (lib/types.ts).
 *      Si no, agregarlo allí y exponerlo en la query de la page.
 *   2. Registrar el descriptor abajo con un `id` único, `label` para
 *      el header, y `accessor(task)` que devuelve el contenido React.
 *   3. Si quieres que sea visible por defecto, agrégalo a
 *      `DEFAULT_VISIBLE_COLUMNS`.
 *
 * Notas:
 *   - El `id` se persiste en localStorage; renombrarlo invalida la
 *     preferencia del usuario (cae a default). Evitar romper.
 *   - El `accessor` se llama en cada render — mantenerlo barato (sin
 *     fetches, sin formato pesado).
 */

import type React from 'react'

export type TableColumnId =
  | 'id'
  | 'title'
  | 'project'
  | 'epic'
  | 'type'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'progress'
  | 'comments'
  | 'startDate'
  | 'endDate'
  | 'tags'
  | 'createdAt'
  | 'updatedAt'

export type TableColumn = {
  id: TableColumnId
  /** Texto del header. Mostrado tal cual (uppercase aplicado por CSS). */
  label: string
  /** Alineación del contenido en la celda. Default: 'left'. */
  align?: 'left' | 'center' | 'right'
  /** Anchura preferida en clase Tailwind. Vacío = auto. */
  widthClass?: string
  /** Si true, esta columna no se puede ocultar (ej. Título). */
  alwaysVisible?: boolean
}

export const TABLE_COLUMNS: TableColumn[] = [
  { id: 'id', label: 'ID', align: 'left' },
  { id: 'title', label: 'Título', align: 'left', alwaysVisible: true },
  { id: 'project', label: 'Proyecto', align: 'left' },
  { id: 'epic', label: 'Epic', align: 'left' },
  { id: 'type', label: 'Tipo', align: 'left' },
  { id: 'status', label: 'Estado', align: 'center' },
  { id: 'priority', label: 'Prioridad', align: 'center' },
  { id: 'assignee', label: 'Asignado', align: 'left' },
  { id: 'progress', label: 'Progreso', align: 'left' },
  { id: 'comments', label: '💬', align: 'center' },
  { id: 'startDate', label: 'Inicio', align: 'left' },
  { id: 'endDate', label: 'Fin', align: 'left' },
  { id: 'tags', label: 'Etiquetas', align: 'left' },
  { id: 'createdAt', label: 'Creada', align: 'left' },
  { id: 'updatedAt', label: 'Actualizada', align: 'left' },
]

/**
 * Set de columnas que se muestran por defecto en una sesión nueva.
 * El usuario puede ocultar cualquiera (excepto las `alwaysVisible`)
 * desde el configurador. Las que no están aquí pero sí en `TABLE_COLUMNS`
 * son opt-in.
 */
export const DEFAULT_VISIBLE_COLUMNS: TableColumnId[] = [
  'id',
  'title',
  'project',
  'epic',
  'type',
  'status',
  'priority',
  'assignee',
  'progress',
  'comments',
]

/** Lookup helper. */
export function getColumnDef(id: TableColumnId): TableColumn | null {
  return TABLE_COLUMNS.find((c) => c.id === id) ?? null
}

/**
 * Forma serializable de la preferencia del usuario:
 *   - `order`: permutación canónica de columnas (incluye visibles e
 *     ocultas; las ocultas también van en el array para preservar el
 *     orden si el usuario las re-activa).
 *   - `visible`: subconjunto de `order` que está activo en este momento.
 *
 * Persistencia: localStorage key `fg.table.columns.v1`. Si la forma del
 * payload cambia (ej. agregamos un campo), bumpear la key a v2 para
 * invalidar prefs viejas y caer a defaults — evita romper al usuario
 * con configs inconsistentes.
 */
export type TableColumnPrefs = {
  order: TableColumnId[]
  visible: TableColumnId[]
}

export const TABLE_COLUMN_PREFS_KEY = 'fg.table.columns.v1'

export function getDefaultColumnPrefs(): TableColumnPrefs {
  return {
    order: TABLE_COLUMNS.map((c) => c.id),
    visible: [...DEFAULT_VISIBLE_COLUMNS],
  }
}

/**
 * Sanitiza un payload leído de localStorage para que sea seguro de
 * usar (descarta IDs desconocidos, fuerza columnas alwaysVisible).
 * Si el resultado no es válido, devuelve los defaults.
 */
export function normalizeColumnPrefs(raw: unknown): TableColumnPrefs {
  const def = getDefaultColumnPrefs()
  if (!raw || typeof raw !== 'object') return def
  const obj = raw as Record<string, unknown>
  const validIds = new Set(TABLE_COLUMNS.map((c) => c.id))
  const orderRaw = Array.isArray(obj.order) ? obj.order : []
  const visibleRaw = Array.isArray(obj.visible) ? obj.visible : []

  // Filtra por IDs conocidos manteniendo orden, deduplica.
  const seenOrder = new Set<TableColumnId>()
  const order: TableColumnId[] = []
  for (const id of orderRaw) {
    if (typeof id === 'string' && validIds.has(id as TableColumnId) && !seenOrder.has(id as TableColumnId)) {
      order.push(id as TableColumnId)
      seenOrder.add(id as TableColumnId)
    }
  }
  // Si falta alguna columna en `order`, la añadimos al final con su orden
  // canónico — así nuevas columnas declaradas en código aparecen para
  // usuarios con prefs viejas.
  for (const c of TABLE_COLUMNS) {
    if (!seenOrder.has(c.id)) order.push(c.id)
  }

  const seenVisible = new Set<TableColumnId>()
  const visible: TableColumnId[] = []
  for (const id of visibleRaw) {
    if (typeof id === 'string' && validIds.has(id as TableColumnId) && !seenVisible.has(id as TableColumnId)) {
      visible.push(id as TableColumnId)
      seenVisible.add(id as TableColumnId)
    }
  }
  // Forzar columnas `alwaysVisible` a estar en `visible`.
  for (const c of TABLE_COLUMNS) {
    if (c.alwaysVisible && !seenVisible.has(c.id)) {
      visible.push(c.id)
      seenVisible.add(c.id)
    }
  }

  // Si no quedó ninguna columna visible (ej. usuario corrupteó el store),
  // restaurar defaults en lugar de mostrar tabla vacía.
  if (visible.length === 0) return def

  return { order, visible }
}

/**
 * Tipo de la accessor render-prop que cada columna implementa en
 * `TableBoardClient`. Recibe la tarea + helpers de presentación
 * compartidos (formato de fechas, etc.).
 */
export type TableCellRenderArgs = {
  task: SerializedTask & { commentCount?: number }
  drawerTaskId?: string | null
}

export type TableCellRenderer = (args: TableCellRenderArgs) => React.ReactNode
