import 'server-only'

/**
 * Wave P6 · Equipo B2 — Helper que combina `createNotification` con
 * `sendPushToUser` para que un único call dispare ambos canales:
 *
 *   1. Persistencia in-app (`Notification` row → Bell badge / dropdown).
 *   2. Web Push opcional (envío al endpoint del browser via `webpush`).
 *
 * Diseño:
 *   - El push es **best-effort**: si falla, NO propagamos el error al
 *     caller. La Notification ya quedó persistida, que es la operación
 *     crítica. Loggeamos a `console.error` para observabilidad.
 *   - El payload del push se deriva automáticamente de la Notification
 *     creada (title/body/link → title/body/url).
 *   - El caller puede customizar el payload con `pushOverrides` si
 *     quiere un body más corto o una URL distinta para el push.
 *   - El push se desactiva pasando `push: false` (útil para tipos como
 *     `IMPORT_COMPLETED` donde no queremos saturar al usuario con
 *     notificaciones del SO mientras procesa un Excel).
 *
 * Convenciones del repo:
 *   - Errores tipados con prefijo `[CODE] detalle`.
 *   - Strings ES profesionales.
 *   - `'server-only'` para evitar bundling client-side accidental
 *     (web-push usa `crypto` Node).
 */

import {
  createNotification,
  type CreateNotificationInput,
  type SerializedNotification,
} from '@/lib/actions/notifications'
// Wave R4-B · refactor: usa dispatcher dual (web + native) en lugar del
// helper P6 `sendPushToUser`. Backward-compat: el `DispatchPushResult` se
// mapea a un `SendPushResult`-like para no romper consumers del retorno.
import {
  dispatchPush,
  type DispatchPushResult,
} from '@/lib/notifications/push-dispatcher'
import type { PushPayload as WebPushPayload } from '@/lib/notifications/push-senders'

export type SendPushResult = {
  sent: number
  failed: number
  removed: string[]
  skipped?: 'no-vapid' | 'no-subscriptions'
}

function toLegacyResult(r: DispatchPushResult): SendPushResult {
  return {
    sent: r.total.sent,
    failed: r.total.failed,
    removed: [], // el dispatcher elimina internamente; ya no expone endpoints
  }
}

export type DispatchNotificationErrorCode = 'INVALID_INPUT'

function actionError(
  code: DispatchNotificationErrorCode,
  detail: string,
): never {
  throw new Error(`[${code}] ${detail}`)
}

export type DispatchNotificationOptions = {
  /**
   * Si es `false`, omite el push (solo persistencia in-app). Default
   * `true` — el helper existe precisamente para disparar ambos canales.
   */
  push?: boolean
  /**
   * Overrides para el payload del push. Lo que no especifiques se deriva
   * de la Notification (title/body/link). Útil para shortear `body` (los
   * push del SO truncan agresivamente) o para cambiar la URL de
   * destino (e.g. push de mención abre la tarea, in-app abre el
   * comentario específico).
   */
  pushOverrides?: Partial<WebPushPayload>
}

export type DispatchNotificationResult = {
  /** La Notification persistida (in-app). Siempre presente. */
  notification: SerializedNotification
  /**
   * Resultado del envío push. `null` si `push: false` o si lanzó error
   * (ya loggeado). Nunca `undefined` — facilita asserts en tests.
   */
  push: SendPushResult | null
}

/**
 * Crea una Notification in-app y opcionalmente dispara un Web Push al
 * mismo userId. El Web Push se ejecuta DESPUÉS de persistir, en
 * try/catch — fallos de push no abortan el flujo del caller.
 *
 * Uso típico desde server actions:
 *
 *     await dispatchNotificationWithPush({
 *       userId: assignee.id,
 *       type: 'TASK_ASSIGNED',
 *       title: `Nueva tarea: ${task.title}`,
 *       body: `Asignada por ${author.name}`,
 *       link: `/list?taskId=${task.id}`,
 *     })
 */
export async function dispatchNotificationWithPush(
  input: CreateNotificationInput,
  options: DispatchNotificationOptions = {},
): Promise<DispatchNotificationResult> {
  if (!input || typeof input !== 'object') {
    actionError('INVALID_INPUT', 'input requerido')
  }

  // 1) Persistencia in-app (errores SÍ propagan — operación crítica).
  const notification = await createNotification(input)

  // 2) Web Push opcional. Default ON; off cuando el caller lo pide.
  const pushEnabled = options.push !== false
  if (!pushEnabled) {
    return { notification, push: null }
  }

  const overrides = options.pushOverrides ?? {}
  const payload: WebPushPayload = {
    title: overrides.title ?? notification.title,
    body: overrides.body ?? notification.body ?? undefined,
    url: overrides.url ?? notification.link ?? undefined,
    data: overrides.data ?? {
      notificationId: notification.id,
      type: notification.type,
    },
  }

  try {
    const result = await dispatchPush(notification.userId, payload)
    return { notification, push: toLegacyResult(result) }
  } catch (err) {
    // Best-effort: la Notification ya quedó persistida. Loggeamos para
    // que el operador detecte VAPID mal configurado / endpoints caídos
    // de forma agregada en logs, sin romper el flujo de negocio.
    console.error(
      '[dispatch-with-push] dispatchPush falló — Notification persistida ok',
      err,
    )
    return { notification, push: null }
  }
}
