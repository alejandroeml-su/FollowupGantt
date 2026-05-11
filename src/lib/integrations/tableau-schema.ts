/**
 * Wave R3.0 Fase 4 · Equipo P21-B · Tableau Web Data Connector.
 *
 * Metadata Tableau-compat compartida entre:
 *   - Endpoints JSON `/api/integrations/tableau/<dataset>` (sirven los rows).
 *   - Endpoint `/api/integrations/tableau/schema/<dataset>` (describe columnas).
 *   - WDC HTML `public/wdc/sync-tableau.html` (consume ambos y registra el
 *     schema en `tableau.submit()`).
 *
 * Tipos soportados por WDC v3 (`tableau.dataTypeEnum`):
 *   - `string`   → cadenas libres (id, nombre, status, etc).
 *   - `int`      → enteros (`probability`, `impact`, `storyPoints`).
 *   - `float`    → numéricos (`score`, `cpi`, `spi`, `budget`).
 *   - `bool`     → flags.
 *   - `date`     → fechas sin tz.
 *   - `datetime` → timestamps ISO-8601 (Tableau parsea como datetime).
 *
 * Cap por request: 5000 filas. Para datasets más grandes, el WDC pagina
 * cursor-based via `?cursor=<lastId>` y reagrupa en un solo extract.
 */

export const TABLEAU_DATASETS = [
  'projects',
  'tasks',
  'sprints',
  'risks',
  'audit',
] as const

export type TableauDataset = (typeof TABLEAU_DATASETS)[number]

export function isTableauDataset(value: string): value is TableauDataset {
  return (TABLEAU_DATASETS as readonly string[]).includes(value)
}

/**
 * Tipos Tableau WDC v3 — strings literales que el JS del connector usa para
 * mapear a `tableau.dataTypeEnum.<x>`.
 */
export type TableauColumnType = 'string' | 'int' | 'float' | 'bool' | 'date' | 'datetime'

export interface TableauColumn {
  id: string
  alias: string
  dataType: TableauColumnType
  description?: string
}

export interface TableauTableInfo {
  id: TableauDataset
  alias: string
  description: string
  /** Columnas en el orden recomendado para la UI de Tableau. */
  columns: ReadonlyArray<TableauColumn>
  /** Endpoint REST que sirve los rows. */
  endpoint: string
}

// ─────────────────────────── Schemas por dataset ───────────────────────────

const PROJECTS_COLUMNS: ReadonlyArray<TableauColumn> = [
  { id: 'id', alias: 'Project ID', dataType: 'string' },
  { id: 'name', alias: 'Name', dataType: 'string' },
  { id: 'status', alias: 'Status', dataType: 'string' },
  { id: 'methodology', alias: 'Methodology', dataType: 'string' },
  { id: 'manager', alias: 'Manager', dataType: 'string' },
  { id: 'gerencia', alias: 'Gerencia', dataType: 'string' },
  { id: 'area', alias: 'Area', dataType: 'string' },
  { id: 'budget', alias: 'Budget', dataType: 'float' },
  { id: 'budgetCurrency', alias: 'Currency', dataType: 'string' },
  { id: 'cpi', alias: 'CPI', dataType: 'float' },
  { id: 'spi', alias: 'SPI', dataType: 'float' },
  { id: 'startDate', alias: 'Start Date', dataType: 'datetime' },
  { id: 'endDate', alias: 'End Date', dataType: 'datetime' },
  { id: 'createdAt', alias: 'Created At', dataType: 'datetime' },
  { id: 'updatedAt', alias: 'Updated At', dataType: 'datetime' },
]

const TASKS_COLUMNS: ReadonlyArray<TableauColumn> = [
  { id: 'id', alias: 'Task ID', dataType: 'string' },
  { id: 'mnemonic', alias: 'Mnemonic', dataType: 'string' },
  { id: 'title', alias: 'Title', dataType: 'string' },
  { id: 'projectId', alias: 'Project ID', dataType: 'string' },
  { id: 'projectName', alias: 'Project', dataType: 'string' },
  { id: 'sprintName', alias: 'Sprint', dataType: 'string' },
  { id: 'epicName', alias: 'Epic', dataType: 'string' },
  { id: 'assigneeName', alias: 'Assignee', dataType: 'string' },
  { id: 'status', alias: 'Status', dataType: 'string' },
  { id: 'priority', alias: 'Priority', dataType: 'string' },
  { id: 'storyPoints', alias: 'Story Points', dataType: 'int' },
  { id: 'plannedValue', alias: 'Planned Value', dataType: 'float' },
  { id: 'actualCost', alias: 'Actual Cost', dataType: 'float' },
  { id: 'earnedValue', alias: 'Earned Value', dataType: 'float' },
  { id: 'progress', alias: 'Progress', dataType: 'int' },
  { id: 'startDate', alias: 'Start Date', dataType: 'datetime' },
  { id: 'endDate', alias: 'End Date', dataType: 'datetime' },
  { id: 'createdAt', alias: 'Created At', dataType: 'datetime' },
  { id: 'updatedAt', alias: 'Updated At', dataType: 'datetime' },
]

const SPRINTS_COLUMNS: ReadonlyArray<TableauColumn> = [
  { id: 'id', alias: 'Sprint ID', dataType: 'string' },
  { id: 'name', alias: 'Name', dataType: 'string' },
  { id: 'goal', alias: 'Sprint Goal', dataType: 'string' },
  { id: 'projectId', alias: 'Project ID', dataType: 'string' },
  { id: 'projectName', alias: 'Project', dataType: 'string' },
  { id: 'state', alias: 'State', dataType: 'string' },
  { id: 'capacity', alias: 'Capacity', dataType: 'int' },
  { id: 'velocityActual', alias: 'Velocity Actual', dataType: 'int' },
  { id: 'startDate', alias: 'Start Date', dataType: 'datetime' },
  { id: 'endDate', alias: 'End Date', dataType: 'datetime' },
  { id: 'startedAt', alias: 'Started At', dataType: 'datetime' },
  { id: 'endedAt', alias: 'Ended At', dataType: 'datetime' },
  { id: 'reviewedAt', alias: 'Reviewed At', dataType: 'datetime' },
]

