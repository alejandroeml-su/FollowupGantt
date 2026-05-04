/**
 * Ola P5 · Equipo P5-5 — Adapter de acciones contra Prisma.
 *
 * Mantiene el motor (`engine.ts`) puro al inyectar este adapter desde el
 * server action `runAutomations`. Cada método ejecuta UNA acción y
 * devuelve el output crudo; los errores se propagan para que el motor los
 * empaquete en `ActionResult.ok=false`.
 *
 * `sendWebhook` usa `fetch` global con AbortController de 8s. No persiste
 * la respuesta — solo el status code en `output`. Un fallo de red lanza.
 */

import 'server-only'
import prisma from '@/lib/prisma'
import type { ActionAdapter } from './engine'

const WEBHOOK_TIMEOUT_MS = 8_000

export const prismaActionAdapter: ActionAdapter = {
  async createTask(action) {
    const task = await prisma.task.create({
      data: {
        title: action.title,
        projectId: action.projectId,
        priority: action.priority ?? 'MEDIUM',
        assigneeId: action.assigneeId ?? null,
      },
      select: { id: true },
    })
    return { taskId: task.id }
  },

  async sendWebhook(action) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), WEBHOOK_TIMEOUT_MS)
    try {
      const res = await fetch(action.url, {
        method: action.method ?? 'POST',
        headers: {
          'content-type': 'application/json',
          ...(action.headers ?? {}),
        },
        body: action.body ? JSON.stringify(action.body) : undefined,
        signal: ctrl.signal,
      })
      return { status: res.status }
    } finally {
      clearTimeout(timer)
    }
  },

  async updateField(action) {
    const data: Record<string, unknown> = {}
    if (action.field === 'progress') {
      data.progress = Number(action.value)
    } else {
      data[action.field] = action.value
    }
    await prisma.task.update({
      where: { id: action.taskId },
      data,
    })
    return { taskId: action.taskId, field: action.field }
  },

  async assignUser(action) {
    await prisma.task.update({
      where: { id: action.taskId },
      data: { assigneeId: action.userId },
    })
    return { taskId: action.taskId, userId: action.userId }
  },
}
