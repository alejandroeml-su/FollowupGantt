'use server'

/**
 * Wave P6 · Equipo A3 — Server action que devuelve los comentarios de una
 * tarea ya serializados (`SerializedComment[]`).
 *
 * Existe porque la acción `getCommentsForTask` no estaba implementada en
 * `src/lib/actions.ts` y la consigna prohíbe modificar las acciones de
 * comments existentes. Vivimos dentro del namespace del equipo
 * (`src/lib/realtime-comments/`) por aislamiento.
 */

import prisma from '@/lib/prisma'
import type { SerializedComment } from '@/lib/types'

type CommentRow = {
  id: string
  content: string
  isInternal: boolean | null
  createdAt: Date
  author: { id: string; name: string } | null
}

export async function getCommentsForTask(
  taskId: string,
): Promise<SerializedComment[]> {
  if (!taskId) return []
  const rows = (await prisma.comment.findMany({
    where: { taskId },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  })) as CommentRow[]
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    isInternal: Boolean(r.isInternal),
    createdAt: r.createdAt.toISOString(),
    author: r.author ? { id: r.author.id, name: r.author.name } : null,
  }))
}
