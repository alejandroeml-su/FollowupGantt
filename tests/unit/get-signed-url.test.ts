import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Wave P8 · Equipo P8-4 — Tests de la server action `getSignedUrl`.
 */

// ─────────────────────────── Mocks ───────────────────────────

const attachmentFindUnique = vi.fn()
vi.mock('@/lib/prisma', () => ({
  default: {
    attachment: {
      findUnique: (...args: unknown[]) => attachmentFindUnique(...args),
    },
  },
}))

const requireProjectAccessMock = vi.fn()
vi.mock('@/lib/auth/check-project-access', () => ({
  requireProjectAccess: (...args: unknown[]) => requireProjectAccessMock(...args),
}))

const getSignedUrlForMock = vi.fn()
vi.mock('@/lib/storage/supabase-storage', () => ({
  getSignedUrlFor: (...args: unknown[]) => getSignedUrlForMock(...args),
}))

// ─────────────────────────── Reset ───────────────────────────

const FAKE_EXPIRES = new Date('2026-05-05T11:00:00.000Z')

beforeEach(() => {
  attachmentFindUnique.mockReset()
  requireProjectAccessMock.mockReset().mockResolvedValue({
    id: 'u1',
    name: 'User',
    email: 'u@x',
    roles: [],
  })
  getSignedUrlForMock.mockReset().mockResolvedValue({
    signedUrl: 'https://supa.example/storage/v1/object/sign/attachments/u1/uuid-foo.png?token=xyz',
    expiresAt: FAKE_EXPIRES,
  })
})

// ─────────────────────────── Tests ───────────────────────────

describe('getSignedUrl', () => {
  it('retorna URL firmada para attachment con storagePath', async () => {
    attachmentFindUnique.mockResolvedValueOnce({
      id: 'att-1',
      filename: 'foo.png',
      url: null,
      storagePath: 'u1/uuid-foo.png',
      mimeType: 'image/png',
      mimetype: null,
      task: { id: 't1', projectId: 'p1' },
    })
    const { getSignedUrl } = await import('@/lib/storage/get-signed-url')
    const out = await getSignedUrl({ attachmentId: 'att-1' })
    expect(out.signedUrl).toContain('token=xyz')
    expect(out.isLegacy).toBe(false)
    expect(out.mimeType).toBe('image/png')
    expect(out.filename).toBe('foo.png')
    expect(getSignedUrlForMock).toHaveBeenCalledWith('u1/uuid-foo.png', 3600)
  })

  it('respeta `expiresIn` custom', async () => {
    attachmentFindUnique.mockResolvedValueOnce({
      id: 'att-1',
      filename: 'foo.png',
      url: null,
      storagePath: 'u1/uuid-foo.png',
      mimeType: 'image/png',
      mimetype: null,
      task: { id: 't1', projectId: 'p1' },
    })
    const { getSignedUrl } = await import('@/lib/storage/get-signed-url')
    await getSignedUrl({ attachmentId: 'att-1', expiresIn: 600 })
    expect(getSignedUrlForMock).toHaveBeenCalledWith('u1/uuid-foo.png', 600)
  })

  it('rechaza expiresIn fuera de rango con [INVALID_INPUT]', async () => {
    const { getSignedUrl } = await import('@/lib/storage/get-signed-url')
    await expect(
      getSignedUrl({ attachmentId: 'att-1', expiresIn: 5 }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
    await expect(
      getSignedUrl({ attachmentId: 'att-1', expiresIn: 999_999 }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('lanza [ATTACHMENT_NOT_FOUND] si no existe la fila', async () => {
    attachmentFindUnique.mockResolvedValueOnce(null)
    const { getSignedUrl } = await import('@/lib/storage/get-signed-url')
    await expect(getSignedUrl({ attachmentId: 'nope' })).rejects.toThrow(
      /\[ATTACHMENT_NOT_FOUND\]/,
    )
  })

  it('propaga [FORBIDDEN] de requireProjectAccess', async () => {
    attachmentFindUnique.mockResolvedValueOnce({
      id: 'att-1',
      filename: 'foo.png',
      url: null,
      storagePath: 'u1/uuid-foo.png',
      mimeType: 'image/png',
      mimetype: null,
      task: { id: 't1', projectId: 'p1' },
    })
    requireProjectAccessMock.mockRejectedValueOnce(new Error('[FORBIDDEN] sin acceso'))
    const { getSignedUrl } = await import('@/lib/storage/get-signed-url')
    await expect(getSignedUrl({ attachmentId: 'att-1' })).rejects.toThrow(/\[FORBIDDEN\]/)
  })

  it('detecta legacy (url presente, storagePath null) y retorna isLegacy=true', async () => {
    attachmentFindUnique.mockResolvedValueOnce({
      id: 'att-2',
      filename: 'old.png',
      url: 'https://example.com/old.png',
      storagePath: null,
      mimeType: null,
      mimetype: 'image/png',
      task: { id: 't1', projectId: 'p1' },
    })
    const { getSignedUrl } = await import('@/lib/storage/get-signed-url')
    const out = await getSignedUrl({ attachmentId: 'att-2' })
    expect(out.isLegacy).toBe(true)
    expect(out.signedUrl).toBe('https://example.com/old.png')
    // Cae a `mimetype` legacy si `mimeType` nuevo es null.
    expect(out.mimeType).toBe('image/png')
    expect(getSignedUrlForMock).not.toHaveBeenCalled()
  })

  it('lanza [STORAGE_NOT_CONFIGURED] cuando el SDK propaga ese código', async () => {
    attachmentFindUnique.mockResolvedValueOnce({
      id: 'att-3',
      filename: 'foo.png',
      url: null,
      storagePath: 'u1/uuid-foo.png',
      mimeType: 'image/png',
      mimetype: null,
      task: { id: 't1', projectId: 'p1' },
    })
    getSignedUrlForMock.mockRejectedValueOnce(
      new Error('[STORAGE_NOT_CONFIGURED] env missing'),
    )
    const { getSignedUrl } = await import('@/lib/storage/get-signed-url')
    await expect(getSignedUrl({ attachmentId: 'att-3' })).rejects.toThrow(
      /\[STORAGE_NOT_CONFIGURED\]/,
    )
  })

  it('lanza [SIGN_FAILED] cuando el SDK falla por otra causa', async () => {
    attachmentFindUnique.mockResolvedValueOnce({
      id: 'att-4',
      filename: 'foo.png',
      url: null,
      storagePath: 'u1/uuid-foo.png',
      mimeType: 'image/png',
      mimetype: null,
      task: { id: 't1', projectId: 'p1' },
    })
    getSignedUrlForMock.mockRejectedValueOnce(new Error('network down'))
    const { getSignedUrl } = await import('@/lib/storage/get-signed-url')
    await expect(getSignedUrl({ attachmentId: 'att-4' })).rejects.toThrow(/\[SIGN_FAILED\]/)
  })
})
