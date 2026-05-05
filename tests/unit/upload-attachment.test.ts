import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Wave P8 · Equipo P8-4 — Tests de la server action `uploadAttachmentAction`.
 *
 * Mockeamos:
 *   - `@/lib/prisma` (modelos `task`, `attachment`).
 *   - `@/lib/auth/check-project-access` (`requireProjectAccess`).
 *   - `@/lib/auth/get-current-user` (`getCurrentUser`).
 *   - `@/lib/storage/supabase-storage` (`uploadAttachment` SDK wrapper).
 *   - `node:crypto` (`randomUUID` determinístico).
 *
 * También se ejercitan los helpers `sanitizeFilename` e `isAllowedMime`.
 */

// ─────────────────────────── Mocks ───────────────────────────

const taskFindUnique = vi.fn()
const attachmentCreate = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    task: { findUnique: (...args: unknown[]) => taskFindUnique(...args) },
    attachment: {
      create: (...args: unknown[]) => attachmentCreate(...args),
    },
  },
}))

const requireProjectAccessMock = vi.fn()
vi.mock('@/lib/auth/check-project-access', () => ({
  requireProjectAccess: (...args: unknown[]) => requireProjectAccessMock(...args),
}))

const getCurrentUserMock = vi.fn()
vi.mock('@/lib/auth/get-current-user', () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
}))

const storageUploadMock = vi.fn()
vi.mock('@/lib/storage/supabase-storage', () => ({
  uploadAttachment: (...args: unknown[]) => storageUploadMock(...args),
}))

// Mock de `node:crypto` para que `randomUUID` sea determinístico en tests.
// El módulo bajo test usa `import * as crypto from 'node:crypto'` para que
// vitest pueda reemplazar el binding.
vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto')
  return {
    ...actual,
    randomUUID: () => 'uuid-fixed',
  }
})

// ─────────────────────────── Reset ───────────────────────────

const FAKE_NOW = new Date('2026-05-05T10:00:00.000Z')

beforeEach(() => {
  taskFindUnique
    .mockReset()
    .mockResolvedValue({ id: 't1', projectId: 'p1' })
  attachmentCreate.mockReset().mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'att-1',
      taskId: data.taskId,
      filename: data.filename,
      storagePath: data.storagePath ?? null,
      mimeType: data.mimeType ?? null,
      sizeBytes: data.sizeBytes ?? null,
      uploadedById: data.uploadedById ?? null,
      uploadedAt: FAKE_NOW,
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
  storageUploadMock.mockReset().mockResolvedValue({ path: 'u1/uuid-fixed-foo.png' })
})

// ─────────────────────────── Helper local ───────────────────────────

function makeFormData(taskId: string | null, file: File | null): FormData {
  const fd = new FormData()
  if (taskId !== null) fd.set('taskId', taskId)
  if (file !== null) fd.set('file', file)
  return fd
}

function makeFile(content: string, name: string, type: string): File {
  return new File([content], name, { type })
}

// ─────────────────────────── Helpers tests ───────────────────────────

describe('sanitizeFilename', () => {
  it('preserva nombres simples ASCII', async () => {
    const { sanitizeFilename } = await import('@/lib/storage/upload-attachment')
    expect(sanitizeFilename('foo.png')).toBe('foo.png')
    expect(sanitizeFilename('mi_archivo-1.PDF')).toBe('mi_archivo-1.PDF')
  })

  it('reemplaza espacios y caracteres no seguros con guion bajo', async () => {
    const { sanitizeFilename } = await import('@/lib/storage/upload-attachment')
    expect(sanitizeFilename('Mi documento (final).pdf')).toBe('Mi_documento__final_.pdf')
  })

  it('previene path traversal removiendo segmentos previos', async () => {
    const { sanitizeFilename } = await import('@/lib/storage/upload-attachment')
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFilename('foo\\bar\\baz.txt')).toBe('baz.txt')
  })

  it('falla a archivo.bin si el resultado queda vacío', async () => {
    const { sanitizeFilename } = await import('@/lib/storage/upload-attachment')
    expect(sanitizeFilename('')).toBe('archivo.bin')
    expect(sanitizeFilename('   ')).toBe('archivo.bin')
    expect(sanitizeFilename('...')).toBe('archivo.bin')
  })
})

