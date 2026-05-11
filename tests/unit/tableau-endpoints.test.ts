import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Wave R3.0 Fase 4 · Equipo P21-B · Tests Tableau Web Data Connector endpoints.
 *
 * Cubre los 5 endpoints REST + el schema endpoint + el helper de paginación:
 *   - 401 sin Bearer token.
 *   - 403 con token sin scope `read:exports`.
 *   - 200 + shape `{ table, rows, nextCursor }` válido con token correcto.
 *   - Paginación cursor-based devuelve `nextCursor` cuando hay más filas.
 *   - Filtros tipados (projectId, status, severity, state).
 *   - Schema endpoint 200 para datasets válidos y 404 para inválidos.
 *   - Audit log emite `tableau.dataset_fetched` con metadata correcta.
 *
 * Mockeamos:
 *   - `@/app/api/v2/_helpers` para simular `requireApiKey` con resultados
 *     determinísticos (sin tocar redis/rate-limit/bd).
 *   - `@/lib/prisma` para evitar conectarse a Postgres.
 *   - `@/lib/audit/events` para verificar emisión sin tocar BD.
 *   - `server-only` (igual que el resto del repo).
 */

// ─────────────────────────────── Mocks ───────────────────────────────

const requireApiKeyMock = vi.fn()

vi.mock('@/app/api/v2/_helpers', () => ({
  requireApiKey: (...args: unknown[]) => requireApiKeyMock(...args),
  parsePagination: vi.fn(),
}))

const projectFindMany = vi.fn()
const taskFindMany = vi.fn()
const sprintFindMany = vi.fn()
const riskFindMany = vi.fn()
const auditFindMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    project: { findMany: (...a: unknown[]) => projectFindMany(...a) },
    task: { findMany: (...a: unknown[]) => taskFindMany(...a) },
    sprint: { findMany: (...a: unknown[]) => sprintFindMany(...a) },
    risk: { findMany: (...a: unknown[]) => riskFindMany(...a) },
    auditEvent: { findMany: (...a: unknown[]) => auditFindMany(...a) },
  },
}))

const recordAuditEventSafeMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/audit/events', () => ({
  recordAuditEventSafe: (...args: unknown[]) =>
    recordAuditEventSafeMock(...args),
}))

vi.mock('server-only', () => ({}))

// Helpers de respuesta y schema NO se mockean (son puros).

import { GET as getProjects } from '@/app/api/integrations/tableau/projects/route'
import { GET as getTasks } from '@/app/api/integrations/tableau/tasks/route'
import { GET as getSprints } from '@/app/api/integrations/tableau/sprints/route'
import { GET as getRisks } from '@/app/api/integrations/tableau/risks/route'
import { GET as getAudit } from '@/app/api/integrations/tableau/audit/route'
import { GET as getSchema } from '@/app/api/integrations/tableau/schema/[dataset]/route'
import {
  parseTableauPagination,
  TABLEAU_TABLES,
  isTableauDataset,
  isoOrNull,
} from '@/lib/integrations/tableau-schema'

import type { NextRequest } from 'next/server'

// ─────────────────────────────── Setup ───────────────────────────────

const WORKSPACE_ID = 'ws_test'

function mockAuthOk() {
  requireApiKeyMock.mockResolvedValue({
    ok: true,
    auth: {
      apiKey: {
        id: 'key_1',
        workspaceId: WORKSPACE_ID,
        scopes: ['read:exports'],
        expiresAt: null,
      },
      rateLimit: { allowed: true, remaining: 59, resetAt: Date.now() + 60000 },
    },
  })
}

function mockAuthFail(
  code: 'INVALID_KEY' | 'INSUFFICIENT_SCOPE' | 'RATE_LIMITED',
  status: number,
) {
  requireApiKeyMock.mockResolvedValue({
    ok: false,
    response: new Response(
      JSON.stringify({ error: { code, message: code } }),
      { status, headers: { 'Content-Type': 'application/json' } },
    ),
  })
}

function makeRequest(url = 'http://x.test/api/integrations/tableau/projects') {
  return new Request(url) as unknown as NextRequest
}

beforeEach(() => {
  requireApiKeyMock.mockReset()
  projectFindMany.mockReset()
  taskFindMany.mockReset()
  sprintFindMany.mockReset()
  riskFindMany.mockReset()
  auditFindMany.mockReset()
  recordAuditEventSafeMock.mockReset().mockResolvedValue(undefined)
})

