/**
 * Wave P6 · Equipo A4 — Tipos mínimos para `web-push` (npm).
 *
 * El paquete `web-push@3.x` no publica tipos oficiales y `@types/web-push`
 * no se instala (decisión del scope: minimizar deps). Declaramos solo la
 * API que consumimos en `src/lib/web-push/server.ts`.
 */
declare module 'web-push' {
  export interface VapidKeys {
    publicKey: string
    privateKey: string
  }

  export interface PushSubscriptionKeys {
    p256dh: string
    auth: string
  }

  export interface PushSubscription {
    endpoint: string
    keys: PushSubscriptionKeys
  }

  export interface SendResult {
    statusCode: number
    body: string
    headers: Record<string, string>
  }

  export interface RequestOptions {
    TTL?: number
    headers?: Record<string, string>
    contentEncoding?: string
    proxy?: string
    timeout?: number
    topic?: string
    urgency?: 'very-low' | 'low' | 'normal' | 'high'
  }

  export function generateVAPIDKeys(): VapidKeys
  export function setVapidDetails(
    subject: string,
    publicKey: string,
    privateKey: string,
  ): void
  export function sendNotification(
    subscription: PushSubscription,
    payload?: string | Buffer | null,
    options?: RequestOptions,
  ): Promise<SendResult>

  const _default: {
    generateVAPIDKeys: typeof generateVAPIDKeys
    setVapidDetails: typeof setVapidDetails
    sendNotification: typeof sendNotification
  }
  export default _default
}
