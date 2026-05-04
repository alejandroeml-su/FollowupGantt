/**
 * Ola P3 · Equipo P3-2 · Audit Log centralizado.
 *
 * Tipos y catálogos compartidos por:
 *   - `events.ts` (helper `recordAuditEvent`)
 *   - `with-audit.ts` (HOF wrapper para server actions)
 *   - `actions/audit.ts` (queryEvents, purgeOld)
 *   - `app/audit-log/page.tsx` y componentes cliente
 *
 * Catálogo de `action` ↑ es centralizado aquí (no en Prisma como enum) para
 * poder extenderlo sin migración de schema. La validación zod usa
 * `KNOWN_AUDIT_ACTIONS` como `z.enum(...)` en el helper.
 */

// ───────────────────────── Catálogo de acciones ─────────────────────────

/**
 * Verbs auditados en P3-2. Convención: `<entityType>.<verb>` en snake_case.
 * Si necesitas auditar algo nuevo, primero añadelo aquí (y a la tabla
 * `ACTION_LABELS` para la UI). El helper rechaza acciones fuera del catálogo
 * con `[INVALID_INPUT]` para forzar revisión humana.
 */
export const KNOWN_AUDIT_ACTIONS = [
  // Tareas
  'task.created',
  'task.updated',
  'task.deleted',
  'task.status_changed',
  // Dependencias
  'dependency.created',
  'dependency.updated',
  // Baselines / Líneas base
  'baseline.captured',
  // Proyectos
  'project.created',
  'project.deleted',
  // Usuario / sesión
  'user.login',
  'user.logout',
  'user.password_changed',
  // Import / Export
  'import.completed',
  'export.downloaded',
  // Permisos
  'permission.granted',
  'permission.revoked',
] as const

export type AuditAction = (typeof KNOWN_AUDIT_ACTIONS)[number]

/**
 * Etiquetas humanas (es-MX) para la UI. El componente `AuditLogClient`
 * cae a la `action` cruda si no encuentra el label para tolerar acciones
 * legacy o nuevas aún sin etiqueta.
 */
export const ACTION_LABELS: Record<AuditAction, string> = {
  'task.created': 'Tarea creada',
  'task.updated': 'Tarea actualizada',
  'task.deleted': 'Tarea eliminada',
  'task.status_changed': 'Estado de tarea cambiado',
  'dependency.created': 'Dependencia creada',
  'dependency.updated': 'Dependencia actualizada',
  'baseline.captured': 'Línea base capturada',
  'project.created': 'Proyecto creado',
  'project.deleted': 'Proyecto eliminado',
  'user.login': 'Inicio de sesión',
  'user.logout': 'Cierre de sesión',
  'user.password_changed': 'Contraseña cambiada',
  'import.completed': 'Importación completada',
  'export.downloaded': 'Exportación descargada',
  'permission.granted': 'Permiso otorgado',
  'permission.revoked': 'Permiso revocado',
}

// ───────────────────────── Tipos de entidad ─────────────────────────

/**
 * Catálogo soft de entityType. Lista no exhaustiva — el campo en BD es
 * `String` libre. Mantenemos esta unión como hint para callers; el helper
 * no la valida estrictamente para no romper extensiones.
 */
export type AuditEntityType =
  | 'task'
  | 'project'
  | 'user'
  | 'dependency'
  | 'baseline'
  | 'permission'
  | 'import'
  | 'export'
  | 'session'
  | (string & {}) // permite valores ad-hoc sin perder autocompletado

// ───────────────────────── Errores tipados ─────────────────────────

export type AuditErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'PERSIST_FAILED'

// ───────────────────────── Inputs / Outputs ─────────────────────────

/**
 * Payload aceptado por `recordAuditEvent`. Casi todos los campos son
 * opcionales — solo `action` y `entityType` son obligatorios.
 *
 * Nota sobre snapshots: `before`/`after` deben ser objetos planos
 * serializables. NO incluyas campos sensibles (`password`, `token`,
 * `secret`, `apiKey`, `creditCard`). El helper aplica un sanitize
 * defensivo pero no es bala de plata.
 */
export type RecordAuditEventInput = {
  actorId?: string | null
  action: AuditAction
  entityType: AuditEntityType
  entityId?: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  ipAddress?: string | null
  userAgent?: string | null
  metadata?: Record<string, unknown> | null
}

/**
 * Forma serializada (ISO strings) que devuelven las queries cacheadas.
 * Todos los campos JSON los exponemos como `unknown` en cliente para
 * forzar al consumidor a hacer narrowing antes de renderizar.
 */
export type SerializedAuditEvent = {
  id: string
  actorId: string | null
  actorName: string | null
  actorEmail: string | null
  action: string
  entityType: string
  entityId: string | null
  before: unknown | null
  after: unknown | null
  ipAddress: string | null
  userAgent: string | null
  metadata: unknown | null
  createdAt: string
}

// ───────────────────────── Constantes ─────────────────────────

/**
 * Retention default (días). `purgeOldAuditEvents` borra eventos con
 * `createdAt < now() - DEFAULT_RETENTION_DAYS días`. Se puede sobreescribir
 * por argumento en la action.
 */
export const DEFAULT_RETENTION_DAYS = 90

/**
 * Lista de claves consideradas sensibles. El helper `recordAuditEvent`
 * las omite automáticamente de `before`/`after` antes de persistir,
 * sustituyéndolas por el sentinel `'[REDACTED]'`.
 */
export const SENSITIVE_KEYS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
  'creditCard',
  'ssn',
] as const

/**
 * Sanitiza recursivamente un objeto reemplazando los valores de claves
 * sensibles por `'[REDACTED]'`. Idempotente, defensivo: si recibe null
 * devuelve null; si recibe un primitivo lo retorna tal cual.
 */
export function redactSensitive<T>(value: T): T {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((v) => redactSensitive(v)) as unknown as T
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if ((SENSITIVE_KEYS as readonly string[]).includes(k)) {
      out[k] = '[REDACTED]'
    } else {
      out[k] = redactSensitive(v)
    }
  }
  return out as unknown as T
}
