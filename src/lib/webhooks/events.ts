/**
 * Tipos y constantes puros del catálogo de eventos webhook.
 *
 * Este archivo NO tiene `import 'server-only'` para que client components
 * (e.g. `WebhooksAdmin`) puedan importar `KNOWN_EVENTS` y `WebhookEventType`
 * sin arrastrar el dispatcher (que sí depende de Prisma → pg).
 *
 * El dispatcher en `./dispatcher.ts` re-exporta estos símbolos para
 * preservar el contrato existente.
 */

export type WebhookEventType =
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'project.created'
  | 'project.updated'
  | 'project.deleted'
  | 'dependency.created'
  | 'dependency.deleted'
  | 'baseline.captured'

export const KNOWN_EVENTS: readonly WebhookEventType[] = [
  'task.created',
  'task.updated',
  'task.deleted',
  'project.created',
  'project.updated',
  'project.deleted',
  'dependency.created',
  'dependency.deleted',
  'baseline.captured',
]
