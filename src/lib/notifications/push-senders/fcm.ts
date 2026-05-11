/**
 * Wave R4-B · Adapter FCM (Firebase Cloud Messaging) — Android Capacitor.
 *
 * Decisión técnica:
 *   - NO depende de `firebase-admin` (~50MB con deps Google APIs).
 *   - Usa FCM HTTP v1 API directamente: POST a
 *     `https://fcm.googleapis.com/v1/projects/{projectId}/messages:send`
 *     con bearer token OAuth2 obtenido por JWT RS256 firmado vía
 *     `node:crypto`.
 *   - Justificación: el SDK firebase-admin es overkill para enviar push.
 *     La API HTTP v1 es la actual recomendada por Google
 *     (https://firebase.google.com/docs/cloud-messaging/migrate-v1).
 *
 * Env vars requeridas:
 *   - `FIREBASE_PROJECT_ID`   — Project ID del proyecto Firebase.
 *   - `FIREBASE_CLIENT_EMAIL` — Service account email (extraído del JSON).
 *   - `FIREBASE_PRIVATE_KEY`  — Service account private key PEM (inline).
 *
 * Si cualquiera falta → `isConfigured() = false` → adapter skip (no error).
 *
 * Convenciones:
 *   - 'use server' purity.
 *   - Errores nunca propagan: siempre `AdapterSendResult`.
 *   - Access token cacheado en memoria (~50 min TTL — Google emite 1h).
 */

import 'server-only'
import { createSign } from 'node:crypto'
import type {
  AdapterSendResult,
  PushAdapter,
  PushPayload,
  PushSubscriptionRow,
} from './types'

type FcmConfig = {
  projectId: string
  clientEmail: string
  privateKey: string
}

let cachedConfig: FcmConfig | null | undefined = undefined
let cachedToken: { accessToken: string; expiresAt: number } | null = null
const TOKEN_TTL_BUFFER_MS = 5 * 60 * 1000 // refresh 5 min antes de expirar

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'

function loadConfig(): FcmConfig | null {
  if (cachedConfig !== undefined) return cachedConfig

  const projectId = process.env.FIREBASE_PROJECT_ID ?? ''
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL ?? ''
  // Las env vars suelen escapar \n; restauramos saltos reales.
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY ?? ''
  const privateKey = privateKeyRaw.replace(/\\n/g, '\n')

  if (!projectId || !clientEmail || !privateKey) {
    cachedConfig = null
    return null
  }

  cachedConfig = { projectId, clientEmail, privateKey }
  return cachedConfig
}

/** Solo para tests: limpia caches y vuelve a leer env vars. */
export function __resetFcmForTests(): void {
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

function signGoogleJwt(config: FcmConfig): string {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: config.clientEmail,
    scope: FCM_SCOPE,
    aud: OAUTH_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  }

  const headerB64 = base64UrlEncode(JSON.stringify(header))
  const claimsB64 = base64UrlEncode(JSON.stringify(claims))
  const signingInput = `${headerB64}.${claimsB64}`

  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  const signature = signer.sign(config.privateKey)
  const sigB64 = base64UrlEncode(signature)

  return `${signingInput}.${sigB64}`
}

async function getAccessToken(config: FcmConfig): Promise<string | null> {
  const now = Date.now()
  if (cachedToken && now < cachedToken.expiresAt - TOKEN_TTL_BUFFER_MS) {
    return cachedToken.accessToken
  }

  const jwt = signGoogleJwt(config)
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  })

  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) {
      console.warn(
        '[push-senders/fcm] OAuth token fetch failed status=',
        res.status,
      )
      return null
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!json.access_token) return null
    const expiresIn = (json.expires_in ?? 3600) * 1000
    cachedToken = {
      accessToken: json.access_token,
      expiresAt: now + expiresIn,
    }
    return cachedToken.accessToken
  } catch (err) {
    console.warn('[push-senders/fcm] OAuth fetch exception', err)
    return null
  }
}

function buildFcmMessage(deviceToken: string, payload: PushPayload) {
  // FCM HTTP v1 message envelope.
  const notification: Record<string, string> = { title: payload.title }
  if (payload.body) notification.body = payload.body

  const dataKv: Record<string, string> = {}
  if (payload.url) dataKv.url = payload.url
  if (payload.data) {
    for (const [k, v] of Object.entries(payload.data)) {
      // FCM data values DEBEN ser strings.
      dataKv[k] = typeof v === 'string' ? v : JSON.stringify(v)
    }
  }

  return {
    message: {
      token: deviceToken,
      notification,
      ...(Object.keys(dataKv).length > 0 ? { data: dataKv } : {}),
    },
  }
}

export const fcmAdapter: PushAdapter = {
  kind: 'FCM',

  isConfigured(): boolean {
    return loadConfig() !== null
  },

  async send(
    sub: PushSubscriptionRow,
    payload: PushPayload,
  ): Promise<AdapterSendResult> {
    const config = loadConfig()
    if (!config) {
      return { delivered: false, skipped: true, error: 'fcm-not-configured' }
    }

    const deviceToken = sub.endpoint
    if (!deviceToken || deviceToken.length === 0) {
      return { delivered: false, gone: true, error: 'INVALID_DEVICE_TOKEN' }
    }

    const accessToken = await getAccessToken(config)
    if (!accessToken) {
      return { delivered: false, error: 'FCM_AUTH_FAILED' }
    }

    const message = buildFcmMessage(deviceToken, payload)
    const messageJson = JSON.stringify(message)

    // FCM HTTP v1 limita payload notification a 4KB.
    if (Buffer.byteLength(messageJson, 'utf8') > 4096) {
      return { delivered: false, error: 'PAYLOAD_TOO_LARGE' }
    }

    const url = `https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: messageJson,
      })

      if (res.ok) return { delivered: true }

      // Parse error response — FCM puede devolver "UNREGISTERED" o
      // "INVALID_ARGUMENT" para tokens obsoletos.
      const errBody = await res.text()
      let errorCode: string | undefined
      try {
        const parsed = JSON.parse(errBody) as {
          error?: { status?: string; message?: string; details?: unknown }
        }
        errorCode =
          parsed?.error?.status ?? parsed?.error?.message ?? undefined
      } catch {
        errorCode = undefined
      }

      const gone =
        res.status === 404 ||
        errorCode === 'UNREGISTERED' ||
        errorCode === 'NOT_FOUND'

      return {
        delivered: false,
        gone,
        error: `fcm status=${res.status} code=${errorCode ?? 'unknown'}`,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      return { delivered: false, error: `fcm exception: ${message}` }
    }
  },
}
