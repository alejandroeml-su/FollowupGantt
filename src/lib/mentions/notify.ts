/**
 * Helper server-side para detectar menciones en texto libre y disparar
 * notificaciones in-app + email a los usuarios mencionados.
 *
 * Reutiliza el mismo patrón que `createComment` (lib/actions.ts) pero
 * extraído para poder llamarlo desde:
 *   - `updateTask` (Task.description, Task.title)
 *   - `createComment` / `updateComment`
 *   - Cualquier otro flujo futuro (Doc, Whiteboard sticky, etc.)
 *
 * Diseño:
 *   - Pure server (importa prisma, after, sendMentionNotification).
 *   - Idempotente: si la notificación falla, loggea y continúa (no rompe
 *     la mutación que la disparó).
 *   - Respeta `NotificationPreference.emailMentions` por destinatario.
 *   - Excluye al autor del comentario/edit de las notifs.
 *   - Soporta `@todos` como broadcast a assignee + colaboradores del task.
 */

import { after } from 'next/server'
import prisma from '@/lib/prisma'
import { sendMentionNotification } from '@/lib/email/mention-notification'
import { createNotificationsBatch } from '@/lib/actions/notifications'
import { extractMentions, isBroadcastHandle } from './parse'

type ResolvedUser = { id: string; email: string; name: string }

export type MentionNotificationContext = {
  /** Texto donde se buscarán menciones. */
  text: string | null | undefined
  /** Si se está editando (no creando), pasar el texto previo para detectar
   * SOLO menciones nuevas. Si se omite, todas las menciones se notifican. */
  previousText?: string | null | undefined
  /** Task contexto — debe existir, se usa para email subject + collaborators. */
  taskId: string
  /** Quien hizo el cambio. Se excluye de los destinatarios. */
  authorId: string | null | undefined
  /**
   * Origen del texto, sólo para el subject del email/in-app.
   *   - 'comment'     → "te mencionó en un comentario de…"
   *   - 'description' → "te mencionó en la descripción de…"
   *   - 'title'       → "te mencionó en el título de…"
   */
  source: 'comment' | 'description' | 'title'
  /** Si es comentario, contenido completo (para email body). */
  commentContent?: string
  /** Si es comentario interno (`isInternal=true`). */
  isInternal?: boolean
}

/**
 * Procesa menciones del texto y dispara notificaciones in-app + email.
 * No-op silencioso si:
 *   - No hay texto.
 *   - No hay menciones.
 *   - Las menciones son sólo el autor.
 *   - El task no existe.
 *
 * @returns número de destinatarios notificados (best-effort, antes de
 *   despachar). Útil para tests; producción no lo usa.
 */
