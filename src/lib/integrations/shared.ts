/**
 * Wave R5 Extended · US R5E-Marketplace — Constantes y eventos compartidos.
 *
 * Módulo neutro (sin `'use server'`) que exporta valores y tipos consumidos
 * tanto por el registry (no-async) como por los server actions del marketplace.
 *
 * Regla descubierta en PR #278: exportar valores no-async desde un archivo
 * `'use server'` rompe el build de Next 16. Cualquier constante/tipo
 * compartido debe vivir aquí.
 */

/**
 * Eventos del marketplace que un provider puede suscribirse a notificar.
 * El catálogo es centralizado para no duplicar strings en cada provider
 * del registry — Slack escucha `task.assigned`/`task.completed`/…, GitHub
 * escucha `task.completed` (para comentar en el issue vinculado), etc.
 */
export const MARKETPLACE_EVENTS = [
  'task.created',
  'task.completed',
  'task.assigned',
  'risk.created',
] as const

export type MarketplaceEvent = (typeof MARKETPLACE_EVENTS)[number]

/**
 * Códigos de error tipados del marketplace. Mismo patrón `[CODE] message`
 * del resto del repo para que la UI haga pattern-matching.
 */
export type MarketplaceErrorCode =
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'INTEGRATION_NOT_INSTALLED'
  | 'EXTERNAL_API_ERROR'
  | 'INSTALL_NOT_FOUND'
  | 'PROVIDER_NOT_FOUND'
  | 'TASK_NOT_FOUND'

/**
 * Helper compartido para construir errores tipados. NO va en el archivo
 * `actions/marketplace.ts` porque también lo consume el dispatcher (no
 * server action) — mantenerlo aquí evita el ciclo.
 */
export function marketplaceError(
  code: MarketplaceErrorCode,
  detail: string,
): never {
  throw new Error(`[${code}] ${detail}`)
}

/**
 * Tras N entregas consecutivas fallidas, el install pasa a status `ERROR`
 * para que la UI lo destaque. 3 es un compromiso razonable: tolera glitches
 * transitorios sin esconder problemas reales.
 */
export const CONSECUTIVE_FAILURES_THRESHOLD = 3

/**
 * Derivación de la URL pública para construir deep-links en notificaciones
 * (Slack, GitHub comments). Cae a la URL de prod si la env var no está
 * configurada — preferible a fallar silenciosamente.
 */
export function getAppUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv.replace(/\/+$/, '')
  }
  return 'https://followup-gantt-beta.vercel.app'
}

/**
 * Construye la URL canónica de una tarea en Sync. Usado por los providers
 * para incluir el link en sus mensajes (Slack message attachment, GitHub
 * issue comment, etc.).
 */
export function buildTaskUrl(taskId: string): string {
  return `${getAppUrl()}/list?taskId=${encodeURIComponent(taskId)}`
}

/**
 * Construye la URL canónica de un proyecto en Sync.
 */
export function buildProjectUrl(projectId: string): string {
  return `${getAppUrl()}/list?projectId=${encodeURIComponent(projectId)}`
}
