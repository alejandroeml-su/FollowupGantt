import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * US-7.5 · Proofing — tests del server action `createAnnotation` y vecinos.
 *
 * Mockeamos:
 *   - `@/lib/prisma` (attachment, proofingAnnotation).
 *   - `@/lib/auth/check-project-access` (requireProjectAccess resuelve OK).
 *   - `@/lib/audit/events` (recordAuditEventSafe no-op).
 *   - `@/lib/actions/notifications` (createNotification no-op).
 *   - `next/cache` globalmente desde tests/setup.
 */

// ─────────────────────────── Mocks ───────────────────────────

const attachmentFindUnique = vi.fn()
const annotationFindUnique = vi.fn()
const annotationFindMany = vi.fn()
const annotationCreate = vi.fn()
const annotationUpdate = vi.fn()
const annotationDelete = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    attachment: {
      findUnique: (...args: unknown[]) => attachmentFindUnique(...args),
    },
    proofingAnnotation: {
      findUnique: (...args: unknown[]) => annotationFindUnique(...args),
      findMany: (...args: unknown[]) => annotationFindMany(...args),
      create: (...args: unknown[]) => annotationCreate(...args),
      update: (...args: unknown[]) => annotationUpdate(...args),
      delete: (...args: unknown[]) => annotationDelete(...args),
    },
    attachmentVersion: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

const requireProjectAccessMock = vi.fn()
vi.mock('@/lib/auth/check-project-access', () => ({
  requireProjectAccess: (...args: unknown[]) =>
    requireProjectAccessMock(...args),
}))

const recordAuditEventSafeMock = vi.fn()
vi.mock('@/lib/audit/events', () => ({
  recordAuditEventSafe: (...args: unknown[]) =>
    recordAuditEventSafeMock(...args),
}))

const createNotificationMock = vi.fn()
vi.mock('@/lib/actions/notifications', () => ({
  createNotification: (...args: unknown[]) => createNotificationMock(...args),
}))

// ─────────────────────────── Fixtures ───────────────────────────

const FAKE_NOW = new Date('2026-05-16T10:00:00.000Z')
const ATTACHMENT_ROW = {
  id: 'att1',
  filename: 'mockup.png',
  uploadedById: 'u-uploader',
  userId: 'u-uploader',
  task: { id: 't1', projectId: 'p1' },
}
const ANNOTATION_BASE = {
  id: 'ann1',
  attachmentId: 'att1',
  attachmentVersionId: null,
  x: 0.5,
  y: 0.5,
  pageNumber: null,
  text: 'Comentario demo',
  status: 'OPEN' as const,
  parentAnnotationId: null,
  authorId: 'u-actor',
  resolvedAt: null,
  resolvedById: null,
  createdAt: FAKE_NOW,
  updatedAt: FAKE_NOW,
  author: { id: 'u-actor', name: 'Actor' },
  resolvedBy: null,
}

beforeEach(() => {
  attachmentFindUnique.mockReset().mockResolvedValue(ATTACHMENT_ROW)
  annotationFindUnique.mockReset().mockResolvedValue(null)
  annotationFindMany.mockReset().mockResolvedValue([])
  annotationCreate.mockReset().mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      ...ANNOTATION_BASE,
      ...data,
      author: ANNOTATION_BASE.author,
      resolvedBy: null,
    }),
  )
  annotationUpdate.mockReset().mockImplementation(
    async ({
      where,
      data,
    }: {
      where: { id: string }
      data: Record<string, unknown>
    }) => ({
      ...ANNOTATION_BASE,
      id: where.id,
      ...data,
      author: ANNOTATION_BASE.author,
      resolvedBy: null,
    }),
  )
  annotationDelete.mockReset().mockResolvedValue({ id: 'ann1' })
  requireProjectAccessMock
    .mockReset()
    .mockResolvedValue({ id: 'u-actor', name: 'Actor', email: 'a@x', roles: [] })
  recordAuditEventSafeMock.mockReset().mockResolvedValue(undefined)
  createNotificationMock.mockReset().mockResolvedValue(undefined)
})

// ─────────────────────────── Tests ───────────────────────────

