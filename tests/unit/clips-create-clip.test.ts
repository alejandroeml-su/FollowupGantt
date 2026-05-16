import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Wave R4 · US-7.3 — Test del server action `createClip`.
 *
 * Mockeamos:
 *   - `@/lib/prisma` (modelos `task`, `comment`, `clip`).
 *   - `@/lib/auth/check-project-access` (`requireProjectAccess`).
 *   - `@/lib/auth/get-current-user` (`getCurrentUser`).
 *   - `@/lib/storage/clips-storage` (`uploadClipBlob`, `getClipPublicUrl`,
 *     `removeClipObjects`).
 *   - `@/lib/observability/metrics` (`withMetrics` → passthrough).
 *   - `@/lib/audit/events` (`recordAuditEventSafe` → noop).
 *   - `node:crypto` (`randomUUID` determinístico).
 *   - `next/cache` (`revalidatePath` → noop).
 *
 * Cubre los caminos críticos:
 *   - Happy path: task + video + thumbnail.
 *   - XOR violation (ambos null / ambos set).
 *   - Validación de mime/size.
 *   - Task / comment not found.
 *   - Upload failure → cleanup best-effort.
 */

// ─────────────────────────── Mocks ───────────────────────────

const taskFindUnique = vi.fn()
const commentFindUnique = vi.fn()
const clipCreate = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    task: { findUnique: (...args: unknown[]) => taskFindUnique(...args) },
    comment: {
      findUnique: (...args: unknown[]) => commentFindUnique(...args),
    },
    clip: { create: (...args: unknown[]) => clipCreate(...args) },
  },
}))

const requireProjectAccessMock = vi.fn()
vi.mock('@/lib/auth/check-project-access', () => ({
  requireProjectAccess: (...args: unknown[]) =>
    requireProjectAccessMock(...args),
}))

const getCurrentUserMock = vi.fn()
vi.mock('@/lib/auth/get-current-user', () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
}))

const uploadClipBlobMock = vi.fn()
const getClipPublicUrlMock = vi.fn()
const removeClipObjectsMock = vi.fn()
vi.mock('@/lib/storage/clips-storage', () => ({
  uploadClipBlob: (...args: unknown[]) => uploadClipBlobMock(...args),
  getClipPublicUrl: (...args: unknown[]) => getClipPublicUrlMock(...args),
  removeClipObjects: (...args: unknown[]) => removeClipObjectsMock(...args),
}))

vi.mock('@/lib/observability/metrics', () => ({
  withMetrics: async <T,>(_name: string, fn: () => Promise<T>) => fn(),
}))

vi.mock('@/lib/audit/events', () => ({
  recordAuditEventSafe: vi.fn(async () => undefined),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('node:crypto', async () => {
  const actual =
    await vi.importActual<typeof import('node:crypto')>('node:crypto')
  return {
    ...actual,
    randomUUID: () => 'clip-uuid',
  }
})

// ─────────────────────────── Reset ───────────────────────────

const FAKE_NOW = new Date('2026-05-16T10:00:00.000Z')

beforeEach(() => {
  taskFindUnique
    .mockReset()
    .mockResolvedValue({ id: 't1', projectId: 'p1' })
  commentFindUnique.mockReset()
  clipCreate.mockReset().mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: data.id ?? 'clip-uuid',
      taskId: data.taskId ?? null,
      commentId: data.commentId ?? null,
      authorId: data.authorId ?? null,
      storagePath: data.storagePath ?? null,
      thumbnailPath: data.thumbnailPath ?? null,
      durationSec: data.durationSec ?? 0,
      sizeBytes: data.sizeBytes ?? 0,
      mimeType: data.mimeType ?? 'video/webm',
      createdAt: FAKE_NOW,
    }),
  )
  requireProjectAccessMock.mockReset().mockResolvedValue({
    id: 'u1',
    name: 'User',
    email: 'u@x',
    roles: [],
  })
  getCurrentUserMock.mockReset().mockResolvedValue({
    id: 'u1',
    name: 'User',
    email: 'u@x',
    roles: [],
  })
  uploadClipBlobMock.mockReset().mockResolvedValue({ path: 'ok' })
  getClipPublicUrlMock
    .mockReset()
    .mockImplementation((path: string) => `https://cdn.test/${path}`)
  removeClipObjectsMock.mockReset().mockResolvedValue(undefined)
})

// ─────────────────────────── Helpers ───────────────────────────

function makeBlob(content: string, type: string): Blob {
  return new Blob([content], { type })
}

function makeFormData(opts: {
  taskId?: string
  commentId?: string
  video?: Blob | null
  thumbnail?: Blob | null
  durationSec?: string
}): FormData {
  const fd = new FormData()
  if (opts.taskId) fd.set('taskId', opts.taskId)
  if (opts.commentId) fd.set('commentId', opts.commentId)
  if (opts.video) fd.set('video', opts.video)
  if (opts.thumbnail) fd.set('thumbnail', opts.thumbnail)
  if (opts.durationSec !== undefined) fd.set('durationSec', opts.durationSec)
  return fd
}

// ─────────────────────────── Suite ───────────────────────────

