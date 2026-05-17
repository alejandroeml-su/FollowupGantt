'use server'

/**
 * R4 · US-7.2 Chat View — Server actions del Chat por proyecto.
 *
 * Diferenciación contra `Comment` (que es por-tarea):
 *   - `ChatChannel` = canal de comunicación por proyecto (no por tarea).
 *   - Multiples canales por proyecto (GENERAL/TOPIC/PRIVATE).
 *   - Threading mínimo: reply directo a un mensaje (un solo nivel de indent).
 *   - Reacciones emoji con toggle único `(messageId, userId, emoji)`.
 *
 * Visibilidad:
 *   - Toda lectura/mutación pasa por `assertCanViewProject(user, projectId)`
 *     (centralizado en `lib/auth/visibility.ts`). Un usuario sólo puede
 *     interactuar con canales de proyectos donde tiene `taskWhere` válido.
 *   - Si la visibilidad falla lanzamos `[FORBIDDEN]`. El audit log captura
 *     el intento de acceso (lo hace `assertCanViewProject` internamente).
 *
 * Realtime:
 *   - Los INSERT/UPDATE en `ChatMessage` se publican vía
 *     `supabase_realtime` (ver migración SQL); el hook
 *     `use-chat-channel.ts` se subscribe a `postgres_changes`.
 *   - Typing indicators viajan por `broadcast` (no persisten en BD).
 *
 * Mentions:
 *   - Reutilizamos `extractMentions` + `resolveHandlesToUsers` para
 *     marcar visualmente las menciones. Las notificaciones in-app/email
 *     se difieren a una iteración futura (el helper `notifyMentions`
 *     actual asume `taskId` y necesita ampliarse para mensajes de chat).
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { ChatChannelKind } from '@prisma/client'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'
import { requireUser } from '@/lib/auth/get-current-user'
import { assertCanViewProject } from '@/lib/auth/visibility'
import { withMetrics } from '@/lib/observability/metrics'
import { extractMentions } from '@/lib/mentions/parse'
import { resolveHandlesToUsers } from '@/lib/mentions/resolve'

// ───────────────────────── Errores tipados ─────────────────────────

export type ChatErrorCode =
  | 'INVALID_INPUT'
  | 'CHANNEL_NOT_FOUND'
  | 'MESSAGE_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'FORBIDDEN'
  | 'PARENT_MISMATCH'

function actionError(code: ChatErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Constantes ─────────────────────────

/** Nombre canónico del canal por defecto que se crea en cada proyecto. */
export const DEFAULT_CHANNEL_NAME = 'general'

/**
 * Set canónico de emojis aceptados como reacción. Mantenemos una lista
 * corta para evitar contenido arbitrario y simplificar la UI. Puede
 * extenderse sin migración (es validación de runtime).
 */
export const ALLOWED_REACTION_EMOJIS = [
  '👍',
  '👎',
  '❤️',
  '🎉',
  '🚀',
  '🔥',
  '😄',
  '😢',
  '🙏',
  '👀',
] as const

// ───────────────────────── Schemas ─────────────────────────

const channelKindSchema = z.enum(['GENERAL', 'TOPIC', 'PRIVATE'])

const createChannelSchema = z.object({
  projectId: z.string().min(1, 'projectId es obligatorio'),
  name: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio')
    .max(40)
    // Igual que en Slack: minúsculas, números, guiones, sin espacios.
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Usa minúsculas, números y guiones'),
  kind: channelKindSchema.optional(),
  description: z.string().trim().max(140).optional().nullable(),
})

const sendMessageSchema = z.object({
  channelId: z.string().min(1, 'channelId es obligatorio'),
  content: z.string().trim().min(1, 'El mensaje no puede estar vacío').max(4000),
  parentMessageId: z.string().min(1).optional().nullable(),
})

const editMessageSchema = z.object({
  messageId: z.string().min(1),
  content: z.string().trim().min(1).max(4000),
})

