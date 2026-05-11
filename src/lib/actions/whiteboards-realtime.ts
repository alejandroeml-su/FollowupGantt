'use server'

/**
 * R4-D · Whiteboards · Real-time co-edit · Server actions Yjs.
 *
 * Persiste el `stateYjs` de una pizarra. Funciona como capa de cache
 * convergente: la tabla relacional `WhiteboardElement` sigue siendo la
 * fuente de verdad para queries server-side (e.g. exportar a PNG), pero
 * mientras hay usuarios co-editando, el state Yjs es el primario y se
 * reconcilia a relacional periódicamente.
 *
 * MVP simplificado: en este sprint sólo persistimos el `stateYjs`. La
 * reconciliación a `WhiteboardElement` queda como follow-up (P21 o R4-D2);
 * cuando llega `saveWhiteboardYjsState`, opcionalmente el caller puede
 * pasar una lista normalizada de elementos para reconciliar la tabla
 * relacional, pero NO es obligatoria.
 */

import { z } from 'zod'
import * as Y from 'yjs'
import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requireUser } from '@/lib/auth'
import { recordAuditEventSafe } from '@/lib/audit/events'

// ───────────────────────── Errores tipados ─────────────────────────

export type WhiteboardsRealtimeErrorCode =
  | 'R4D_INVALID_INPUT'
  | 'R4D_WHITEBOARD_NOT_FOUND'
  | 'R4D_FORBIDDEN'
  | 'R4D_PAYLOAD_TOO_LARGE'

function rtError(code: WhiteboardsRealtimeErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Constantes ─────────────────────────

const MAX_YJS_STATE_BYTES = 5 * 1024 * 1024 // 5 MB

const stateBufferSchema = z
  .instanceof(Uint8Array)
  .refine((b) => b.byteLength <= MAX_YJS_STATE_BYTES, {
    message: `state buffer excede ${MAX_YJS_STATE_BYTES} bytes`,
  })

const saveSchema = z.object({
  whiteboardId: z.string().min(1),
  state: stateBufferSchema,
})

export type SaveWhiteboardYjsStateInput = {
  whiteboardId: string
  state: Uint8Array
}

// ───────────────────────── Helpers ─────────────────────────

async function loadWhiteboardOrThrow(id: string): Promise<{
  id: string
  projectId: string | null
  isArchived: boolean
}> {
  const wb = await prisma.whiteboard.findUnique({
    where: { id },
    select: { id: true, projectId: true, isArchived: true },
  })
  if (!wb) rtError('R4D_WHITEBOARD_NOT_FOUND', `Pizarra ${id} no existe`)
  return wb
}

// ───────────────────────── Actions ─────────────────────────

export async function saveWhiteboardYjsState(
  input: SaveWhiteboardYjsStateInput,
): Promise<{ ok: true; sizeBytes: number }> {
  const user = await requireUser()
  const parsed = saveSchema.safeParse(input)
  if (!parsed.success) {
    rtError(
      'R4D_INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const data = parsed.data

  const wb = await loadWhiteboardOrThrow(data.whiteboardId)
  if (wb.isArchived) {
    rtError('R4D_FORBIDDEN', 'No se puede editar una pizarra archivada')
  }

  // Validación de integridad: el buffer debe ser un update Yjs aplicable.
  try {
    const probe = new Y.Doc()
    Y.applyUpdate(probe, data.state)
    probe.destroy()
  } catch (e) {
    rtError(
      'R4D_INVALID_INPUT',
      `state Yjs no aplicable: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  // Prisma 7 requiere `Uint8Array<ArrayBuffer>` (no `SharedArrayBuffer`).
  const ab = new ArrayBuffer(data.state.byteLength)
  const yjsBytes = new Uint8Array(ab)
  yjsBytes.set(data.state)

  await prisma.whiteboard.update({
    where: { id: data.whiteboardId },
    data: { stateYjs: yjsBytes },
  })

  await recordAuditEventSafe({
    actorId: user.id,
    action: 'whiteboard.realtime_edit_session',
    entityType: 'whiteboard',
    entityId: data.whiteboardId,
    metadata: {
      projectId: wb.projectId,
      sizeBytes: data.state.byteLength,
    },
  })

  revalidatePath(`/whiteboards/${data.whiteboardId}`)
  return { ok: true, sizeBytes: data.state.byteLength }
}

export async function loadWhiteboardYjsState(
  whiteboardId: string,
): Promise<{ state: Uint8Array | null }> {
  if (!whiteboardId) rtError('R4D_INVALID_INPUT', 'whiteboardId es obligatorio')
  await requireUser()

  const wb = await prisma.whiteboard.findUnique({
    where: { id: whiteboardId },
    select: { id: true, stateYjs: true },
  })
  if (!wb) rtError('R4D_WHITEBOARD_NOT_FOUND', `Pizarra ${whiteboardId} no existe`)

  return {
    state: wb.stateYjs ? new Uint8Array(wb.stateYjs) : null,
  }
}