describe('isAllowedMime', () => {
  it('acepta image/* y text/*', async () => {
    const { isAllowedMime } = await import('@/lib/storage/upload-attachment')
    expect(isAllowedMime('image/png')).toBe(true)
    expect(isAllowedMime('image/jpeg')).toBe(true)
    expect(isAllowedMime('text/csv')).toBe(true)
  })

  it('acepta application/pdf y application/zip', async () => {
    const { isAllowedMime } = await import('@/lib/storage/upload-attachment')
    expect(isAllowedMime('application/pdf')).toBe(true)
    expect(isAllowedMime('application/zip')).toBe(true)
    expect(isAllowedMime('application/x-zip-compressed')).toBe(true)
  })

  it('rechaza application/octet-stream y otros binarios', async () => {
    const { isAllowedMime } = await import('@/lib/storage/upload-attachment')
    expect(isAllowedMime('application/octet-stream')).toBe(false)
    expect(isAllowedMime('application/x-msdownload')).toBe(false)
    expect(isAllowedMime('')).toBe(false)
  })
})

// ─────────────────────────── uploadAttachmentAction ────────────────────

describe('uploadAttachmentAction', () => {
  it('sube archivo válido y crea row Attachment', async () => {
    const { uploadAttachmentAction } = await import('@/lib/storage/upload-attachment')
    const file = makeFile('hello', 'foo.png', 'image/png')
    const fd = makeFormData('t1', file)
    const out = await uploadAttachmentAction(fd)
    expect(out.id).toBe('att-1')
    expect(out.filename).toBe('foo.png')
    expect(out.storagePath).toBe('u1/uuid-fixed-foo.png')
    expect(out.mimeType).toBe('image/png')
    expect(out.sizeBytes).toBe(5)
    expect(out.uploadedById).toBe('u1')
    expect(storageUploadMock).toHaveBeenCalledOnce()
    expect(attachmentCreate).toHaveBeenCalledOnce()
  })

  it('rechaza si falta taskId con [INVALID_INPUT]', async () => {
    const { uploadAttachmentAction } = await import('@/lib/storage/upload-attachment')
    const file = makeFile('x', 'x.png', 'image/png')
    const fd = makeFormData(null, file)
    await expect(uploadAttachmentAction(fd)).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('rechaza cuando el archivo está ausente con [INVALID_FILE]', async () => {
    const { uploadAttachmentAction } = await import('@/lib/storage/upload-attachment')
    const fd = makeFormData('t1', null)
    await expect(uploadAttachmentAction(fd)).rejects.toThrow(/\[INVALID_FILE\]/)
  })

  it('rechaza archivos vacíos con [INVALID_FILE]', async () => {
    const { uploadAttachmentAction } = await import('@/lib/storage/upload-attachment')
    const file = new File([], 'vacio.png', { type: 'image/png' })
    const fd = makeFormData('t1', file)
    await expect(uploadAttachmentAction(fd)).rejects.toThrow(/\[INVALID_FILE\]/)
  })

  it('rechaza mime no permitido con [INVALID_FILE]', async () => {
    const { uploadAttachmentAction } = await import('@/lib/storage/upload-attachment')
    const file = makeFile('x', 'malo.exe', 'application/x-msdownload')
    const fd = makeFormData('t1', file)
    await expect(uploadAttachmentAction(fd)).rejects.toThrow(/\[INVALID_FILE\]/)
  })

  it('rechaza archivos > 25MB con [FILE_TOO_LARGE]', async () => {
    const { uploadAttachmentAction, MAX_FILE_BYTES } = await import(
      '@/lib/storage/upload-attachment'
    )
    // Construye un File "fake" con size > MAX_FILE_BYTES sin alocar memoria real
    const big = new File(['x'], 'big.png', { type: 'image/png' })
    Object.defineProperty(big, 'size', { value: MAX_FILE_BYTES + 1 })
    const fd = new FormData()
    fd.set('taskId', 't1')
    fd.set('file', big)
    await expect(uploadAttachmentAction(fd)).rejects.toThrow(/\[FILE_TOO_LARGE\]/)
  })

  it('rechaza si la task no existe con [TASK_NOT_FOUND]', async () => {
    taskFindUnique.mockResolvedValueOnce(null)
    const { uploadAttachmentAction } = await import('@/lib/storage/upload-attachment')
    const file = makeFile('x', 'x.png', 'image/png')
    const fd = makeFormData('no-existe', file)
    await expect(uploadAttachmentAction(fd)).rejects.toThrow(/\[TASK_NOT_FOUND\]/)
  })

  it('propaga [FORBIDDEN] de requireProjectAccess', async () => {
    requireProjectAccessMock.mockRejectedValueOnce(new Error('[FORBIDDEN] sin acceso'))
    const { uploadAttachmentAction } = await import('@/lib/storage/upload-attachment')
    const file = makeFile('x', 'x.png', 'image/png')
    const fd = makeFormData('t1', file)
    await expect(uploadAttachmentAction(fd)).rejects.toThrow(/\[FORBIDDEN\]/)
  })

  it('lanza [UNAUTHORIZED] si no hay sesión', async () => {
    getCurrentUserMock.mockResolvedValueOnce(null)
    const { uploadAttachmentAction } = await import('@/lib/storage/upload-attachment')
    const file = makeFile('x', 'x.png', 'image/png')
    const fd = makeFormData('t1', file)
    await expect(uploadAttachmentAction(fd)).rejects.toThrow(/\[UNAUTHORIZED\]/)
  })

  it('propaga [UPLOAD_FAILED] cuando el SDK lanza', async () => {
    storageUploadMock.mockRejectedValueOnce(new Error('boom red'))
    const { uploadAttachmentAction } = await import('@/lib/storage/upload-attachment')
    const file = makeFile('x', 'x.png', 'image/png')
    const fd = makeFormData('t1', file)
    await expect(uploadAttachmentAction(fd)).rejects.toThrow(/\[UPLOAD_FAILED\]/)
    // Importante: la fila NO se crea cuando el upload falla.
    expect(attachmentCreate).not.toHaveBeenCalled()
  })

  it('sanitiza el filename con espacios y acentos', async () => {
    const { uploadAttachmentAction } = await import('@/lib/storage/upload-attachment')
    const file = makeFile('x', 'Documento Final ñ.pdf', 'application/pdf')
    const fd = makeFormData('t1', file)
    const out = await uploadAttachmentAction(fd)
    expect(out.filename).toMatch(/\.pdf$/)
    expect(out.filename).not.toContain(' ')
    expect(out.filename).not.toContain('ñ')
    // El path siempre arranca con userId/{uuid}-...
    expect(out.storagePath).toMatch(/^u1\/uuid-fixed-/)
  })

  it('persiste userId legacy junto con uploadedById', async () => {
    const { uploadAttachmentAction } = await import('@/lib/storage/upload-attachment')
    const file = makeFile('x', 'x.png', 'image/png')
    const fd = makeFormData('t1', file)
    await uploadAttachmentAction(fd)
    const callArg = attachmentCreate.mock.calls.at(-1)?.[0] as {
      data: { userId?: string; uploadedById?: string }
    }
    expect(callArg.data.userId).toBe('u1')
    expect(callArg.data.uploadedById).toBe('u1')
  })
})