const reactionSchema = z.object({
  messageId: z.string().min(1),
  emoji: z.string().min(1).max(8),
})

// ───────────────────────── Tipos serializados (cliente) ─────────────

export type SerializedChatChannel = {
  id: string
  projectId: string
  name: string
  kind: ChatChannelKind
  description: string | null
  lastMessageAt: string | null
  createdAt: string
}

export type SerializedChatMessageReaction = {
  emoji: string
  userIds: string[]
}

export type SerializedChatMessage = {
  id: string
  channelId: string
  content: string
  parentMessageId: string | null
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
  author: { id: string; name: string } | null
  /** Reacciones agrupadas por emoji con la lista de userIds que la activaron. */
  reactions: SerializedChatMessageReaction[]
  /** Handles resueltos a `User.id` para resaltar menciones en cliente. */
  mentionedUserIds: string[]
}

// ───────────────────────── Helpers internos ─────────────────────────

/** Garantiza que el proyecto existe y que el usuario tiene visibilidad. */
async function assertProjectAccess(projectId: string): Promise<string> {
  const user = await requireUser()
  await assertCanViewProject(user, projectId)
  return user.id
}

/** Carga un canal o lanza `[CHANNEL_NOT_FOUND]`. */
async function loadChannelOrThrow(channelId: string) {
  const channel = await prisma.chatChannel.findUnique({
    where: { id: channelId },
    select: { id: true, projectId: true, name: true, kind: true },
  })
  if (!channel) actionError('CHANNEL_NOT_FOUND', `Canal ${channelId} no existe`)
  return channel
}

/** Revalida las rutas afectadas por una mutación de chat de un proyecto. */
function revalidateChatScopes(projectId: string) {
  revalidatePath(`/chat/${projectId}`)
}

/** Agrupa reacciones por emoji para serialización compacta. */
function groupReactions(
  rows: Array<{ emoji: string; userId: string }>,
): SerializedChatMessageReaction[] {
  const map = new Map<string, Set<string>>()
  for (const r of rows) {
    const set = map.get(r.emoji) ?? new Set<string>()
    set.add(r.userId)
    map.set(r.emoji, set)
  }
  return [...map.entries()].map(([emoji, users]) => ({
    emoji,
    userIds: [...users],
  }))
}

/** Resuelve menciones del contenido a `User.id`s persistidos en BD. */
async function resolveMentionedUserIds(content: string): Promise<string[]> {
  const handles = extractMentions(content)
  if (handles.length === 0) return []
  const explicit = handles.filter((h) => !h.toLowerCase().includes('todos'))
  if (explicit.length === 0) return []
  const matched = await resolveHandlesToUsers(explicit)
  return matched.map((u) => u.id)
}

// ───────────────────────── Public · Listings ─────────────────────────

/**
 * Devuelve los canales visibles del proyecto. Si el proyecto aún no tiene
 * canales, crea el canal `general` por defecto (lazy bootstrap) — esto
 * evita pedirle al usuario crear un canal antes de poder usar el chat.
 *
 * El bootstrap usa `upsert` por la unique `(projectId, name)`, así varios
 * usuarios entrando al mismo tiempo no crean canales duplicados.
 */