// ─────────────────────────── parseTableauPagination ───────────────────────────

describe('parseTableauPagination', () => {
  it('aplica defaults seguros sin query params', () => {
    const url = new URL('http://x.test/foo')
    const out = parseTableauPagination(url)
    expect(out.cursor).toBeNull()
    expect(out.limit).toBe(5000)
  })

  it('parsea cursor y limit válidos', () => {
    const url = new URL('http://x.test/foo?cursor=abc&limit=100')
    const out = parseTableauPagination(url)
    expect(out.cursor).toBe('abc')
    expect(out.limit).toBe(100)
  })

  it('clampa limit al máximo 5000', () => {
    const url = new URL('http://x.test/foo?limit=99999')
    expect(parseTableauPagination(url).limit).toBe(5000)
  })

  it('ignora limit no entero o no positivo', () => {
    expect(parseTableauPagination(new URL('http://x.test/?limit=0')).limit).toBe(
      5000,
    )
    expect(
      parseTableauPagination(new URL('http://x.test/?limit=foo')).limit,
    ).toBe(5000)
    expect(
      parseTableauPagination(new URL('http://x.test/?limit=-10')).limit,
    ).toBe(5000)
  })
})

// ─────────────────────────── isoOrNull ───────────────────────────

describe('isoOrNull', () => {
  it('serializa fecha válida a ISO string', () => {
    const d = new Date('2026-01-01T12:00:00Z')
    expect(isoOrNull(d)).toBe('2026-01-01T12:00:00.000Z')
  })

  it('null/undefined → null', () => {
    expect(isoOrNull(null)).toBeNull()
    expect(isoOrNull(undefined)).toBeNull()
  })
})

// ─────────────────────────── Schema endpoint ───────────────────────────

