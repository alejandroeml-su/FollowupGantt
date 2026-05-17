import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Wave R5 · US-9.3 — Tests del server action `searchCIs`.
 *
 * Cobertura:
 *   1. Filtros combinables (type + status + criticality) generan WHERE
 *      Prisma con todos los predicates correctos + workspaceId.
 *   2. Por defecto excluye `retiredAt != null` (sin includeRetired).
 *   3. `query` genera OR sobre name/code/description con `insensitive`.
 *   4. Devuelve estructura paginada con total + items.
 *   5. Sin workspace activo devuelve resultado vacío (total=0).
 */

const ciCount = vi.fn()
const ciFindMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    configurationItem: {
      count: (...a: unknown[]) => ciCount(...a),
      findMany: (...a: unknown[]) => ciFindMany(...a),
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/lib/audit/events', () => ({
  recordAuditEventSafe: vi.fn(async () => undefined),
}))

vi.mock('@/lib/observability/metrics', () => ({
  withMetrics: <T,>(_name: string, fn: () => Promise<T>) => fn(),
}))

vi.mock('server-only', () => ({}))

// Sesión con workspace para los tests "normales"; un test lo sobre-mockea
// con workspaceId=null para validar el caso vacío.
const baseSession = {
  id: 'user-1',
  email: 'edwin@avante.com',
  name: 'Edwin',
  roles: ['ADMIN'],
  workspaceId: 'ws-1',
}

const currentSession = { value: baseSession as Record<string, unknown> | null }

vi.mock('@/lib/auth/get-current-user', () => ({
  getCurrentUser: async () => currentSession.value,
  requireUser: async () => {
    if (!currentSession.value) throw new Error('[UNAUTHORIZED] Sesión requerida')
    return currentSession.value
  },
}))

beforeEach(() => {
  ciCount.mockReset()
  ciFindMany.mockReset()
  currentSession.value = baseSession
  ciCount.mockResolvedValue(0)
  ciFindMany.mockResolvedValue([])
})

describe('searchCIs', () => {
  it('combina filtros type + status + criticality dentro del workspace', async () => {
    ciCount.mockResolvedValueOnce(3)
    ciFindMany.mockResolvedValueOnce([
      {
        id: 'ci-1',
        code: 'CI-001',
        name: 'Servidor email',
        type: 'SERVER',
        status: 'ACTIVE',
        criticality: 'HIGH',
        environment: 'PROD',
        description: null,
        retiredAt: null,
        updatedAt: new Date('2026-05-15T10:00:00Z'),
        owner: null,
        _count: { relationsFrom: 1, relationsTo: 0, taskLinks: 2 },
      },
    ])

    const { searchCIs } = await import('@/lib/actions/cmdb')
    const result = await searchCIs({
      type: 'SERVER',
      status: 'ACTIVE',
      criticality: 'HIGH',
      environment: 'PROD',
    })

    expect(result.total).toBe(3)
    expect(result.items.length).toBe(1)
    const whereArg = ciFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    expect(whereArg.where.workspaceId).toBe('ws-1')
    expect(whereArg.where.type).toBe('SERVER')
    expect(whereArg.where.status).toBe('ACTIVE')
    expect(whereArg.where.criticality).toBe('HIGH')
    expect(whereArg.where.environment).toBe('PROD')
    // includeRetired no provisto → debe excluir retirados.
    expect(whereArg.where.retiredAt).toBeNull()
  })

  it('excluye retirados por defecto, incluye si includeRetired=true', async () => {
    const { searchCIs } = await import('@/lib/actions/cmdb')

    await searchCIs({})
    let where = ciFindMany.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> }
    expect(where.where.retiredAt).toBeNull()

    await searchCIs({ includeRetired: true })
    where = ciFindMany.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> }
    expect(where.where.retiredAt).toBeUndefined()
  })

  it('genera OR insensitive sobre name/code/description con query', async () => {
    const { searchCIs } = await import('@/lib/actions/cmdb')
    await searchCIs({ query: 'gateway' })
    const where = ciFindMany.mock.calls.at(-1)?.[0] as {
      where: { OR?: Array<Record<string, { contains?: string; mode?: string }>> }
    }
    expect(where.where.OR).toBeDefined()
    const fields = where.where.OR!.map((o) => Object.keys(o)[0])
    expect(fields).toEqual(['name', 'code', 'description'])
    for (const cond of where.where.OR!) {
      const inner = Object.values(cond)[0]
      expect(inner.contains).toBe('gateway')
      expect(inner.mode).toBe('insensitive')
    }
  })

  it('devuelve estructura paginada {total, page, pageSize, items}', async () => {
    ciCount.mockResolvedValueOnce(50)
    ciFindMany.mockResolvedValueOnce([])

    const { searchCIs } = await import('@/lib/actions/cmdb')
    const r = await searchCIs({ page: 2, pageSize: 10 })

    expect(r.total).toBe(50)
    expect(r.page).toBe(2)
    expect(r.pageSize).toBe(10)
    expect(Array.isArray(r.items)).toBe(true)
    const args = ciFindMany.mock.calls.at(-1)?.[0] as { skip: number; take: number }
    expect(args.skip).toBe(10)
    expect(args.take).toBe(10)
  })

  it('devuelve resultado vacío cuando no hay workspace activo', async () => {
    currentSession.value = { ...baseSession, workspaceId: null }

    const { searchCIs } = await import('@/lib/actions/cmdb')
    const r = await searchCIs({ query: 'any' })

    expect(r.total).toBe(0)
    expect(r.items).toEqual([])
    expect(ciCount).not.toHaveBeenCalled()
    expect(ciFindMany).not.toHaveBeenCalled()
  })
})
