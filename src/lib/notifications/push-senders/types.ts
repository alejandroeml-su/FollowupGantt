/**
 * Wave R4-B · Backend Push Dual — tipos compartidos entre adapters.
 *
 * Los 3 transportes (web-push / APNs / FCM) implementan la misma
 * interfaz `PushAdapter.send(sub, payload)` para que el dispatcher
 * pueda routear sin saber del proveedor concreto.
 *
 * `delivered` distingue casos:
 *   - true  → push entregado al proveedor (no garantiza que el device
 *     lo reciba — eso depende del usuario).
 *   - false → el adapter respondió error o skipped (credenciales no
 *     configuradas).  Si `gone === true`, la suscripción debe borrarse
 *     (404/410 web-push, BadDeviceToken APNs, registration-token-not-
 *     registered FCM).
 */

import type { PushSubscriptionKind } from '@prisma/client'

export type PushSubscriptionRow = {
  id: string
  userId: string
  endpoint: string
  /** Para WEB_PUSH: `{ p256dh, auth }`. Para APNS/FCM: null. */
  keys: { p256dh?: string; auth?: string } | null
  kind: PushSubscriptionKind
}

export type PushPayload = {
  title: string
  body?: string
  url?: string
  data?: Record<string, unknown>
}

export type AdapterSendResult = {
  delivered: boolean
  /** true si el token/endpoint es inválido y debe eliminarse de la BD. */
  gone?: boolean
  /** true si el adapter no tiene credenciales — no es error. */
  skipped?: boolean
  /** Detalle informativo (proveedor o status code). */
  error?: string
}

export interface PushAdapter {
  /** Identificador del adapter (para logs y métricas). */
  readonly kind: PushSubscriptionKind
  /** ¿Tiene credenciales configuradas? Si false, todas las llamadas son skip. */
  isConfigured(): boolean
  /** Envía un push individual; nunca lanza, devuelve `AdapterSendResult`. */
  send(sub: PushSubscriptionRow, payload: PushPayload): Promise<AdapterSendResult>
}