describe('createAnnotation', () => {
  it('persiste anotación con coordenadas normalizadas y status OPEN', async () => {
    const { createAnnotation } = await import('@/lib/actions/proofing')
    const out = await createAnnotation({
      attachmentId: 'att1',
      x: 0.42,
      y: 0.13,
      text: 'Cambiar color del botón',
    })

    expect(out).toMatchObject({
      attachmentId: 'att1',
      x: 0.42,
      y: 0.13,
      status: 'OPEN',
    })

    const arg = annotationCreate.mock.calls.at(-1)?.[0] as {
      data: { x: number; y: number; status: string; authorId: string }
    }
    expect(arg.data.x).toBeCloseTo(0.42)
    expect(arg.data.y).toBeCloseTo(0.13)
    expect(arg.data.status).toBe('OPEN')
    expect(arg.data.authorId).toBe('u-actor')

    // Audit event fue emitido.
    expect(recordAuditEventSafeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'proofing.annotation_created',
        entityType: 'proofing_annotation',
      }),
    )
  })

  it('notifica al uploader cuando un tercero comenta', async () => {
    const { createAnnotation } = await import('@/lib/actions/proofing')
    await createAnnotation({
      attachmentId: 'att1',
      x: 0.5,
      y: 0.5,
      text: 'Nuevo comentario',
    })

    expect(createNotificationMock).toHaveBeenCalledTimes(1)
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-uploader',
        title: expect.stringContaining('mockup.png'),
      }),
    )
  })

  it('NO se autonotifica cuando el uploader comenta su propio archivo', async () => {
    requireProjectAccessMock.mockResolvedValueOnce({
      id: 'u-uploader', // mismo que el uploader
      name: 'Uploader',
      email: 'u@x',
      roles: [],
    })
    const { createAnnotation } = await import('@/lib/actions/proofing')
    await createAnnotation({
      attachmentId: 'att1',
      x: 0.1,
      y: 0.1,
      text: 'Self comment',
    })
    expect(createNotificationMock).not.toHaveBeenCalled()
  })

  it('rechaza coordenadas fuera de [0..1] como [INVALID_INPUT]', async () => {
    const { createAnnotation } = await import('@/lib/actions/proofing')
    await expect(
      createAnnotation({
        attachmentId: 'att1',
        x: 1.2,
        y: 0.5,
        text: 'fuera',
      }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
    await expect(
      createAnnotation({
        attachmentId: 'att1',
        x: 0.5,
        y: -0.1,
        text: 'negativa',
      }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('rechaza texto vacío como [INVALID_INPUT]', async () => {
    const { createAnnotation } = await import('@/lib/actions/proofing')
    await expect(
      createAnnotation({
        attachmentId: 'att1',
        x: 0.5,
        y: 0.5,
        text: '',
      }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('lanza [ATTACHMENT_NOT_FOUND] cuando el attachment no existe', async () => {
    attachmentFindUnique.mockResolvedValueOnce(null)
    const { createAnnotation } = await import('@/lib/actions/proofing')
    await expect(
      createAnnotation({
        attachmentId: 'no-existe',
        x: 0.5,
        y: 0.5,
        text: 'demo',
      }),
    ).rejects.toThrow(/\[ATTACHMENT_NOT_FOUND\]/)
  })

  it('valida que parent pertenezca al mismo attachment ([PARENT_MISMATCH])', async () => {
    annotationFindUnique.mockResolvedValueOnce({
      id: 'parent-1',
      attachmentId: 'OTHER',
    })
    const { createAnnotation } = await import('@/lib/actions/proofing')
    await expect(
      createAnnotation({
        attachmentId: 'att1',
        x: 0.5,
        y: 0.5,
        text: 'reply',
        parentAnnotationId: 'parent-1',
      }),
    ).rejects.toThrow(/\[PARENT_MISMATCH\]/)
  })

  it('emite audit event "annotation_replied" cuando hay parentId', async () => {
    annotationFindUnique.mockResolvedValueOnce({
      id: 'parent-1',
      attachmentId: 'att1',
    })
    const { createAnnotation } = await import('@/lib/actions/proofing')
    await createAnnotation({
      attachmentId: 'att1',
      x: 0.5,
      y: 0.5,
      text: 'reply',
      parentAnnotationId: 'parent-1',
    })
    expect(recordAuditEventSafeMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'proofing.annotation_replied' }),
    )
  })
})

describe('updateAnnotationStatus', () => {
  beforeEach(() => {
    annotationFindUnique.mockResolvedValue({
      id: 'ann1',
      status: 'OPEN',
      attachmentId: 'att1',
      attachment: { task: { id: 't1', projectId: 'p1' } },
    })
  })

  it('marcar como RESOLVED setea resolvedAt y emite audit "_resolved"', async () => {
    const { updateAnnotationStatus } = await import(
      '@/lib/actions/proofing'
    )
    const out = await updateAnnotationStatus({
      annotationId: 'ann1',
      status: 'RESOLVED',
    })

    const arg = annotationUpdate.mock.calls.at(-1)?.[0] as {
      data: { resolvedAt: Date | null; resolvedById: string | null }
    }
    expect(arg.data.resolvedAt).toBeInstanceOf(Date)
    expect(arg.data.resolvedById).toBe('u-actor')

    expect(recordAuditEventSafeMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'proofing.annotation_resolved' }),
    )
    expect(out.status).toBe('RESOLVED')
  })

  it('reabrir limpia resolvedAt/resolvedById y emite audit "_reopened"', async () => {
    annotationFindUnique.mockResolvedValueOnce({
      id: 'ann1',
      status: 'RESOLVED',
      attachmentId: 'att1',
      attachment: { task: { id: 't1', projectId: 'p1' } },
    })
    const { updateAnnotationStatus } = await import(
      '@/lib/actions/proofing'
    )
    await updateAnnotationStatus({ annotationId: 'ann1', status: 'OPEN' })

    const arg = annotationUpdate.mock.calls.at(-1)?.[0] as {
      data: { resolvedAt: Date | null; resolvedById: string | null }
    }
    expect(arg.data.resolvedAt).toBeNull()
    expect(arg.data.resolvedById).toBeNull()

    expect(recordAuditEventSafeMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'proofing.annotation_reopened' }),
    )
  })

  it('lanza [ANNOTATION_NOT_FOUND] si no existe la anotación', async () => {
    annotationFindUnique.mockResolvedValueOnce(null)
    const { updateAnnotationStatus } = await import(
      '@/lib/actions/proofing'
    )
    await expect(
      updateAnnotationStatus({
        annotationId: 'fantasma',
        status: 'RESOLVED',
      }),
    ).rejects.toThrow(/\[ANNOTATION_NOT_FOUND\]/)
  })
})
