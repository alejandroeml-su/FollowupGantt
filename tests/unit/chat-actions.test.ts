import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * R4 · US-7.2 Chat View — Tests del server action `sendMessage`.
 *
 * Cubrimos:
 *   - Happy path: persiste mensaje, actualiza `lastMessageAt` del canal,
 *     registra audit y revalida la ruta.
 *   - Validación zod: contenido vacío lanza `[INVALID_INPUT]`.
 *   - PARENT_MISMATCH: parent de otro canal lanza `[PARENT_MISMATCH]`.
 *   - FORBIDDEN: si `assertCanViewProject` rechaza, propaga el error.
 *
 * Mockeamos:
 *   - `@/lib/prisma` (chatChannel, chatMessage, $transaction).
 *   - `@/lib/auth/get-current-user` (`requireUser`).
 *   - `@/lib/auth/visibility` (`assertCanViewProject`).
 *   - `@/lib/audit/events` (`recordAuditEventSafe`).
 *   - `@/lib/observability/metrics` (`withMetrics`).
 *   - `@/lib/mentions/parse` y `@/lib/mentions/resolve` (no-op).
 *   - `next/cache` ya mockeado globalmente en `tests/setup.ts`.
 */

// ─────────────────────────── Mocks ───────────────────────────

const channelFindUnique = vi.fn()
const channelUpdate = vi.fn()
const messageCreate = vi.fn()
const messageFindUnique = vi.fn()
const transaction = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    chatChannel: {
      findUnique: (...a: unknown[]) => channelFindUnique(...a),
      update: (...a: unknown[]) => channelUpdate(...a),
    },
    chatMessage: {
      create: (...a: unknown[]) => messageCreate(...a),
      findUnique: (...a: unknown[]) => messageFindUnique(...a),
    },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}))

const requireUserMock = vi.fn()
vi.mock('@/lib/auth/get-current-user', () => ({
  getCurrentUser: (...a: unknown[]) => requireUserMock(...a),
  requireUser: (...a: unknown[]) => requireUserMock(...a),
}))

const assertCanViewProjectMock = vi.fn()
vi.mock('@/lib/auth/visibility', () => ({
  assertCanViewProject: (...a: unknown[]) => assertCanViewProjectMock(...a),
}))

const recordAuditMock = vi.fn()
vi.mock('@/lib/audit/events', () => ({
  recordAuditEventSafe: (...a: unknown[]) => recordAuditMock(...a),
}))

// `withMetrics` simplemente ejecuta el callback en tests.
vi.mock('@/lib/observability/metrics', () => ({
  withMetrics: async (_name: string, fn: () => Promise<unknown>) => fn(),
}))

vi.mock('@/lib/mentions/parse', () => ({
  extractMentions: () => [],
}))

vi.mock('@/lib/mentions/resolve', () => ({
  resolveHandlesToUsers: async () => [],
}))

// ─────────────────────────── Reset ───────────────────────────

beforeEach(() => {
  channelFindUnique.mockReset()
  channelUpdate.mockReset().mockResolvedValue({})
  messageCreate.mockReset()
  messageFindUnique.mockReset()
  transaction.mockReset()
  requireUserMock.mockReset().mockResolvedValue({
    id: 'user-1',
    email: 'edwin@avante.com',
    name: 'Edwin Martinez',
    roles: ['SUPER_ADMIN'],
  })
  assertCanViewProjectMock.mockReset().mockResolvedValue(undefined)
  recordAuditMock.mockReset().mockResolvedValue(undefined)

  // Por defecto, el canal existe.
  channelFindUnique.mockResolvedValue({
    id: 'channel-1',
    projectId: 'project-1',
    name: 'general',
    kind: 'GENERAL',
  })

  // `$transaction` ejecuta el callback con un tx que delega a los mocks.
  transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      chatMessage: {
        create: (...a: unknown[]) => messageCreate(...a),
      },
      chatChannel: {
        update: (...a: unknown[]) => channelUpdate(...a),
      },
    }
    return fn(tx)
  })

  messageCreate.mockResolvedValue({
    id: 'msg-1',
    channelId: 'channel-1',
    authorId: 'user-1',
    content: 'Hola equipo',
    parentMessageId: null,
    createdAt: new Date('2026-05-16T12:00:00.000Z'),
    editedAt: null,
    deletedAt: null,
    author: { id: 'user-1', name: 'Edwin Martinez' },
  })
})

// ─────────────────────────── Tests ───────────────────────────

describe('chat · sendMessage', () => {
  it('persiste mensaje, actualiza canal y registra audit (happy path)', async () => {
    const { sendMessage } = await import('@/lib/actions/chat')
    const created = await sendMessage({
      channelId: 'channel-1',
      content: 'Hola equipo',
    })

    expect(created.id).toBe('msg-1')
    expect(assertCanViewProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      'project-1',
    )
    expect(messageCreate).toHaveBeenCalledTimes(1)
    const createArgs = messageCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>
    }
    expect(createArgs.data.channelId).toBe('channel-1')
    expect(createArgs.data.authorId).toBe('user-1')
    expect(createArgs.data.content).toBe('Hola equipo')
    expect(channelUpdate).toHaveBeenCalledTimes(1)
    // El audit principal `chat.message_sent` siempre se registra.
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'chat.message_sent', entityId: 'msg-1' }),
    )
  })

  it('rechaza contenido vacío con [INVALID_INPUT]', async () => {
    const { sendMessage } = await import('@/lib/actions/chat')
    await expect(
      sendMessage({ channelId: 'channel-1', content: '   ' }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
    expect(messageCreate).not.toHaveBeenCalled()
  })

  it('lanza [CHANNEL_NOT_FOUND] cuando el canal no existe', async () => {
    channelFindUnique.mockResolvedValueOnce(null)
    const { sendMessage } = await import('@/lib/actions/chat')
    await expect(
      sendMessage({ channelId: 'inexistente', content: 'hola' }),
    ).rejects.toThrow(/\[CHANNEL_NOT_FOUND\]/)
  })

  it('lanza [PARENT_MISMATCH] cuando el parent pertenece a otro canal', async () => {
    messageFindUnique.mockResolvedValueOnce({ channelId: 'otro-canal' })
    const { sendMessage } = await import('@/lib/actions/chat')
    await expect(
      sendMessage({
        channelId: 'channel-1',
        content: 'reply',
        parentMessageId: 'msg-fuera',
      }),
    ).rejects.toThrow(/\[PARENT_MISMATCH\]/)
    expect(messageCreate).not.toHaveBeenCalled()
  })

  it('propaga FORBIDDEN cuando el usuario no tiene visibilidad', async () => {
    assertCanViewProjectMock.mockRejectedValueOnce(
      new Error('[FORBIDDEN] sin acceso'),
    )
    const { sendMessage } = await import('@/lib/actions/chat')
    await expect(
      sendMessage({ channelId: 'channel-1', content: 'hola' }),
    ).rejects.toThrow(/\[FORBIDDEN\]/)
    expect(messageCreate).not.toHaveBeenCalled()
  })
})
