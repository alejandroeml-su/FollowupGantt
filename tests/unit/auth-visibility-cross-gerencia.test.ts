import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * HU "Acceso Transversal por Asignación de Proyecto" (2026-05-12).
 *
 * Cobertura:
 *   1. SUPER_ADMIN / ADMIN → filtro vacío (sin restricción).
 *   2. GERENCIA_GENERAL → workspace activo, sin restricción de gerencia.
 *   3. GERENTE_AREA con gerencia → su gerencia OR assignment OR equipo.
 *   4. USER con gerencia → su gerencia OR assignment OR equipo (HU criterio 1+2).
 *   5. USER sin gerencia → solo assignment OR equipo (legacy).
 *   6. resolveProjectVisibility para anónimo → listas vacías.
 *   7. resolveProjectVisibility para ADMIN → unrestricted=true.
 */

const { findManyMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  default: { project: { findMany: (...a: unknown[]) => findManyMock(...a) } },
}))
vi.mock('@/lib/audit/events', () => ({
  recordAuditEventSafe: vi.fn(),
}))

import {
  getProjectAccessFilter,
  resolveProjectVisibility,
} from '@/lib/auth/visibility'
import type { SessionUser } from '@/lib/auth/session'

function buildUser(overrides: Partial<SessionUser> & {
  gerenciaId?: string | null
  workspaceId?: string | null
} = {}): SessionUser & { gerenciaId?: string | null; workspaceId?: string | null } {
  return {
    id: 'u-1',
    name: 'Test User',
    email: 'u1@example.com',
    roles: ['USER'],
    workspaceId: 'ws-1',
    gerenciaId: null,
    ...overrides,
  } as SessionUser & { gerenciaId?: string | null; workspaceId?: string | null }
}

beforeEach(() => {
  findManyMock.mockReset()
})

describe('getProjectAccessFilter', () => {
  it('SUPER_ADMIN ve todo: filtro vacío', async () => {
    const f = await getProjectAccessFilter(buildUser({ roles: ['SUPER_ADMIN'] }))
    expect(f).toEqual({})
  })

  it('ADMIN ve todo: filtro vacío', async () => {
    const f = await getProjectAccessFilter(buildUser({ roles: ['ADMIN'] }))
    expect(f).toEqual({})
  })

  it('GERENCIA_GENERAL limita a workspace activo', async () => {
    const f = await getProjectAccessFilter(
      buildUser({ roles: ['GERENCIA_GENERAL'], workspaceId: 'ws-9' }),
    )
    expect(f).toEqual({ workspaceId: 'ws-9' })
  })

  it('GERENTE_AREA con gerencia: gerencia OR assignment OR equipo', async () => {
    const f = await getProjectAccessFilter(
      buildUser({
        roles: ['GERENTE_AREA'],
        gerenciaId: 'g-MED',
        workspaceId: 'ws-1',
      }),
    )
    expect(f).toMatchObject({
      AND: [
        { workspaceId: 'ws-1' },
        {
          OR: [
            { area: { gerenciaId: 'g-MED' } },
            { assignments: { some: { userId: 'u-1' } } },
            expect.objectContaining({ teamProjects: expect.anything() }),
          ],
        },
      ],
    })
  })

  it('USER con gerencia (HU criterio 1+2): gerencia OR assignment OR equipo', async () => {
    const f = await getProjectAccessFilter(
      buildUser({ roles: ['USER'], gerenciaId: 'g-MED' }),
    )
    // El OR debe contener la gerencia base como caso adicional al assignment.
    const cond = f as {
      AND?: Array<Record<string, unknown>>
    }
    const orClause = cond.AND?.[1] as { OR?: Array<Record<string, unknown>> }
    expect(orClause.OR).toEqual(
      expect.arrayContaining([
        { area: { gerenciaId: 'g-MED' } },
        { assignments: { some: { userId: 'u-1' } } },
      ]),
    )
  })

  it('USER sin gerencia (legacy): solo assignment + equipo, sin clausula de gerencia', async () => {
    const f = await getProjectAccessFilter(
      buildUser({ roles: ['USER'], gerenciaId: null }),
    )
    const cond = f as { AND?: Array<Record<string, unknown>> }
    const orClause = cond.AND?.[1] as { OR?: Array<Record<string, unknown>> }
    // No debe haber clausula `{ area: { gerenciaId: ... } }`.
    const hasGerenciaClause = (orClause.OR ?? []).some(
      (c) => 'area' in c && (c as { area: { gerenciaId?: string } }).area.gerenciaId,
    )
    expect(hasGerenciaClause).toBe(false)
    // Debe haber el assignment.
    expect(orClause.OR).toEqual(
      expect.arrayContaining([{ assignments: { some: { userId: 'u-1' } } }]),
    )
  })
})

describe('resolveProjectVisibility', () => {
  it('sin sesión: visibleIds vacío + projectWhere/taskWhere bloquean todo', async () => {
    const v = await resolveProjectVisibility(null)
    expect(v.unrestricted).toBe(false)
    expect(v.visibleIds).toEqual([])
    expect(v.taskWhere).toEqual({ projectId: { in: [] } })
    expect(v.projectWhere).toEqual({ id: { in: [] } })
    expect(findManyMock).not.toHaveBeenCalled()
  })

  it('SUPER_ADMIN: unrestricted=true sin query a BD para listar IDs', async () => {
    const v = await resolveProjectVisibility(
      buildUser({ roles: ['SUPER_ADMIN'] }),
    )
    expect(v.unrestricted).toBe(true)
    expect(v.taskWhere).toEqual({})
    expect(v.projectWhere).toEqual({})
    expect(findManyMock).not.toHaveBeenCalled()
  })

  it('USER con assignment cross-gerencia: incluye el proyecto externo en visibleIds', async () => {
    // p-X (gerencia base) y p-Y (otra gerencia, asignado explícitamente).
    findManyMock.mockResolvedValueOnce([{ id: 'p-X' }, { id: 'p-Y' }])
    const v = await resolveProjectVisibility(
      buildUser({ roles: ['USER'], gerenciaId: 'g-MED' }),
    )
    expect(v.unrestricted).toBe(false)
    expect(v.visibleIds).toEqual(['p-X', 'p-Y'])
    expect(v.taskWhere).toEqual({ projectId: { in: ['p-X', 'p-Y'] } })
    expect(v.projectWhere).toEqual({ id: { in: ['p-X', 'p-Y'] } })
  })

  it('USER sin proyectos visibles: where vacío para forzar resultado nulo', async () => {
    findManyMock.mockResolvedValueOnce([])
    const v = await resolveProjectVisibility(
      buildUser({ roles: ['USER'], gerenciaId: 'g-MED' }),
    )
    expect(v.visibleIds).toEqual([])
    expect(v.taskWhere).toEqual({ projectId: { in: [] } })
    expect(v.projectWhere).toEqual({ id: { in: [] } })
  })
})
