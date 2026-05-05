'use server'

/**
 * Wave P8 · Equipo P8-5 — Server actions para disparar sync manual.
 *
 * Dos puntos de entrada:
 *   - `triggerMyCalendarSync`: el usuario actual presiona "Sincronizar
 *     ahora" en /settings/calendar.
 *   - `triggerScheduledSync`: invocado por el cron `/api/cron/calendar-sync`.
 *     Itera todas las conexiones habilitadas (no solo del usuario actual).
 *
 * Errores tipados:
 *   - `[INVALID_INPUT]`, `[UNAUTHORIZED]`.
 */

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth/get-current-user'
import {
  runSyncForUser,
  runSyncForAll,
  type RunSyncSummary,
} from '@/lib/calendar/sync-engine'

export type CalendarSyncErrorCode = 'INVALID_INPUT' | 'UNAUTHORIZED'

function actionError(code: CalendarSyncErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

export interface SerializedSyncSummary {
  userId: string
  totalConnections: number
  totalUpserted: number
  totalFailed: number
  results: Array<{
    connectionId: string
    provider: 'GOOGLE' | 'MICROSOFT' | 'ICS'
    itemsConsidered: number
    itemsUpserted: number
    itemsFailed: number
    errors: Array<{ taskId: string | null; message: string }>
  }>
}

function serializeSummary(s: RunSyncSummary): SerializedSyncSummary {
  return {
    userId: s.userId,
    totalConnections: s.totalConnections,
    totalUpserted: s.totalUpserted,
    totalFailed: s.totalFailed,
    results: s.results.map((r) => ({
      connectionId: r.connectionId,
      provider: r.provider,
      itemsConsidered: r.itemsConsidered,
      itemsUpserted: r.itemsUpserted,
      itemsFailed: r.itemsFailed,
      errors: r.errors,
    })),
  }
}

/**
 * Disparado desde la UI de /settings/calendar. Sincroniza todas las
 * conexiones del usuario actual (las que tengan `syncEnabled=true`).
 */
export async function triggerMyCalendarSync(): Promise<SerializedSyncSummary> {
  const user = await requireUser()
  if (!user) actionError('UNAUTHORIZED', 'sesión requerida')
  const summary = await runSyncForUser(user.id)
  revalidatePath('/settings/calendar')
  return serializeSummary(summary)
}

/**
 * Punto de entrada del cron. NO requiere sesión: el handler de la ruta
 * valida `Authorization: Bearer ${CRON_SECRET}` antes de invocar.
 */
export async function triggerScheduledSync(): Promise<{
  usersProcessed: number
  totalUpserted: number
  totalFailed: number
}> {
  const result = await runSyncForAll()
  return {
    usersProcessed: result.usersProcessed,
    totalUpserted: result.totalUpserted,
    totalFailed: result.totalFailed,
  }
}