export async function listChannels(input: {
  projectId: string
}): Promise<SerializedChatChannel[]> {
  return withMetrics('action.chat.listChannels', async () => {
    const userId = await assertProjectAccess(input.projectId)

    // Bootstrap: si el proyecto no tiene canales aún, crear `general`.
    const existing = await prisma.chatChannel.findFirst({
      where: { projectId: input.projectId },
      select: { id: true },
    })
    if (!existing) {
      try {
        const created = await prisma.chatChannel.upsert({
          where: {
            projectId_name: {
              projectId: input.projectId,
              name: DEFAULT_CHANNEL_NAME,
            },
          },
          create: {
            projectId: input.projectId,
            name: DEFAULT_CHANNEL_NAME,
            kind: 'GENERAL',
            description: 'Canal general del proyecto',
          },
          update: {},
        })
        await recordAuditEventSafe({
          action: 'chat.channel_created',
          entityType: 'chat_channel',
          entityId: created.id,
          actorId: userId,
          metadata: { bootstrap: true, projectId: input.projectId },
        })
      } catch {
        // Race condition · otro request bootstrappeó. Continuamos.
      }
    }

    const rows = await prisma.chatChannel.findMany({
      where: { projectId: input.projectId },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    })

    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      name: r.name,
      kind: r.kind,
      description: r.description,
      lastMessageAt: r.lastMessageAt ? r.lastMessageAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }))
  })
}

/**
 * Devuelve los mensajes de un canal con sus reacciones agrupadas.
 * Limitamos a los últimos `limit` (default 100) ordenados ascending para
 * que el cliente pueda renderizar en el orden natural de conversación.
 *
 * El cliente puede solicitar `before` para paginar hacia atrás (history).
 */