describe('createClip', () => {
  it('happy path · sube video + thumbnail y crea row Clip asociado a task', async () => {
    const { createClip } = await import('@/lib/actions/clips')
    const video = makeBlob('hellovideo', 'video/webm')
    const thumb = makeBlob('thumbjpegblob', 'image/jpeg')
    const fd = makeFormData({
      taskId: 't1',
      video,
      thumbnail: thumb,
      durationSec: '42',
    })
    const out = await createClip(fd)
    expect(out.id).toBe('clip-uuid')
    expect(out.taskId).toBe('t1')
    expect(out.commentId).toBeNull()
    expect(out.videoUrl).toMatch(/^https:\/\/cdn.test\/u1\/clip-uuid\/video\.webm$/)
    expect(out.thumbnailUrl).toMatch(/^https:\/\/cdn.test\/u1\/clip-uuid\/thumb\.jpg$/)
    expect(out.durationSec).toBe(42)
    expect(out.mimeType).toBe('video/webm')
    expect(uploadClipBlobMock).toHaveBeenCalledTimes(2)
    expect(clipCreate).toHaveBeenCalledOnce()
  })

  it('rechaza si llegan taskId y commentId simultáneamente con [INVALID_INPUT]', async () => {
    const { createClip } = await import('@/lib/actions/clips')
    const fd = makeFormData({
      taskId: 't1',
      commentId: 'c1',
      video: makeBlob('x', 'video/webm'),
    })
    await expect(createClip(fd)).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('rechaza si NO llega taskId ni commentId con [INVALID_INPUT]', async () => {
    const { createClip } = await import('@/lib/actions/clips')
    const fd = makeFormData({ video: makeBlob('x', 'video/webm') })
    await expect(createClip(fd)).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('rechaza video ausente con [INVALID_CLIP]', async () => {
    const { createClip } = await import('@/lib/actions/clips')
    const fd = makeFormData({ taskId: 't1' })
    await expect(createClip(fd)).rejects.toThrow(/\[INVALID_CLIP\]/)
  })

  it('rechaza mime no permitido con [INVALID_CLIP]', async () => {
    const { createClip } = await import('@/lib/actions/clips')
    const fd = makeFormData({
      taskId: 't1',
      video: makeBlob('x', 'video/avi'),
    })
    await expect(createClip(fd)).rejects.toThrow(/\[INVALID_CLIP\]/)
  })

  it('rechaza clip > cap con [CLIP_TOO_LARGE]', async () => {
    const { createClip } = await import('@/lib/actions/clips')
    // `Blob.size` es read-only en Node 22+ con `Object.defineProperty`
    // simple. Usamos un getter explícito sobre un File real, que sí permite
    // override de la propiedad sin lanzar.
    const big = new File(['x'], 'big.webm', { type: 'video/webm' })
    Object.defineProperty(big, 'size', {
      get: () => 200 * 1024 * 1024,
      configurable: true,
    })
    const fd = makeFormData({ taskId: 't1', video: big })
    await expect(createClip(fd)).rejects.toThrow(/\[CLIP_TOO_LARGE\]/)
  })

  it('rechaza si la task no existe con [TASK_NOT_FOUND]', async () => {
    taskFindUnique.mockResolvedValueOnce(null)
    const { createClip } = await import('@/lib/actions/clips')
    const fd = makeFormData({
      taskId: 'no-existe',
      video: makeBlob('x', 'video/webm'),
    })
    await expect(createClip(fd)).rejects.toThrow(/\[TASK_NOT_FOUND\]/)
  })

  it('asocia a comment correctamente resolviendo projectId vía task del comment', async () => {
    commentFindUnique.mockResolvedValueOnce({
      id: 'c1',
      task: { projectId: 'p1' },
    })
    const { createClip } = await import('@/lib/actions/clips')
    const fd = makeFormData({
      commentId: 'c1',
      video: makeBlob('hellocomment', 'video/webm'),
    })
    const out = await createClip(fd)
    expect(out.commentId).toBe('c1')
    expect(out.taskId).toBeNull()
  })

  it('propaga [FORBIDDEN] de requireProjectAccess', async () => {
    requireProjectAccessMock.mockRejectedValueOnce(
      new Error('[FORBIDDEN] sin acceso'),
    )
    const { createClip } = await import('@/lib/actions/clips')
    const fd = makeFormData({
      taskId: 't1',
      video: makeBlob('x', 'video/webm'),
    })
    await expect(createClip(fd)).rejects.toThrow(/\[FORBIDDEN\]/)
  })

  it('lanza [UNAUTHORIZED] si no hay sesión', async () => {
    getCurrentUserMock.mockResolvedValueOnce(null)
    const { createClip } = await import('@/lib/actions/clips')
    const fd = makeFormData({
      taskId: 't1',
      video: makeBlob('x', 'video/webm'),
    })
    await expect(createClip(fd)).rejects.toThrow(/\[UNAUTHORIZED\]/)
  })

  it('cuando el upload falla, limpia los objetos y lanza [UPLOAD_FAILED]', async () => {
    uploadClipBlobMock.mockRejectedValueOnce(new Error('boom red'))
    const { createClip } = await import('@/lib/actions/clips')
    const fd = makeFormData({
      taskId: 't1',
      video: makeBlob('x', 'video/webm'),
    })
    await expect(createClip(fd)).rejects.toThrow(/\[UPLOAD_FAILED\]/)
    // Cleanup best-effort: como sólo el video se intentó subir y falló,
    // intentamos remover el video (puede no existir, pero el SDK tolera).
    expect(removeClipObjectsMock).toHaveBeenCalled()
    // La fila NO se crea cuando el upload falla.
    expect(clipCreate).not.toHaveBeenCalled()
  })

  it('si el blob de thumbnail está vacío, lo ignora silenciosamente', async () => {
    const { createClip } = await import('@/lib/actions/clips')
    const emptyThumb = new Blob([], { type: 'image/jpeg' })
    const fd = makeFormData({
      taskId: 't1',
      video: makeBlob('x', 'video/webm'),
      thumbnail: emptyThumb,
    })
    const out = await createClip(fd)
    // Sólo el video se subió; thumb se omitió.
    expect(uploadClipBlobMock).toHaveBeenCalledTimes(1)
    expect(out.thumbnailUrl).toBeNull()
  })
})
