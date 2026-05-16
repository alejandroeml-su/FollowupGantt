import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * R4 · US-7.4 · Email ClickApp — Tests del server action
 * `processInboundEmail`.
 *
 * Mockeamos `@/lib/prisma`, `next/cache.revalidatePath`, el helper
 * de Storage y `recordAuditEventSafe` para validar el flujo sin BD.
 */

const projectFindUnique = vi.fn()
const inboundCreate = vi.fn()
const inboundUpdate = vi.fn()
const userFindUnique = vi.fn()
const taskFindFirst = vi.fn()
const taskCount = vi.fn()
const taskCreate = vi.fn()
const commentCreate = vi.fn()
const attachmentCreate = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    project: { findUnique: (...args: unknown[]) => projectFindUnique(...args) },
    inboundEmail: {
      create: (...args: unknown[]) => inboundCreate(...args),
      update: (...args: unknown[]) => inboundUpdate(...args),
    },
    user: { findUnique: (...args: unknown[]) => userFindUnique(...args) },
    task: {
      findFirst: (...args: unknown[]) => taskFindFirst(...args),
      count: (...args: unknown[]) => taskCount(...args),
      create: (...args: unknown[]) => taskCreate(...args),
    },
    comment: { create: (...args: unknown[]) => commentCreate(...args) },
    attachment: { create: (...args: unknown[]) => attachmentCreate(...args) },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/audit/events', () => ({
  recordAuditEventSafe: vi.fn(async () => {}),
}))

vi.mock('@/lib/storage/supabase-storage', () => ({
  uploadAttachment: vi.fn(async () => ({ path: 'mocked/path' })),
}))

beforeEach(() => {
  projectFindUnique.mockReset()
  inboundCreate.mockReset()
  inboundUpdate.mockReset()
  userFindUnique.mockReset()
  taskFindFirst.mockReset()
  taskCount.mockReset()
  taskCreate.mockReset()
  commentCreate.mockReset()
  attachmentCreate.mockReset()

  inboundCreate.mockImplementation(async () => ({ id: 'inbound-1' }))
  inboundUpdate.mockImplementation(async () => ({}))
})

describe('processInboundEmail', () => {
  it('crea tarea nueva cuando el subject no incluye mnemonic', async () => {
    projectFindUnique.mockResolvedValue({
      id: 'proj-1',
      name: 'Mi Proyecto Bueno',
      workspaceId: 'ws-1',
    })
    userFindUnique.mockResolvedValue(null) // remitente guest
    taskCount.mockResolvedValue(0)
    taskCreate.mockResolvedValue({ id: 'task-new-1' })

    const { processInboundEmail } = await import(
      '@/lib/actions/inbound-email'
    )
    const result = await processInboundEmail({
      toAlias: 'inbox+mipro@sync.complejoavante.com',
      toSlug: 'mipro',
      from: { email: 'guest@external.com', name: 'Guest Person' },
      subject: 'algo nuevo',
      mnemonic: null,
      cleanSubject: 'algo nuevo',
      bodyText: 'contenido',
      bodyHtml: null,
      spamScore: 0.1,
      rawHeaders: null,
      attachments: [],
    })

    expect(result.status).toBe('PROCESSED')
    expect(result.taskId).toBe('task-new-1')
    expect(result.commentId).toBeNull()
    expect(commentCreate).not.toHaveBeenCalled()

    // Validamos que el title viene del cleanSubject y que el body lleva el
    // prefijo `(De: ...)` por ser guest.
    const taskCreateArg = taskCreate.mock.calls[0][0] as {
      data: { title: string; description: string; mnemonic: string }
    }
    expect(taskCreateArg.data.title).toBe('algo nuevo')
    expect(taskCreateArg.data.description).toContain('guest@external.com')
    expect(taskCreateArg.data.mnemonic).toMatch(/-1$/)
  })

  it('agrega comentario sobre task existente cuando el subject trae mnemonic', async () => {
    projectFindUnique.mockResolvedValue({
      id: 'proj-1',
      name: 'P',
      workspaceId: 'ws-1',
    })
    userFindUnique.mockResolvedValue({ id: 'user-7', name: 'Edwin' })
    taskFindFirst.mockResolvedValue({ id: 'task-existing' })
    commentCreate.mockResolvedValue({ id: 'comment-new' })

    const { processInboundEmail } = await import(
      '@/lib/actions/inbound-email'
    )
    const result = await processInboundEmail({
      toAlias: 'inbox+p@sync.complejoavante.com',
      toSlug: 'p',
      from: { email: 'edwin@example.com', name: 'Edwin' },
      subject: 'avance [#PROJ-9]',
      mnemonic: 'PROJ-9',
      cleanSubject: 'avance',
      bodyText: 'aquí va mi update',
      bodyHtml: null,
      spamScore: null,
      rawHeaders: null,
      attachments: [],
    })

    expect(result.status).toBe('PROCESSED')
    expect(result.taskId).toBe('task-existing')
    expect(result.commentId).toBe('comment-new')
    expect(taskCreate).not.toHaveBeenCalled()
    expect(commentCreate).toHaveBeenCalledOnce()

    // El comentario NO debe llevar prefijo "De:" porque matcheó User.
    const commentArg = commentCreate.mock.calls[0][0] as {
      data: { content: string; authorId: string | null }
    }
    expect(commentArg.data.authorId).toBe('user-7')
    expect(commentArg.data.content).not.toContain('De: ')
  })

  it('rechaza el email cuando el proyecto no existe (alias inválido)', async () => {
    projectFindUnique.mockResolvedValue(null)

    const { processInboundEmail } = await import(
      '@/lib/actions/inbound-email'
    )
    const result = await processInboundEmail({
      toAlias: 'inbox+ghost@sync.complejoavante.com',
      toSlug: 'ghost',
      from: { email: 'ed@x.com', name: null },
      subject: 'x',
      mnemonic: null,
      cleanSubject: 'x',
      bodyText: 'y',
      bodyHtml: null,
      spamScore: null,
      rawHeaders: null,
      attachments: [],
    })

    expect(result.status).toBe('FAILED')
    expect(result.errorCode).toBe('PROJECT_NOT_FOUND')
    expect(inboundCreate).not.toHaveBeenCalled() // sin FK no podemos persistir
  })

  it('rechaza por spam cuando score > 5', async () => {
    projectFindUnique.mockResolvedValue({
      id: 'proj-1',
      name: 'P',
      workspaceId: null,
    })

    const { processInboundEmail } = await import(
      '@/lib/actions/inbound-email'
    )
    const result = await processInboundEmail({
      toAlias: 'inbox+p@sync.complejoavante.com',
      toSlug: 'p',
      from: { email: 'spam@spammer.io', name: null },
      subject: 'OFERTA INCREÍBLE',
      mnemonic: null,
      cleanSubject: 'OFERTA INCREÍBLE',
      bodyText: 'click here',
      bodyHtml: null,
      spamScore: 8.5,
      rawHeaders: null,
      attachments: [],
    })

    expect(result.status).toBe('FAILED')
    expect(result.errorCode).toBe('SPAM_REJECTED')
    expect(taskCreate).not.toHaveBeenCalled()
    expect(commentCreate).not.toHaveBeenCalled()
  })
})