const RISKS_COLUMNS: ReadonlyArray<TableauColumn> = [
  { id: 'id', alias: 'Risk ID', dataType: 'string' },
  { id: 'projectId', alias: 'Project ID', dataType: 'string' },
  { id: 'projectName', alias: 'Project', dataType: 'string' },
  { id: 'title', alias: 'Title', dataType: 'string' },
  { id: 'probability', alias: 'Probability', dataType: 'int' },
  { id: 'impact', alias: 'Impact', dataType: 'int' },
  { id: 'score', alias: 'Score', dataType: 'int' },
  { id: 'severity', alias: 'Severity', dataType: 'string' },
  { id: 'status', alias: 'Status', dataType: 'string' },
  { id: 'ownerName', alias: 'Owner', dataType: 'string' },
  { id: 'source', alias: 'Source', dataType: 'string' },
  { id: 'detectedAt', alias: 'Detected At', dataType: 'datetime' },
  { id: 'closedAt', alias: 'Closed At', dataType: 'datetime' },
  { id: 'createdAt', alias: 'Created At', dataType: 'datetime' },
  { id: 'updatedAt', alias: 'Updated At', dataType: 'datetime' },
]

const AUDIT_COLUMNS: ReadonlyArray<TableauColumn> = [
  { id: 'id', alias: 'Event ID', dataType: 'string' },
  { id: 'action', alias: 'Action', dataType: 'string' },
  { id: 'entityType', alias: 'Entity Type', dataType: 'string' },
  { id: 'entityId', alias: 'Entity ID', dataType: 'string' },
  { id: 'actorId', alias: 'Actor ID', dataType: 'string' },
  { id: 'actorName', alias: 'Actor', dataType: 'string' },
  { id: 'ipAddress', alias: 'IP Address', dataType: 'string' },
  { id: 'createdAt', alias: 'Created At', dataType: 'datetime' },
]

export const TABLEAU_TABLES: Record<TableauDataset, TableauTableInfo> = {
  projects: {
    id: 'projects',
    alias: 'Sync Projects',
    description: 'Proyectos del workspace (Sync FollowupGantt).',
    columns: PROJECTS_COLUMNS,
    endpoint: '/api/integrations/tableau/projects',
  },
  tasks: {
    id: 'tasks',
    alias: 'Sync Tasks',
    description: 'Tareas con projectName y assignee join-eados.',
    columns: TASKS_COLUMNS,
    endpoint: '/api/integrations/tableau/tasks',
  },
  sprints: {
    id: 'sprints',
    alias: 'Sync Sprints',
    description: 'Sprints con state derivado (PLANNING/ACTIVE/CLOSED).',
    columns: SPRINTS_COLUMNS,
    endpoint: '/api/integrations/tableau/sprints',
  },
  risks: {
    id: 'risks',
    alias: 'Sync Risks',
    description: 'Riesgos con score=probability*impact + severity (PMBOK 5x5).',
    columns: RISKS_COLUMNS,
    endpoint: '/api/integrations/tableau/risks',
  },
  audit: {
    id: 'audit',
    alias: 'Sync Audit',
    description: 'Eventos de auditoría últimos 90 días.',
    columns: AUDIT_COLUMNS,
    endpoint: '/api/integrations/tableau/audit',
  },
}

/** Cap por request — mismo límite que CSV exports (#192). */
export const TABLEAU_PAGE_SIZE_DEFAULT = 5000
export const TABLEAU_PAGE_SIZE_MAX = 5000

/**
 * Parsea `?cursor=<id>&limit=<n>` con defaults seguros. Mismo patrón que
 * `parseCsvPagination` pero expuesto aquí para evitar acoplar el namespace
 * de integraciones a `lib/api/csv-writer`.
 */
export function parseTableauPagination(url: URL): {
  cursor: string | null
  limit: number
} {
  const cursor = url.searchParams.get('cursor')
  const rawLimit = url.searchParams.get('limit')
  let limit = TABLEAU_PAGE_SIZE_DEFAULT
  if (rawLimit) {
    const n = Number(rawLimit)
    if (Number.isFinite(n) && Number.isInteger(n) && n >= 1) {
      limit = Math.min(TABLEAU_PAGE_SIZE_MAX, n)
    }
  }
  return { cursor: cursor || null, limit }
}

/**
 * Serializa una respuesta JSON estándar Tableau-compat:
 *   { table, rows, nextCursor }
 *
 * Headers:
 *   - `X-Next-Cursor` cuando hay paginación.
 *   - `Cache-Control: no-store` para evitar caches stale en el cliente.
 */
export function tableauJsonResponse<T>(opts: {
  table: TableauDataset
  rows: T[]
  nextCursor: string | null
}): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-API-Version': 'tableau-v1',
  }
  if (opts.nextCursor) headers['X-Next-Cursor'] = opts.nextCursor
  const body = {
    table: opts.table,
    rows: opts.rows,
    nextCursor: opts.nextCursor,
  }
  return new Response(JSON.stringify(body), { status: 200, headers })
}

/** Helper trivial: ISO 8601 o null si la fecha es null/inválida. */
export function isoOrNull(d: Date | null | undefined): string | null {
  if (!d) return null
  const t = d.getTime()
  if (!Number.isFinite(t)) return null
  return d.toISOString()
}