describe('GET /api/integrations/tableau/schema/[dataset]', () => {
  it('devuelve metadata 200 para projects', async () => {
    const req = makeRequest('http://x.test/api/integrations/tableau/schema/projects')
    const res = await getSchema(req, {
      params: Promise.resolve({ dataset: 'projects' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('projects')
    expect(Array.isArray(body.columns)).toBe(true)
    expect(body.columns[0]).toHaveProperty('dataType')
  })

  it('404 para dataset inválido', async () => {
    const req = makeRequest('http://x.test/api/integrations/tableau/schema/foo')
    const res = await getSchema(req, {
      params: Promise.resolve({ dataset: 'foo' }),
    })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('TABLEAU_TABLES contiene los 5 datasets canónicos', () => {
    expect(Object.keys(TABLEAU_TABLES).sort()).toEqual([
      'audit',
      'projects',
      'risks',
      'sprints',
      'tasks',
    ])
  })

  it('isTableauDataset valida correctamente', () => {
    expect(isTableauDataset('projects')).toBe(true)
    expect(isTableauDataset('tasks')).toBe(true)
    expect(isTableauDataset('foo')).toBe(false)
  })
})

// ─────────────────────────── Auth gating ───────────────────────────

describe('Tableau endpoints · auth gating', () => {
  it('Projects 401 sin token', async () => {
    mockAuthFail('INVALID_KEY', 401)
    const res = await getProjects(makeRequest())
    expect(res.status).toBe(401)
    expect(projectFindMany).not.toHaveBeenCalled()
  })

  it('Tasks 403 sin scope read:exports', async () => {
    mockAuthFail('INSUFFICIENT_SCOPE', 403)
    const res = await getTasks(makeRequest())
    expect(res.status).toBe(403)
    expect(taskFindMany).not.toHaveBeenCalled()
  })

  it('Sprints 401 sin token', async () => {
    mockAuthFail('INVALID_KEY', 401)
    const res = await getSprints(makeRequest())
    expect(res.status).toBe(401)
    expect(sprintFindMany).not.toHaveBeenCalled()
  })

  it('Risks 403 sin scope', async () => {
    mockAuthFail('INSUFFICIENT_SCOPE', 403)
    const res = await getRisks(makeRequest())
    expect(res.status).toBe(403)
    expect(riskFindMany).not.toHaveBeenCalled()
  })

  it('Audit 401 sin token', async () => {
    mockAuthFail('INVALID_KEY', 401)
    const res = await getAudit(makeRequest())
    expect(res.status).toBe(401)
    expect(auditFindMany).not.toHaveBeenCalled()
  })
})

// ─────────────────────────── Projects 200 + audit ───────────────────────────

describe('GET /api/integrations/tableau/projects', () => {
  it('200 + shape correcto + audit emitido', async () => {
    mockAuthOk()
    projectFindMany.mockResolvedValue([
      {
        id: 'p1',
        name: 'Proyecto Alfa',
        status: 'ACTIVE',
        methodology: 'SCRUM',
        budget: { toString: () => '1000.50' },
        budgetCurrency: 'MXN',
        cpi: 1.1,
        spi: 0.95,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-02-01T00:00:00Z'),
        manager: { name: 'Edwin', email: 'e@avante.com' },
        area: { name: 'TI', gerencia: { name: 'Operaciones' } },
        tasks: [
          { startDate: new Date('2026-01-05'), endDate: new Date('2026-03-15') },
          { startDate: new Date('2026-02-10'), endDate: new Date('2026-04-01') },
        ],
      },
    ])

    const res = await getProjects(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.table).toBe('projects')
    expect(body.rows).toHaveLength(1)
    expect(body.rows[0]).toMatchObject({
      id: 'p1',
      name: 'Proyecto Alfa',
      manager: 'Edwin <e@avante.com>',
      gerencia: 'Operaciones',
      area: 'TI',
      budget: 1000.5,
      cpi: 1.1,
    })
    expect(body.rows[0].startDate).toBe('2026-01-05T00:00:00.000Z')
    expect(body.rows[0].endDate).toBe('2026-04-01T00:00:00.000Z')
    expect(body.nextCursor).toBeNull()
    // Audit emitido con dataset correcto.
    expect(recordAuditEventSafeMock).toHaveBeenCalledTimes(1)
    const call = recordAuditEventSafeMock.mock.calls[0][0] as {
      action: string
      metadata: { dataset: string; rowCount: number }
    }
    expect(call.action).toBe('tableau.dataset_fetched')
    expect(call.metadata.dataset).toBe('projects')
    expect(call.metadata.rowCount).toBe(1)
  })

  it('paginación devuelve nextCursor cuando hay más filas', async () => {
    mockAuthOk()
    // Devolvemos limit+1 filas para forzar paginación. Usamos limit=2.
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `p${i + 1}`,
      name: `P${i + 1}`,
      status: 'ACTIVE',
      methodology: 'SCRUM',
      budget: null,
      budgetCurrency: null,
      cpi: null,
      spi: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      manager: null,
      area: null,
      tasks: [],
    }))
    projectFindMany.mockResolvedValue(rows)
    const res = await getProjects(
      makeRequest('http://x.test/api/integrations/tableau/projects?limit=2'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows).toHaveLength(2)
    expect(body.nextCursor).toBe('p3')
    // Verifica que el header X-Next-Cursor está presente.
    expect(res.headers.get('X-Next-Cursor')).toBe('p3')
  })

  it('aplica filtro status whitelisted al where Prisma', async () => {
    mockAuthOk()
    projectFindMany.mockResolvedValue([])
    await getProjects(
      makeRequest(
        'http://x.test/api/integrations/tableau/projects?status=ACTIVE',
      ),
    )
    expect(projectFindMany).toHaveBeenCalledTimes(1)
    const args = projectFindMany.mock.calls[0][0] as {
      where: { workspaceId: string; status?: string }
    }
    expect(args.where.workspaceId).toBe(WORKSPACE_ID)
    expect(args.where.status).toBe('ACTIVE')
  })

  it('ignora status no whitelisted', async () => {
    mockAuthOk()
    projectFindMany.mockResolvedValue([])
    await getProjects(
      makeRequest('http://x.test/api/integrations/tableau/projects?status=FOO'),
    )
    const args = projectFindMany.mock.calls[0][0] as {
      where: { workspaceId: string; status?: string }
    }
    expect(args.where.status).toBeUndefined()
  })
})

// ─────────────────────────── Tasks ───────────────────────────

describe('GET /api/integrations/tableau/tasks', () => {
  it('200 + projectName/assigneeName join correctos', async () => {
    mockAuthOk()
    taskFindMany.mockResolvedValue([
      {
        id: 't1',
        mnemonic: 'T-001',
        title: 'Implementar feature',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        storyPoints: 5,
        plannedValue: 1000,
        actualCost: 800,
        earnedValue: 900,
        progress: 50,
        startDate: new Date('2026-01-05'),
        endDate: new Date('2026-02-01'),
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-15'),
        projectId: 'p1',
        project: { name: 'Alfa' },
        sprint: { name: 'Sprint 1' },
        epic: { name: 'Epic A' },
        assignee: { name: 'Juan', email: 'j@avante.com' },
      },
    ])

    const res = await getTasks(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows[0]).toMatchObject({
      id: 't1',
      title: 'Implementar feature',
      projectName: 'Alfa',
      sprintName: 'Sprint 1',
      epicName: 'Epic A',
      assigneeName: 'Juan <j@avante.com>',
      storyPoints: 5,
      progress: 50,
    })
  })

  it('aplica filtro projectId al where', async () => {
    mockAuthOk()
    taskFindMany.mockResolvedValue([])
    await getTasks(
      makeRequest(
        'http://x.test/api/integrations/tableau/tasks?projectId=p1&status=DONE',
      ),
    )
    const args = taskFindMany.mock.calls[0][0] as {
      where: { projectId?: string; status?: string }
    }
    expect(args.where.projectId).toBe('p1')
    expect(args.where.status).toBe('DONE')
  })
})

// ─────────────────────────── Sprints (state derivado) ───────────────────────────

describe('GET /api/integrations/tableau/sprints', () => {
  it('200 + state derivado correctamente', async () => {
    mockAuthOk()
    sprintFindMany.mockResolvedValue([
      {
        id: 's1',
        name: 'Sprint 1',
        goal: 'Goal 1',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-01-14'),
        startedAt: null,
        endedAt: null,
        reviewedAt: null,
        capacity: 40,
        velocityActual: null,
        projectId: 'p1',
        project: { name: 'Alfa' },
      },
      {
        id: 's2',
        name: 'Sprint 2',
        goal: null,
        startDate: new Date('2026-01-15'),
        endDate: new Date('2026-01-28'),
        startedAt: new Date('2026-01-15'),
        endedAt: null,
        reviewedAt: null,
        capacity: 40,
        velocityActual: null,
        projectId: 'p1',
        project: { name: 'Alfa' },
      },
      {
        id: 's3',
        name: 'Sprint 3',
        goal: 'G3',
        startDate: new Date('2026-01-29'),
        endDate: new Date('2026-02-11'),
        startedAt: new Date('2026-01-29'),
        endedAt: new Date('2026-02-11'),
        reviewedAt: new Date('2026-02-12'),
        capacity: 40,
        velocityActual: 35,
        projectId: 'p1',
        project: { name: 'Alfa' },
      },
    ])
    const res = await getSprints(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows.map((r: { state: string }) => r.state)).toEqual([
      'PLANNING',
      'ACTIVE',
      'CLOSED',
    ])
  })

  it('filtro state=ACTIVE filtra post-query (derivado)', async () => {
    mockAuthOk()
    sprintFindMany.mockResolvedValue([
      {
        id: 's1',
        name: 'P',
        goal: '',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-01-14'),
        startedAt: null,
        endedAt: null,
        reviewedAt: null,
        capacity: null,
        velocityActual: null,
        projectId: 'p1',
        project: { name: 'A' },
      },
      {
        id: 's2',
        name: 'A',
        goal: '',
        startDate: new Date('2026-01-15'),
        endDate: new Date('2026-01-28'),
        startedAt: new Date('2026-01-15'),
        endedAt: null,
        reviewedAt: null,
        capacity: null,
        velocityActual: null,
        projectId: 'p1',
        project: { name: 'A' },
      },
    ])
    const res = await getSprints(
      makeRequest(
        'http://x.test/api/integrations/tableau/sprints?state=ACTIVE',
      ),
    )
    const body = await res.json()
    expect(body.rows).toHaveLength(1)
    expect(body.rows[0].id).toBe('s2')
  })
})

// ─────────────────────────── Risks (score + severity) ───────────────────────────

describe('GET /api/integrations/tableau/risks', () => {
  it('200 + score y severity calculados', async () => {
    mockAuthOk()
    riskFindMany.mockResolvedValue([
      {
        id: 'r1',
        projectId: 'p1',
        title: 'Riesgo crítico',
        probability: 5,
        impact: 5,
        status: 'OPEN',
        source: 'MANUAL',
        detectedAt: new Date('2026-01-10'),
        closedAt: null,
        createdAt: new Date('2026-01-10'),
        updatedAt: new Date('2026-01-10'),
        project: { name: 'Alfa' },
        owner: { name: 'Ana', email: 'a@avante.com' },
      },
      {
        id: 'r2',
        projectId: 'p1',
        title: 'Riesgo bajo',
        probability: 1,
        impact: 2,
        status: 'OPEN',
        source: 'BRAIN_AI',
        detectedAt: null,
        closedAt: null,
        createdAt: new Date('2026-01-10'),
        updatedAt: new Date('2026-01-10'),
        project: { name: 'Alfa' },
        owner: null,
      },
    ])

    const res = await getRisks(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows[0]).toMatchObject({
      id: 'r1',
      score: 25,
      severity: 'CRITICAL',
      ownerName: 'Ana <a@avante.com>',
      projectName: 'Alfa',
    })
    expect(body.rows[1]).toMatchObject({
      id: 'r2',
      score: 2,
      severity: 'LOW',
      ownerName: '',
    })
  })

  it('filtro severity post-query', async () => {
    mockAuthOk()
    riskFindMany.mockResolvedValue([
      {
        id: 'r1',
        projectId: 'p1',
        title: 'A',
        probability: 5,
        impact: 5,
        status: 'OPEN',
        source: 'MANUAL',
        detectedAt: null,
        closedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        project: { name: 'Alfa' },
        owner: null,
      },
      {
        id: 'r2',
        projectId: 'p1',
        title: 'B',
        probability: 1,
        impact: 1,
        status: 'OPEN',
        source: 'MANUAL',
        detectedAt: null,
        closedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        project: { name: 'Alfa' },
        owner: null,
      },
    ])
    const res = await getRisks(
      makeRequest(
        'http://x.test/api/integrations/tableau/risks?severity=CRITICAL',
      ),
    )
    const body = await res.json()
    expect(body.rows).toHaveLength(1)
    expect(body.rows[0].id).toBe('r1')
    expect(body.rows[0].severity).toBe('CRITICAL')
  })
})

// ─────────────────────────── Audit ───────────────────────────

describe('GET /api/integrations/tableau/audit', () => {
  it('200 + filtro de 90 días aplicado al where', async () => {
    mockAuthOk()
    auditFindMany.mockResolvedValue([
      {
        id: 'e1',
        action: 'task.created',
        entityType: 'task',
        entityId: 't1',
        actorId: 'u1',
        ipAddress: '10.0.0.1',
        createdAt: new Date('2026-04-01'),
        actor: { name: 'Edwin', email: 'e@avante.com' },
      },
    ])

    const res = await getAudit(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows[0]).toMatchObject({
      id: 'e1',
      action: 'task.created',
      actorName: 'Edwin <e@avante.com>',
    })
    // El where debe incluir createdAt >= since (90 días atrás).
    expect(auditFindMany).toHaveBeenCalledTimes(1)
    const args = auditFindMany.mock.calls[0][0] as {
      where: { createdAt: { gte: Date }; OR: unknown[] }
    }
    expect(args.where.createdAt.gte).toBeInstanceOf(Date)
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000
    // Tolerancia 1s para evitar flake por reloj.
    expect(
      Math.abs(args.where.createdAt.gte.getTime() - ninetyDaysAgo),
    ).toBeLessThan(2000)
    // Workspace filter via actor.workspaceId OR actorId null.
    expect(args.where.OR).toHaveLength(2)
  })

  it('aplica filtros action y entityType', async () => {
    mockAuthOk()
    auditFindMany.mockResolvedValue([])
    await getAudit(
      makeRequest(
        'http://x.test/api/integrations/tableau/audit?action=task.created&entityType=task',
      ),
    )
    const args = auditFindMany.mock.calls[0][0] as {
      where: { action?: string; entityType?: string }
    }
    expect(args.where.action).toBe('task.created')
    expect(args.where.entityType).toBe('task')
  })

  it('emite audit.tableau.dataset_fetched con dataset=audit', async () => {
    mockAuthOk()
    auditFindMany.mockResolvedValue([])
    await getAudit(makeRequest())
    const call = recordAuditEventSafeMock.mock.calls[0][0] as {
      action: string
      metadata: { dataset: string }
    }
    expect(call.action).toBe('tableau.dataset_fetched')
    expect(call.metadata.dataset).toBe('audit')
  })
})
