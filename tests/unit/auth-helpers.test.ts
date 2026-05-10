import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Ola P1 · Tests unitarios de helpers Auth/RBAC.
 *
 * Wave P13 (RBAC visibilidad) refactorizó el guard `requireProjectAccess`
 * para delegar en `assertCanViewProject` (de `@/lib/auth/visibility`),
 * que aplica la matriz jerárquica USER < GERENTE_AREA < GERENCIA_GENERAL
 * < ADMIN < SUPER_ADMIN consultando `prisma.project.findFirst` con un
 * `where` filtrado por rol.
 *
 * Cobertura (8 casos):
 *
 *   requireProjectAccess:
 *    1. Sin sesión → [UNAUTHORIZED].
 *    2. Sin acceso visible → [FORBIDDEN] + audit log.
 *    3. Usuario USER con assignment visible → ok.
 *    4. ADMIN sin assignment → ok (filtro {} = global).
 *    5. SUPER_ADMIN sin assignment → ok.
 *    6. projectId vacío → [FORBIDDEN] sin tocar BD ni sesión.
 *
 *   password (verifyPassword/hashPassword):
 *    7. Hash + verify del mismo password → true.
 *    8. Verify con password incorrecto → false.
 *
 * Estrategia:
 *   - Mockeamos `@/lib/prisma` con `project.findFirst` y `projectAssignment.findUnique`.
 *   - Mockeamos `@/lib/auth/get-current-user` y `@/lib/audit/events` para
 *     no tocar BD ni cookies.
 *   - El test de password usa el módulo real (PBKDF2 nativo Node).
 */

// ─── Mocks ────────────────────────────────────────────────────────

const findFirstProject = vi.fn()
const findUniqueProjectAssignment = vi.fn()
const recordAuditEventSafeMock = vi.fn()
const getCurrentUserMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    project: {
      findFirst: (...args: unknown[]) => findFirstProject(...args),
    },
    projectAssignment: {
      findUnique: (...args: unknown[]) => findUniqueProjectAssignment(...args),
    },
  },
}))

vi.mock('@/lib/auth/get-current-user', () => ({
  getCurrentUser: () => getCurrentUserMock(),
  requireUser: async () => {
    const u = getCurrentUserMock()
    if (!u) throw new Error('[UNAUTHORIZED] Sesión requerida')
    return u
  },
}))

vi.mock('@/lib/audit/events', () => ({
  recordAuditEventSafe: (...args: unknown[]) => recordAuditEventSafeMock(...args),
}))

// `server-only` se importa desde varios archivos auth — vitest necesita
// stub porque marca import side-effects que rompen el render.
vi.mock('server-only', () => ({}))

// ─── SUTs ─────────────────────────────────────────────────────────

import { requireProjectAccess } from '@/lib/auth/check-project-access'
import { hashPassword, verifyPassword } from '@/lib/auth/password'

beforeEach(() => {
  findFirstProject.mockReset()
  findUniqueProjectAssignment.mockReset()
  recordAuditEventSafeMock.mockReset()
  getCurrentUserMock.mockReset()
})

describe('requireProjectAccess', () => {
  it('1. lanza [UNAUTHORIZED] cuando no hay sesión', async () => {
    getCurrentUserMock.mockReturnValue(null)
    await expect(requireProjectAccess('p1')).rejects.toThrow(
      /\[UNAUTHORIZED\]/,
    )
  })

  it('2. lanza [FORBIDDEN] cuando user no es admin y no tiene visibilidad', async () => {
    getCurrentUserMock.mockReturnValue({
      id: 'u1',
      email: 'a@b.c',
      name: 'User',
      roles: ['USER'],
      gerenciaId: null,
      workspaceId: 'w1',
    })
    findFirstProject.mockResolvedValue(null)
    await expect(requireProjectAccess('p1')).rejects.toThrow(/\[FORBIDDEN\]/)
    expect(recordAuditEventSafeMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'access.denied', entityId: 'p1' }),
    )
  })

  it('3. devuelve user cuando tiene visibilidad por assignment', async () => {
    const user = {
      id: 'u1',
      email: 'a@b.c',
      name: 'User',
      roles: ['USER'],
      gerenciaId: null,
      workspaceId: 'w1',
    }
    getCurrentUserMock.mockReturnValue(user)
    findFirstProject.mockResolvedValue({ id: 'p1' })
    const result = await requireProjectAccess('p1')
    expect(result).toEqual(user)
    expect(findFirstProject).toHaveBeenCalled()
  })

  it('4. ADMIN sin assignment recibe acceso global (filtro vacío)', async () => {
    const user = {
      id: 'u1',
      email: 'a@b.c',
      name: 'Admin',
      roles: ['ADMIN'],
      gerenciaId: null,
      workspaceId: null,
    }
    getCurrentUserMock.mockReturnValue(user)
    findFirstProject.mockResolvedValue({ id: 'p1' })
    const result = await requireProjectAccess('p1')
    expect(result).toEqual(user)
    expect(findFirstProject).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ id: 'p1' }, {}]),
        }),
      }),
    )
  })

  it('5. SUPER_ADMIN sin assignment recibe acceso global', async () => {
    const user = {
      id: 'u1',
      email: 'a@b.c',
      name: 'Edwin',
      roles: ['SUPER_ADMIN'],
      gerenciaId: null,
      workspaceId: null,
    }
    getCurrentUserMock.mockReturnValue(user)
    findFirstProject.mockResolvedValue({ id: 'p1' })
    const result = await requireProjectAccess('p1')
    expect(result).toEqual(user)
  })

  it('6. projectId vacío lanza [FORBIDDEN] sin consultar sesión', async () => {
    await expect(requireProjectAccess('')).rejects.toThrow(/\[FORBIDDEN\]/)
    expect(getCurrentUserMock).not.toHaveBeenCalled()
    expect(findFirstProject).not.toHaveBeenCalled()
  })
})

describe('hashPassword / verifyPassword', () => {
  it('7. verify del mismo password devuelve true', async () => {
    const hash = await hashPassword('Pa$$w0rd-12345')
    expect(hash).toMatch(/^pbkdf2\$\d+\$[^$]+\$[^$]+$/)
    expect(await verifyPassword('Pa$$w0rd-12345', hash)).toBe(true)
  })

  it('8. verify con password incorrecto devuelve false', async () => {
    const hash = await hashPassword('correct-password')
    expect(await verifyPassword('wrong-password', hash)).toBe(false)
    // Tampoco hace match con string vacío ni hash inválido.
    expect(await verifyPassword('', hash)).toBe(false)
    expect(await verifyPassword('correct-password', null)).toBe(false)
    expect(
      await verifyPassword('correct-password', 'no-pbkdf2-format'),
    ).toBe(false)
  })
})
