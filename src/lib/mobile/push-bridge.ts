/**
 * Wave P21-A · Push notifications bridge para Capacitor.
 *
 * Coexistencia con Web Push (Wave P6):
 *   - En navegador estándar: `src/lib/pwa/push-subscribe.ts` registra
 *     un `PushSubscription` (endpoint https + p256dh/auth keys) y lo
 *     guarda en la tabla `PushSubscription` vía la server action
 *     `subscribeToPush`.
 *   - En Capacitor (Android/iOS): este bridge solicita permisos al SO
 *     y obtiene un token APNs/FCM. El token NO es una URL https, así
 *     que el schema actual de `subscribeToPush` (zod `string().url()`)
 *     lo rechazaría — ver "Deuda registrada" abajo.
 *
 * Estrategia actual (transitoria, sin tocar el backend):
 *   - Cuando estamos en Capacitor, se solicitan permisos y se registra
 *     el listener `registration` para obtener el token.
 *   - El token se loggea y se ofrece como callback para que el caller
 *     decida qué hacer con él (p. ej. guardar en `Preferences` plugin
 *     hasta que el backend acepte tokens nativos).
 *   - NO se envía al backend todavía para evitar errores
 *     `[INVALID_INPUT] endpoint must be url`.
 *
 * Deuda registrada (TODO Wave futura):
 *   1. Extender `PushSubscription` con columna `kind` enum
 *      (`WEB_PUSH | APNS | FCM`) + flexibilizar zod de `subscribeToPush`
 *      para aceptar tokens nativos (no necesariamente URLs).
 *   2. Ajustar el sender (`web-push` lib) para filtrar por `kind` y
 *      derivar a Firebase Admin SDK / APNs HTTP/2 según corresponda.
 *   3. Permitir múltiples suscripciones por usuario (web + mobile).
 *
 * CRÍTICO: este archivo es defensivo. Si no estamos en Capacitor, las
 * funciones son no-ops sin importar `@capacitor/push-notifications`
 * (evita `Module not found` en el build web).
 */

import { isCapacitor, getPlatform } from './capacitor-bridge'

export type CapacitorPushRegistration = {
  registered: boolean
  /** `'apns' | 'fcm' | null` — informativo. */
  channel: 'apns' | 'fcm' | null
  /** Token nativo opcional (solo si el SO lo entregó). */
  token: string | null
  /** Por qué no se registró (si aplica). */
  reason?:
    | 'NOT_CAPACITOR'
    | 'PERMISSION_DENIED'
    | 'PLUGIN_NOT_AVAILABLE'
    | 'TIMEOUT'
    | 'UNKNOWN'
}

/**
 * Carga dinámica del plugin Capacitor SOLO si estamos dentro del
 * WebView nativo. Usa `import()` con un string variable para que el
 * bundler (Turbopack/webpack) no intente resolver `@capacitor/...` en
 * tiempo de build cuando se compila la web.
 */
async function loadPushPlugin(): Promise<unknown | null> {
  if (!isCapacitor()) return null
  try {
    const moduleName = '@capacitor' + '/push-notifications'
    const mod: unknown = await import(/* @vite-ignore */ moduleName).catch(
      () => null,
    )
    return mod
  } catch {
    return null
  }
}

type PushNotificationsApi = {
  requestPermissions: () => Promise<{ receive: 'granted' | 'denied' | 'prompt' }>
  register: () => Promise<void>
  addListener: (
    event: string,
    cb: (payload: unknown) => void,
  ) => Promise<{ remove: () => Promise<void> } | { remove: () => void }>
}

function extractPushApi(mod: unknown): PushNotificationsApi | null {
  if (!mod || typeof mod !== 'object') return null
  const ns = mod as { PushNotifications?: unknown }
  const api = ns.PushNotifications as PushNotificationsApi | undefined
  if (!api) return null
  if (
    typeof api.requestPermissions !== 'function' ||
    typeof api.register !== 'function' ||
    typeof api.addListener !== 'function'
  ) {
    return null
  }
  return api
}

/**
 * Solicita permisos y registra el device contra APNs/FCM. Devuelve la
 * info disponible (token + canal). Si no estamos en Capacitor, no-op.
 *
 * El caller puede pasar `onToken` para reaccionar cuando el SO entregue
 * el token (es asíncrono — el evento `registration` se dispara después
 * de que `register()` resuelve).
 */
export async function registerCapacitorPush(opts?: {
  onToken?: (token: string, channel: 'apns' | 'fcm') => void
  timeoutMs?: number
}): Promise<CapacitorPushRegistration> {
  if (!isCapacitor()) {
    return { registered: false, channel: null, token: null, reason: 'NOT_CAPACITOR' }
  }

  const mod = await loadPushPlugin()
  const api = extractPushApi(mod)
  if (!api) {
    return {
      registered: false,
      channel: null,
      token: null,
      reason: 'PLUGIN_NOT_AVAILABLE',
    }
  }

  const perm = await api.requestPermissions()
  if (perm.receive !== 'granted') {
    return {
      registered: false,
      channel: null,
      token: null,
      reason: 'PERMISSION_DENIED',
    }
  }

  const channel: 'apns' | 'fcm' = getPlatform() === 'ios' ? 'apns' : 'fcm'

  const tokenPromise = new Promise<string | null>((resolve) => {
    const timeoutMs = opts?.timeoutMs ?? 10_000
    let resolved = false
    const finish = (t: string | null) => {
      if (resolved) return
      resolved = true
      resolve(t)
    }
    void api.addListener('registration', (payload: unknown) => {
      const token =
        payload && typeof payload === 'object' && 'value' in payload
          ? String((payload as { value: unknown }).value ?? '')
          : ''
      if (token) {
        try {
          opts?.onToken?.(token, channel)
        } catch {
          // El caller falló — no rompemos el bridge.
        }
        finish(token)
      } else {
        finish(null)
      }
    })
    void api.addListener('registrationError', () => finish(null))
    setTimeout(() => finish(null), timeoutMs)
  })

  try {
    await api.register()
  } catch {
    return { registered: false, channel, token: null, reason: 'UNKNOWN' }
  }

  const token = await tokenPromise
  return {
    registered: token !== null,
    channel,
    token,
    reason: token === null ? 'TIMEOUT' : undefined,
  }
}

/**
 * Helper de conveniencia para componentes: si estamos en Capacitor,
 * registra push y entrega el token; si no, no-op. No lanza.
 */
export async function ensureMobilePushIfAvailable(): Promise<CapacitorPushRegistration> {
  try {
    return await registerCapacitorPush()
  } catch {
    return {
      registered: false,
      channel: null,
      token: null,
      reason: 'UNKNOWN',
    }
  }
}
