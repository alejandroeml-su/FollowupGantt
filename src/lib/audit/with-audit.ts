/**
 * Ola P3 · Equipo P3-2 · Audit Log centralizado.
 *
 * `withAudit(serverAction, descriptor)` — Higher-order function que envuelve
 * una server action y registra automáticamente un evento `AuditEvent`
 * tras una ejecución exitosa.
 *
 * Diseño deliberado:
 *   - El audit es side-effect post-éxito: si la action lanza, NO se loguea
 *     (compliance: "no eventos para cambios que no ocurrieron").
 *   - El descriptor puede ser estático (`{ action, entityType, ... }`) o
 *     una función `(args, result) => RecordAuditEventInput` para extraer
 *     ids/snapshots derivados del payload o del resultado.
 *   - El logging usa la versión `safe` (no rompe la action si falla la
 *     persistencia del audit). Si se quiere fail-fast, llamar a
 *     `recordAuditEvent` directamente sin el wrapper.
 *
 * Ejemplo:
 * ```ts
 * export const deleteTask = withAudit(
 *   async (taskId: string) => prisma.task.delete({ where: { id: taskId } }),
 *   (args, _result) => ({
 *     action: 'task.deleted',
 *     entityType: 'task',
 *     entityId: args[0],
 *   }),
 * )
 * ```
 */

import type { RecordAuditEventInput } from './types'
import { recordAuditEventSafe } from './events'

// ───────────────────────── Tipos ─────────────────────────

/**
 * Función generadora del descriptor. Recibe los args de la action y el
 * resultado tipado para que pueda extraer `entityId` del objeto creado,
 * o construir snapshots `before`/`after` con los datos disponibles.
 *
 * El generador puede ser sync o async. Si lanza, el wrapper logea el
 * error y no audita — la action principal ya tuvo éxito.
 */
export type AuditDescriptorFn<TArgs extends unknown[], TResult> = (
  args: TArgs,
  result: TResult,
) => RecordAuditEventInput | Promise<RecordAuditEventInput>

export type AuditDescriptor<TArgs extends unknown[], TResult> =
  | RecordAuditEventInput
  | AuditDescriptorFn<TArgs, TResult>

// ───────────────────────── HOF ─────────────────────────

/**
 * Envuelve una server action para añadir audit logging post-éxito.
 *
 * El wrapper preserva la firma (args y return type) de la action original
 * para que TypeScript siga inferiendo correctamente desde los callsites.
 *
 * @param action La server action original (`'use server'` ya aplicado).
 * @param descriptor Plantilla del evento o función que la genera.
 * @returns Función con la misma firma que `action` que persiste audit
 *          después del retorno exitoso.
 */
export function withAudit<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
  descriptor: AuditDescriptor<TArgs, TResult>,
): (...args: TArgs) => Promise<TResult> {
  return async function wrappedAction(...args: TArgs): Promise<TResult> {
    // 1) Ejecuta la action original. Si lanza, propagamos sin auditar.
    const result = await action(...args)

    // 2) Resuelve el descriptor (estático o derivado).
    let input: RecordAuditEventInput | null = null
    try {
      input =
        typeof descriptor === 'function'
          ? await (descriptor as AuditDescriptorFn<TArgs, TResult>)(args, result)
          : descriptor
    } catch (err) {
      // Generador del descriptor explotó. La action ya tuvo éxito; no
      // queremos romperla por el side-channel. Logueamos para debug.
      console.error('[Audit] descriptor function failed', err)
      return result
    }

    // 3) Persiste el evento. `recordAuditEventSafe` nunca lanza.
    if (input) await recordAuditEventSafe(input)

    return result
  }
}

/**
 * Variante "trazada": además de auditar, devuelve junto al resultado el
 * id del evento creado (o null si falló). Útil cuando el caller necesita
 * mostrar el id en una toast de "auditado como #abc123".
 *
 * Por simplicidad no comparte código con `withAudit` — duplicamos las 10
 * líneas a propósito para que el tipo de retorno sea claro.
 */
export function withAuditTraced<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
  descriptor: AuditDescriptor<TArgs, TResult>,
): (...args: TArgs) => Promise<{ result: TResult; auditId: string | null }> {
  return async function tracedAction(...args: TArgs) {
    const result = await action(...args)
    let input: RecordAuditEventInput | null = null
    try {
      input =
        typeof descriptor === 'function'
          ? await (descriptor as AuditDescriptorFn<TArgs, TResult>)(args, result)
          : descriptor
    } catch (err) {
      console.error('[Audit] descriptor function failed', err)
      return { result, auditId: null }
    }
    if (!input) return { result, auditId: null }

    // Importamos lazy para evitar ciclo si en el futuro `events.ts`
    // necesita helpers de aquí. Hoy no es necesario pero deja la puerta.
    const { recordAuditEvent } = await import('./events')
    try {
      const ev = await recordAuditEvent(input)
      return { result, auditId: ev.id }
    } catch (err) {
      console.error('[Audit] recordAuditEvent (traced) failed', err)
      return { result, auditId: null }
    }
  }
}