export async function notifyMentions(
  ctx: MentionNotificationContext,
): Promise<number> {
  // Diff: si hay texto previo, sólo notificar las menciones NUEVAS para
  // evitar re-notificar a alguien que ya estaba mencionado en el original.
  const newHandles = ctx.previousText !== undefined
    ? diffHandles(ctx.previousText, ctx.text)
    : extractMentions(ctx.text)

  if (newHandles.length === 0) return 0

  const broadcastAll = newHandles.some(isBroadcastHandle)
  const explicitHandles = newHandles.filter((h) => !isBroadcastHandle(h))

  const [mentionedUsers, task, author] = await Promise.all([
    explicitHandles.length > 0
      ? prisma.user.findMany({
          where: {
            OR: [
              { email: { in: explicitHandles } },
              { name: { in: explicitHandles } },
            ],
          },
          select: { id: true, email: true, name: true },
        })
      : Promise.resolve([] as ResolvedUser[]),
    prisma.task.findUnique({
      where: { id: ctx.taskId },
      select: {
        title: true,
        mnemonic: true,
        assigneeId: true,
        parent: { select: { title: true } },
        collaborators: { select: { userId: true } },
      },
    }),
    ctx.authorId
      ? prisma.user.findUnique({
          where: { id: ctx.authorId },
          select: { name: true },
        })
      : Promise.resolve(null),
  ])

  if (!task) return 0

  // Resolución de destinatarios (replica patrón createComment):
  //   1. Menciones explícitas resueltas a User.id.
  //   2. Si hay @todos → suma assignee + colaboradores.
  //   3. Dedupe + excluye al autor.
  const recipientIds = new Set<string>()
  for (const u of mentionedUsers) recipientIds.add(u.id)
  if (broadcastAll) {
    if (task.assigneeId) recipientIds.add(task.assigneeId)
    for (const c of task.collaborators) recipientIds.add(c.userId)
  }
  if (ctx.authorId) recipientIds.delete(ctx.authorId)

  if (recipientIds.size === 0) return 0

  // Cargar shape mínimo para el email — `mentionedUsers` ya tiene los
  // explícitos, `@todos` puede aportar nuevos que requieren round-trip.
  const knownById = new Map(mentionedUsers.map((u) => [u.id, u]))
  const missingIds = [...recipientIds].filter((id) => !knownById.has(id))
  const extra: ResolvedUser[] = missingIds.length
    ? await prisma.user.findMany({
        where: { id: { in: missingIds } },
        select: { id: true, email: true, name: true },
      })
    : []

  const recipients: ResolvedUser[] = [...recipientIds]
    .map((id) => knownById.get(id) ?? extra.find((u) => u.id === id))
    .filter((u): u is ResolvedUser => Boolean(u))

  const authorName = author?.name ?? 'Un colaborador'
  const parentTitle = task.parent?.title ?? null
  const mnemonicPrefix = task.mnemonic ? `[${task.mnemonic}] ` : ''
  const sourceLabel = sourceLabelEs(ctx.source)
  const inAppTitle = `${authorName} te mencionó en ${sourceLabel} de ${mnemonicPrefix}${task.title}`
  const bodyText = ctx.commentContent ?? ctx.text ?? ''
  const inAppBody = bodyText.length > 280 ? `${bodyText.slice(0, 277)}...` : bodyText
  const inAppLink = `/list?taskId=${encodeURIComponent(ctx.taskId)}`

  // Despachar después de la respuesta para no bloquear la mutación.
  after(async () => {
    // Email — respeta opt-out por usuario.
    try {
      const prefs = await prisma.notificationPreference.findMany({
        where: { userId: { in: recipients.map((r) => r.id) } },
        select: { userId: true, emailMentions: true },
      })
      const optedOut = new Set(
        prefs.filter((p) => !p.emailMentions).map((p) => p.userId),
      )
      await Promise.all(
        recipients
          .filter((u) => !optedOut.has(u.id))
          .map((user) =>
            sendMentionNotification({
              to: user.email,
              recipientName: user.name,
              authorName,
              taskTitle: task.title,
              taskMnemonic: task.mnemonic,
              commentContent: ctx.commentContent ?? ctx.text ?? '',
              taskId: ctx.taskId,
              parentTaskTitle: parentTitle,
              isInternal: ctx.isInternal ?? false,
            }),
          ),
      )
    } catch (err) {
      console.error('[mentions] email batch falló', err)
    }

    // In-app — siempre (toleramos fallos aislados).
    try {
      await createNotificationsBatch(
        recipients.map((user) => ({
          userId: user.id,
          type: 'MENTION' as const,
          title: inAppTitle,
          body: inAppBody,
          link: inAppLink,
          data: {
            taskId: ctx.taskId,
            taskMnemonic: task.mnemonic ?? null,
            authorName,
            source: ctx.source,
            isInternal: ctx.isInternal ?? false,
          },
        })),
      )
    } catch (err) {
      console.error('[mentions] in-app batch falló', err)
    }
  })

  return recipients.length
}

function diffHandles(
  oldText: string | null | undefined,
  newText: string | null | undefined,
): string[] {
  const oldSet = new Set(extractMentions(oldText))
  return extractMentions(newText).filter((h) => !oldSet.has(h))
}

function sourceLabelEs(source: MentionNotificationContext['source']): string {
  switch (source) {
    case 'comment':
      return 'un comentario'
    case 'description':
      return 'la descripción'
    case 'title':
      return 'el título'
  }
}
