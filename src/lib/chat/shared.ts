/**
 * R4 · US-7.2 Chat View — Constantes y tipos serializados compartidos
 * entre server actions y componentes cliente.
 *
 * Existe como módulo separado de `lib/actions/chat.ts` porque
 * Next.js 16 prohíbe que un archivo con `'use server'` exporte valores
 * runtime (constantes) o tipos: sólo se permiten async functions. Si
 * vuelves a colocar estas constantes dentro del archivo de actions el
 * build de Vercel romperá con "module has no exports".
 */

import type { ChatChannelKind } from '@prisma/client'

// ───────────────────────── Errores tipados ─────────────────────────

export type ChatErrorCode =
  | 'INVALID_INPUT'
  | 'CHANNEL_NOT_FOUND'
  | 'MESSAGE_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'FORBIDDEN'
  | 'PARENT_MISMATCH'

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
