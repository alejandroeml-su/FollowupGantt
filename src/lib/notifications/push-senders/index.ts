/**
 * Wave R4-B · Barrel de adapters push.
 *
 * Re-exports los 3 transportes para que el dispatcher pueda construir el
 * mapa `kind → adapter` sin importar cada uno individualmente.
 */

export { webPushAdapter, getPublicVapidKey, __resetWebPushForTests } from './web-push'
export { apnsAdapter, __resetApnsForTests } from './apns'
export { fcmAdapter, __resetFcmForTests } from './fcm'
export type {
  PushAdapter,
  PushPayload,
  PushSubscriptionRow,
  AdapterSendResult,
} from './types'