export async function listMessages(input: {
  channelId: string
  limit?: number
  before?: string
}): Promise<SerializedChatMessage[]> {
  return withMetrics('action.chat.listMessages', async () => {
    const channel = await loadChannelOrThrow(input.channelId)
    await assertProjectAccess(channel.projectId)

    const take = Math.min(Math.max(input.limit ?? 100, 1), 200)
    const cursor = input.before
      ? { id: input.before }
      : undefined

    const rows = await prisma.chatMessage.findMany({
      where: { channelId: input.channelId, deletedAt: null },
      include: {
        author: { select: { id: true, name: true } },
        reactions: { select: { emoji: true, userId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { skip: 1, cursor } : {}),
    })

    // Resolvemos menciones por mensaje (en batch). Lookup de usuarios laxo.
    const allHandles = new Set<string>()
    for (const r of rows) {
      for (const h of extractMentions(r.content)) {
        if (!h.toLowerCase().includes('todos')) allHandles.add(h)
      }
    }
    const handleArr = [...allHandles]
    const resolved = handleArr.length
      ? await resolveHandlesToUsers(handleArr)
      : []
    const handleToId = new Map<string, string>()
    for (const u of resolved) {
      handleToId.set((u.email ?? '').toLowerCase(), u.id)
      handleToId.set(
        (u.email ?? '').toLowerCase().split('@')[0] ?? '',
        u.id,
      )
      handleToId.set((u.name ?? '').toLowerCase().trim(), u.id)
      handleToId.set(
        (u.name ?? '').toLowerCase().trim().split(/\s+/)[0] ?? '',
        u.id,
      )
    }

    // Reordenamos a asc para el cliente.
    const asc = [...rows].reverse()
    return asc.map((r) => {
      const mentionedUserIds = new Set<string>()
      for (const h of extractMentions(r.content)) {
        const id = handleToId.get(h.toLowerCase())
        if (id) mentionedUserIds.add(id)
      }
      return {
        id: r.id,
        channelId: r.channelId,
        content: r.content,
        parentMessageId: r.parentMessageId,
        createdAt: r.createdAt.toISOString(),
        editedAt: r.editedAt ? r.editedAt.toISOString() : null,
        deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
        author: r.author ? { id: r.author.id, name: r.author.name } : null,
        reactions: groupReactions(r.reactions),
        mentionedUserIds: [...mentionedUserIds],
      }
    })
  })
}

// ───────────────────────── Public · Channels CRUD ───────────────────

export async function createChannel(input: {
  projectId: string
  name: string
  kind?: ChatChannelKind
  description?: string | null
}) {
  return withMetrics('action.chat.createChannel', async () => {
    const parsed = createChannelSchema.safeParse(input)
    if (!parsed.success) {
      actionError('INVALID_INPUT', parsed.error.issues[0]?.message ?? 'datos inválidos')
    }
    const userId = await assertProjectAccess(parsed.data.projectId)

    // Sólo TOPIC/PRIVATE se pueden crear por UI. GENERAL es exclusivo del
    // bootstrap automático para evitar duplicados confusos.
    const kind = parsed.data.kind ?? 'TOPIC'
    if (kind === 'GENERAL') {
      actionError('INVALID_INPUT', 'No se puede crear un canal GENERAL manualmente')
    }

    try {
      const created = await prisma.chatChannel.create({
        data: {
          projectId: parsed.data.projectId,
          name: parsed.data.name,
          kind,
          description: parsed.data.description ?? null,
        },
      })
      await recordAuditEventSafe({
        action: 'chat.channel_created',
        entityType: 'chat_channel',
        entityId: created.id,
        actorId: userId,
        after: { name: created.name, kind: created.kind },
      })
      revalidateChatScopes(parsed.data.projectId)
      return created
    } catch (err) {
      // Prisma P2002 → unique constraint duplicate name.
      if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
        actionError('INVALID_INPUT', `Ya existe un canal con el nombre "${parsed.data.name}"`)
      }
      throw err
    }
  })
}

// ───────────────────────── Public · Messages CRUD ───────────────────

export async function sendMessage(input: {
  channelId: string
  content: string
  parentMessageId?: string | null
}) {
  return withMetrics('action.chat.sendMessage', async () => {
    const parsed = sendMessageSchema.safeParse(input)
    if (!parsed.success) {
      actionError('INVALID_INPUT', parsed.error.issues[0]?.message ?? 'datos inválidos')
    }
    const channel = await loadChannelOrThrow(parsed.data.channelId)
    const userId = await assertProjectAccess(channel.projectId)

    // Validamos que el parent pertenezca al mismo canal — defensivo
    // contra threading cruzado entre canales/proyectos.
    if (parsed.data.parentMessageId) {
      const parent = await prisma.chatMessage.findUnique({
        where: { id: parsed.data.parentMessageId },
        select: { channelId: true },
      })
      if (!parent || parent.channelId !== parsed.data.channelId) {
        actionError('PARENT_MISMATCH', 'El mensaje padre no pertenece a este canal')
      }
    }

    // Persistimos mensaje + actualizamos `lastMessageAt` del canal en la
    // misma transacción para mantener el snapshot consistente.
    const now = new Date()
    const created = await prisma.$transaction(async (tx) => {
      const msg = await tx.chatMessage.create({
        data: {
          channelId: parsed.data.channelId,
          authorId: userId,
          content: parsed.data.content,
          parentMessageId: parsed.data.parentMessageId ?? null,
        },
        include: {
          author: { select: { id: true, name: true } },
        },
      })
      await tx.chatChannel.update({
        where: { id: parsed.data.channelId },
        data: { lastMessageAt: now },
      })
      return msg
    })

    await recordAuditEventSafe({
      action: 'chat.message_sent',
      entityType: 'chat_message',
      entityId: created.id,
      actorId: userId,
      metadata: {
        channelId: created.channelId,
        projectId: channel.projectId,
        hasParent: Boolean(parsed.data.parentMessageId),
      },
    })

    // Mentions · resolución best-effort (lookup laxo) sólo para
    // observabilidad — la UI ya resalta vía `mentionedUserIds`.
    const mentioned = await resolveMentionedUserIds(parsed.data.content)
    if (mentioned.length > 0) {
      await recordAuditEventSafe({
        action: 'chat.message_sent',
        entityType: 'chat_message',
        entityId: created.id,
        actorId: userId,
        metadata: { mentionedUserIds: mentioned, kind: 'mentions_resolved' },
      })
    }

    revalidateChatScopes(channel.projectId)
    return created
  })
}

export async function editMessage(input: {
  messageId: string
  content: string
}) {
  return withMetrics('action.chat.editMessage', async () => {
    const parsed = editMessageSchema.safeParse(input)
    if (!parsed.success) {
      actionError('INVALID_INPUT', parsed.error.issues[0]?.message ?? 'datos inválidos')
    }
    const msg = await prisma.chatMessage.findUnique({
      where: { id: parsed.data.messageId },
      include: {
        channel: { select: { projectId: true } },
      },
    })
    if (!msg) actionError('MESSAGE_NOT_FOUND', `Mensaje ${parsed.data.messageId} no existe`)
    if (msg.deletedAt) {
      actionError('INVALID_INPUT', 'El mensaje fue eliminado y no puede editarse')
    }
    const userId = await assertProjectAccess(msg.channel.projectId)

    // Sólo el autor puede editar su mensaje.
    if (msg.authorId !== userId) {
      actionError('FORBIDDEN', 'Sólo el autor puede editar su propio mensaje')
    }

    const updated = await prisma.chatMessage.update({
      where: { id: parsed.data.messageId },
      data: { content: parsed.data.content, editedAt: new Date() },
    })

    await recordAuditEventSafe({
      action: 'chat.message_edited',
      entityType: 'chat_message',
      entityId: updated.id,
      actorId: userId,
    })

    revalidateChatScopes(msg.channel.projectId)
    return updated
  })
}

export async function deleteMessage(input: { messageId: string }) {
  return withMetrics('action.chat.deleteMessage', async () => {
    if (!input.messageId) actionError('INVALID_INPUT', 'messageId requerido')
    const msg = await prisma.chatMessage.findUnique({
      where: { id: input.messageId },
      include: { channel: { select: { projectId: true } } },
    })
    if (!msg) actionError('MESSAGE_NOT_FOUND', `Mensaje ${input.messageId} no existe`)
    const userId = await assertProjectAccess(msg.channel.projectId)

    if (msg.authorId !== userId) {
      // En el futuro permitimos a managers del proyecto borrar mensajes;
      // hoy lo restringimos al autor para evitar abusos.
      actionError('FORBIDDEN', 'Sólo el autor puede eliminar su mensaje')
    }

    // Soft-delete · conservamos el row para que las replies no queden
    // huérfanas y la trazabilidad siga existiendo en BD.
    await prisma.chatMessage.update({
      where: { id: input.messageId },
      data: { deletedAt: new Date() },
    })

    await recordAuditEventSafe({
      action: 'chat.message_deleted',
      entityType: 'chat_message',
      entityId: input.messageId,
      actorId: userId,
    })

    revalidateChatScopes(msg.channel.projectId)
    return { ok: true }
  })
}

// ───────────────────────── Public · Reactions ───────────────────────

export async function addReaction(input: {
  messageId: string
  emoji: string
}) {
  return withMetrics('action.chat.addReaction', async () => {
    const parsed = reactionSchema.safeParse(input)
    if (!parsed.success) {
      actionError('INVALID_INPUT', parsed.error.issues[0]?.message ?? 'datos inválidos')
    }
    if (!(ALLOWED_REACTION_EMOJIS as readonly string[]).includes(parsed.data.emoji)) {
      actionError('INVALID_INPUT', 'Emoji no soportado')
    }

    const msg = await prisma.chatMessage.findUnique({
      where: { id: parsed.data.messageId },
      include: { channel: { select: { projectId: true } } },
    })
    if (!msg) actionError('MESSAGE_NOT_FOUND', `Mensaje ${parsed.data.messageId} no existe`)
    const userId = await assertProjectAccess(msg.channel.projectId)

    // Toggle: si la reacción existe, la quitamos; si no, la creamos.
    const existing = await prisma.chatMessageReaction.findUnique({
      where: {
        messageId_userId_emoji: {
          messageId: parsed.data.messageId,
          userId,
          emoji: parsed.data.emoji,
        },
      },
      select: { id: true },
    })

    if (existing) {
      await prisma.chatMessageReaction.delete({ where: { id: existing.id } })
      await recordAuditEventSafe({
        action: 'chat.reaction_removed',
        entityType: 'chat_message',
        entityId: parsed.data.messageId,
        actorId: userId,
        metadata: { emoji: parsed.data.emoji },
      })
      revalidateChatScopes(msg.channel.projectId)
      return { toggled: 'removed' as const }
    }

    await prisma.chatMessageReaction.create({
      data: {
        messageId: parsed.data.messageId,
        userId,
        emoji: parsed.data.emoji,
      },
    })
    await recordAuditEventSafe({
      action: 'chat.reaction_added',
      entityType: 'chat_message',
      entityId: parsed.data.messageId,
      actorId: userId,
      metadata: { emoji: parsed.data.emoji },
    })
    revalidateChatScopes(msg.channel.projectId)
    return { toggled: 'added' as const }
  })
}

/**
 * Variante explícita "quitar reacción" para callers que quieran
 * la semántica no-toggle (ej. botón "X" en la pastilla). Internamente
 * comparte path con `addReaction` para mantener el catálogo de acciones
 * acotado.
 */
export async function removeReaction(input: {
  messageId: string
  emoji: string
}) {
  return withMetrics('action.chat.removeReaction', async () => {
    const parsed = reactionSchema.safeParse(input)
    if (!parsed.success) {
      actionError('INVALID_INPUT', parsed.error.issues[0]?.message ?? 'datos inválidos')
    }
    const msg = await prisma.chatMessage.findUnique({
      where: { id: parsed.data.messageId },
      include: { channel: { select: { projectId: true } } },
    })
    if (!msg) actionError('MESSAGE_NOT_FOUND', `Mensaje ${parsed.data.messageId} no existe`)
    const userId = await assertProjectAccess(msg.channel.projectId)

    await prisma.chatMessageReaction.deleteMany({
      where: {
        messageId: parsed.data.messageId,
        userId,
        emoji: parsed.data.emoji,
      },
    })

    await recordAuditEventSafe({
      action: 'chat.reaction_removed',
      entityType: 'chat_message',
      entityId: parsed.data.messageId,
      actorId: userId,
      metadata: { emoji: parsed.data.emoji },
    })

    revalidateChatScopes(msg.channel.projectId)
    return { ok: true }
  })
}

// ───────────────────────── Public · Search ──────────────────────────

/**
 * Búsqueda básica de mensajes pasados por substring (case-insensitive).
 * Limitado al proyecto del canal solicitado y al rango cubierto por la
 * BD. Para MVP usamos `contains` — si crece la BD migrar a `pg_trgm`.
 */
export async function searchMessages(input: {
  projectId: string
  query: string
  channelId?: string
  limit?: number
}): Promise<SerializedChatMessage[]> {
  return withMetrics('action.chat.searchMessages', async () => {
    await assertProjectAccess(input.projectId)
    const q = input.query.trim()
    if (q.length < 2) return []
    const take = Math.min(Math.max(input.limit ?? 30, 1), 100)

    const rows = await prisma.chatMessage.findMany({
      where: {
        deletedAt: null,
        content: { contains: q, mode: 'insensitive' },
        channel: input.channelId
          ? { id: input.channelId, projectId: input.projectId }
          : { projectId: input.projectId },
      },
      include: {
        author: { select: { id: true, name: true } },
        reactions: { select: { emoji: true, userId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    })

    return rows.map((r) => ({
      id: r.id,
      channelId: r.channelId,
      content: r.content,
      parentMessageId: r.parentMessageId,
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt ? r.editedAt.toISOString() : null,
      deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
      author: r.author ? { id: r.author.id, name: r.author.name } : null,
      reactions: groupReactions(r.reactions),
      mentionedUserIds: [],
    }))
  })
}
