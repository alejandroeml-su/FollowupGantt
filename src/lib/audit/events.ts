/**
 * Ola P3 · Equipo P3-2 · Audit Log centralizado.
 *
 * Helper público `recordAuditEvent` invocado desde server actions críticas
 * (createTask, updateDependency, captureBaseline, importExcel, etc.) para
 * persistir un evento de auditoría inmutable.
 *
 * Convenciones:
 *   - Errores tipados con prefijo `[CODE] detalle`.
 *   - **No es bloqueante**: el caller decide si `await` o fire-and-forget
 *     vía try/catch. La firma sí lanza para que tests puedan assertarlo,
 *     pero los wrappers de producción (`withAudit`) lo envuelven.
 *   - Sanitiza claves sensibles (`password`, `token`, …) en `before`/`after`
 *     vía `redactSensitive`. Defensivo, no bala de plata.
 *   - No hace cache: los eventos se leen vía `queryAuditEvents` que sí
 *     usa `unstable_cache` con tag `audit-events`.
 */

import { z } from 'zod'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import {
  KNOWN_AUDIT_ACTIONS,
  redactSensitive,
  type AuditErrorCode,
  type RecordAuditEventInput,
} from './types'

// ───────────────────────── Errores tipados ─────────────────────────

function auditError(code: AuditErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Schema zod ─────────────────────────

/**
 * Validación del input del helper. `action` está restringido al catálogo
 * `KNOWN_AUDIT_ACTIONS` para forzar revisión humana cuando se añadan
 * verbs nuevos. Si necesitas algo ad-hoc, primero amplía el catálogo
 * en `types.ts`.
 */
const recordAuditEventSchema = z.object({
  actorId: z.string().min(1).nullish(),
  action: z.enum(KNOWN_AUDIT_ACTIONS),
  entityType: z.string().min(1).max(100),
  entityId: z.string().min(1).max(200).nullish(),
  before: z.record(z.string(), z.unknown()).nullish(),
  after: z.record(z.string(), z.unknown()).nullish(),
  ipAddress: z.string().max(100).nullish(),
  userAgent: z.string().max(500).nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
})

// ───────────────────────── Helpers internos ─────────────────────────

/**
 * Convierte un `Record<string, unknown> | null | undefined` al tipo de
 * input JSON que Prisma acepta. `null` → `Prisma.JsonNull` (DB null
 * explícito); `undefined` → no setea el campo (default DB null);
 * objeto → cast directo.
 */
function toJsonInput(
  value: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull
  return value as unknown as Prisma.InputJsonValue
}

// ───────────────────────── API pública ─────────────────────────

/**
 * Persiste un evento de auditoría. Llama desde dentro de una server action
 * después de aplicar la mutación principal (no antes — si la mutación falla
 * no debe haber traza de un cambio que no ocurrió).
 *
 * @example
 * ```ts
 * await recordAuditEvent({
 *   actorId: session.userId,
 *   action: 'task.status_changed',
 *   entityType: 'task',
 *   entityId: task.id,
 *   before: { status: 'TODO' },
 *   after: { status: 'IN_PROGRESS' },
 *   ipAddress: request.headers.get('x-forwarded-for'),
 *   userAgent: request.headers.get('user-agent'),
 * })
 * ```
 *
 * @throws `[INVALID_INPUT]` si zod falla.
 * @throws `[PERSIST_FAILED]` si Prisma rechaza (ej. FK actorId inexistente
 *         con onDelete RESTRICT — no es nuestro caso pero defensivo).
 */
export async function recordAuditEvent(
  input: RecordAuditEventInput,
): Promise<{ id: string; createdAt: string }> {
  const parsed = recordAuditEventSchema.safeParse(input)
  if (!parsed.success) {
    auditError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const data = parsed.data

  // Sanitize antes de persistir. Si el caller pasó algo sensible por error,
  // al menos no se queda en BD como evidencia exfiltrada.
  const safeBefore = data.before ? redactSensitive(data.before) : data.before
  const safeAfter = data.after ? redactSensitive(data.after) : data.after
  const safeMetadata = data.metadata
    ? redactSensitive(data.metadata)
    : data.metadata

  try {
    const created = await prisma.auditEvent.create({
      data: {
        actorId: data.actorId ?? null,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId ?? null,
        before: toJsonInput(safeBefore),
        after: toJsonInput(safeAfter),
        ipAddress: data.ipAddress ?? null,
        userAgent: data.userAgent ?? null,
        metadata: toJsonInput(safeMetadata),
      },
      select: { id: true, createdAt: true },
    })
    return {
      id: created.id,
      createdAt: created.createdAt.toISOString(),
    }
  } catch (err) {
    // Conservamos el mensaje original detrás del prefix tipado para que el
    // caller pueda decidir swallow/rethrow sin perder contexto en logs.
    const detail = err instanceof Error ? err.message : String(err)
    auditError('PERSIST_FAILED', detail)
  }
}

/**
 * Versión "fire-and-forget" segura: nunca lanza, loguea a consola si falla.
 * Pensada para invocarse desde server actions críticas donde el evento
 * de auditoría es side-channel y no debe romper la operación principal.
 *
 * Si necesitas el id del evento o detectar fallos, usa `recordAuditEvent`
 * directamente.
 */
export async function recordAuditEventSafe(
  input: RecordAuditEventInput,
): Promise<void> {
  try {
    await recordAuditEvent(input)
  } catch (err) {
    // No reemplazamos por logger formal aún (el repo no tiene uno);
    // mantenemos el mismo patrón que `notifications.createNotification`
    // en sus callers.
    console.error('[Audit] recordAuditEventSafe failed', err)
  }
}
