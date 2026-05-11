/**
 * Wave R4-B · Adapter APNs (Apple Push Notification service) — iOS Capacitor.
 *
 * Decisión técnica:
 *   - NO depende de `@parse/node-apn` ni `apn` (forks de mantenimiento).
 *   - Usa `node:http2` (nativo Node 20+) con JWT ES256 firmado vía
 *     `node:crypto` (también nativo). Cero dependencias nuevas.
 *   - Justificación: las libs externas wrappers (`apn`, `node-apn-http2`)
 *     están sin mantenimiento activo desde 2021/2023 y agregan complejidad
 *     innecesaria. Apple expone HTTP/2 + JWT bearer como API estable
 *     (https://developer.apple.com/documentation/usernotifications/sending_notification_requests_to_apns).
 *
 * Env vars requeridas:
 *   - `APNS_KEY_ID`     — Key ID (10 chars) creado en Apple Developer.
 *   - `APNS_TEAM_ID`    — Team ID (10 chars) de la cuenta Apple Developer.
 *   - `APNS_BUNDLE_ID`  — Bundle ID de la app (ej. `com.complejoavante.sync`).
 *   - `APNS_KEY_P8`     — Contenido del archivo .p8 (PEM) inline en env.
 *   - `APNS_PRODUCTION` — `true` para api.push.apple.com, false para sandbox.
 *
 * Si cualquiera falta → `isConfigured() = false` → adapter skip (no error).
 *
 * Convenciones:
 *   - 'use server' purity.
 *   - Errores nunca propagan: siempre `AdapterSendResult`.
 *   - JWT con TTL 50 min (Apple permite hasta 1h) cacheado en memoria.
 */

import 'server-only'
import { createSign } from 'node:crypto'
import type {
  AdapterSendResult,
  PushAdapter,
  PushPayload,
  PushSubscriptionRow,
} from './types'

type ApnsConfig = {
  keyId: string
  teamId: string
  bundleId: string
  keyP8: string
  production: boolean
}

let cachedConfig: ApnsConfig | null | undefined = undefined
let cachedToken: { jwt: string; issuedAt: number } | null = null
const JWT_TTL_MS = 50 * 60 * 1000 // 50 min (Apple max 1h)

function loadConfig(): ApnsConfig | null {
  if (cachedConfig !== undefined) return cachedConfig

  const keyId = process.env.APNS_KEY_ID ?? ''
  const teamId = process.env.APNS_TEAM_ID ?? ''
  const bundleId = process.env.APNS_BUNDLE_ID ?? ''
  const keyP8 = process.env.APNS_KEY_P8 ?? ''
  const production = (process.env.APNS_PRODUCTION ?? 'true') === 'true'

  if (!keyId || !teamId || !bundleId || !keyP8) {
    cachedConfig = null
    return null
  }

  cachedConfig = { keyId, teamId, bundleId, keyP8, production }
  return cachedConfig
}

/** Solo para tests: limpia caches y vuelve a leer env vars. */
export function __resetApnsForTests(): void {
  cachedConfig = undefined
  cachedToken = null
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input
  return buf
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function signApnsJwt(config: ApnsConfig): string {
  const now = Date.now()
  if (cachedToken && now - cachedToken.issuedAt < JWT_TTL_MS) {
    return cachedToken.jwt
  }

  const header = { alg: 'ES256', kid: config.keyId, typ: 'JWT' }
  const claims = { iss: config.teamId, iat: Math.floor(now / 1000) }

  const headerB64 = base64UrlEncode(JSON.stringify(header))
  const claimsB64 = base64UrlEncode(JSON.stringify(claims))
  const signingInput = `${headerB64}.${claimsB64}`

  const signer = createSign('SHA256')
  signer.update(signingInput)
  // ES256: firma con la curva P-256. `createSign` acepta PEM directamente.
  const signature = signer.sign({ key: config.keyP8, dsaEncoding: 'ieee-p1363' })
  const sigB64 = base64UrlEncode(signature)

  const jwt = `${signingInput}.${sigB64}`
  cachedToken = { jwt, issuedAt: now }
  return jwt
}

function buildApnsPayload(payload: PushPayload): string {
  // Apple Payload Spec: aps.alert {title, body}, aps.sound default, custom data.
  const aps: Record<string, unknown> = {
    alert: {
      title: payload.title,
      ...(payload.body ? { body: payload.body } : {}),
    },
    sound: 'default',
  }
  const body: Record<string, unknown> = { aps }
  if (payload.url) body.url = payload.url
  if (payload.data) Object.assign(body, payload.data)
  return JSON.stringify(body)
}

async function postToApns(
  config: ApnsConfig,
  deviceToken: string,
  bodyJson: string,
): Promise<{ status: number; reason?: string }> {
  // Lazy import http2 — no se evalúa hasta que el adapter realmente envía.
  const http2 = await import('node:http2')
  const host = config.production
    ? 'https://api.push.apple.com'
    : 'https://api.sandbox.push.apple.com'

  return new Promise((resolve) => {
    const client = http2.connect(host)
    const jwt = signApnsJwt(config)

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': config.bundleId,
      'apns-push-type': 'alert',
      'content-type': 'application/json',
    })

    let status = 0
    let bodyChunks = ''

    req.on('response', (headers) => {
      const s = headers[':status']
      status = typeof s === 'number' ? s : Number(s) || 0
    })
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      bodyChunks += chunk
    })
    req.on('end', () => {
      client.close()
      let reason: string | undefined
      try {
        const parsed = bodyChunks ? (JSON.parse(bodyChunks) as { reason?: string }) : null
        reason = parsed?.reason
      } catch {
        reason = undefined
      }
      resolve({ status, reason })
    })
    req.on('error', (err) => {
      client.close()
      resolve({ status: 0, reason: err.message })
    })

    req.write(bodyJson)
    req.end()
  })
}

export const apnsAdapter: PushAdapter = {
  kind: 'APNS',

  isConfigured(): boolean {
    return loadConfig() !== null
  },

  async send(
    sub: PushSubscriptionRow,
    payload: PushPayload,
  ): Promise<AdapterSendResult> {
    const config = loadConfig()
    if (!config) {
      return { delivered: false, skipped: true, error: 'apns-not-configured' }
    }

    const deviceToken = sub.endpoint
    if (!deviceToken || deviceToken.length === 0) {
      return { delivered: false, gone: true, error: 'INVALID_DEVICE_TOKEN' }
    }

    const bodyJson = buildApnsPayload(payload)
    // APNs limita payload a 4KB (4096 bytes) para alert push.
    if (Buffer.byteLength(bodyJson, 'utf8') > 4096) {
      return {
        delivered: false,
        error: 'PAYLOAD_TOO_LARGE',
      }
    }

    try {
      const { status, reason } = await postToApns(config, deviceToken, bodyJson)
      if (status === 200) {
        return { delivered: true }
      }
      // BadDeviceToken / Unregistered → cleanup.
      const gone =
        status === 410 ||
        reason === 'BadDeviceToken' ||
        reason === 'Unregistered' ||
        reason === 'DeviceTokenNotForTopic'
      return {
        delivered: false,
        gone,
        error: `apns status=${status} reason=${reason ?? 'unknown'}`,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      return { delivered: false, error: `apns exception: ${message}` }
    }
  },
}
