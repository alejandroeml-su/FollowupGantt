/**
 * R3-E · Audit Streaming · Tipos compartidos por adapters + engine.
 */

import type { AuditStreamKind } from '@prisma/client'

export type StreamableEvent = {
  id: string
  action: string
  entityType: string
  entityId: string | null
  actorId: string | null
  workspaceId: string | null
  before: unknown
  after: unknown
  metadata: unknown
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
}

export type StreamTargetSnapshot = {
  id: string
  workspaceId: string
  kind: AuditStreamKind
  endpoint: string
  secret: string
}

export type AdapterResult =
  | { ok: true; statusCode: number }
  | { ok: false; statusCode?: number; error: string }

export type Adapter = {
  send(
    target: StreamTargetSnapshot,
    events: StreamableEvent[],
    fetchImpl?: typeof fetch,
  ): Promise<AdapterResult>
}
