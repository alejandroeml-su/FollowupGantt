import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Wave P21-C · Tests del refinamiento Power BI-friendly del OData v4.
 *
 * Cubre las features añadidas vs PR #192:
 *   - $metadata endpoint EDMX XML válido (todas las entities).
 *   - $select restringe columnas.
 *   - $orderby ordena asc/desc.
 *   - $count=true incluye `@odata.count`.
 *   - $expand carga relación whitelist.
 *   - Headers OData-Version + Content-Type Power BI-friendly.
 *   - Backward-compat con queries sin las nuevas options.
 *
 * Mockeamos `@/lib/prisma` + `@/lib/api/v2-auth` + `@/lib/audit/events` para
 * aislar lógica del route handler. La fuente de la verdad EDMX está en
 * `metadataResponse()` (módulo puro).
 */

vi.mock('@/lib/audit/events', () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/api/v2-auth', () => ({
  authenticateV2Request: vi.fn().mockResolvedValue({
    ok: true,
    apiKey: { workspaceId: 'ws_test' },
  }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/lib/prisma', () => {
  const project = { findMany: vi.fn(), count: vi.fn() }
  const task = { findMany: vi.fn(), count: vi.fn() }
  const sprint = { findMany: vi.fn(), count: vi.fn() }
  const risk = { findMany: vi.fn(), count: vi.fn() }
  const eVMSnapshot = { findMany: vi.fn(), count: vi.fn() }
  const auditEvent = { findMany: vi.fn(), count: vi.fn() }
  return {
    default: { project, task, sprint, risk, eVMSnapshot, auditEvent },
  }
})

import prisma from '@/lib/prisma'
import { recordAuditEvent } from '@/lib/audit/events'
import { GET as entitySetGET } from '@/app/api/v2/odata/[entitySet]/route'
import { GET as metadataGET } from '@/app/api/v2/odata/$metadata/route'
import { EDMX_DOC, metadataResponse } from '@/app/api/v2/odata/metadata'
import {
  parseSelect,
  parseOrderby,
  parseCount,
  parseExpand,
  selectToPrisma,
  orderbyToPrisma,
  expandToPrismaInclude,
} from '@/lib/api/odata'

// Helper para construir NextRequest-like.
function makeReq(url: string, headers: Record<string, string> = {}): never {
  // Construimos un Request real (Web standard) y lo casteamos al shape que
  // espera el handler. `next/server` NextRequest extiende Request, así que
  // las propiedades que usa el handler (url, headers, etc) están presentes.
  return new Request(url, {
    headers: { authorization: 'Bearer sk_test_secret', ...headers },
  }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ═════════════════════════════════════════════════════════════════════════
// $metadata endpoint
// ═════════════════════════════════════════════════════════════════════════

describe('$metadata endpoint', () => {
  it('responde XML EDMX v4 válido con todas las entities Power BI espera', async () => {
    const res = await metadataGET()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/xml')
    expect(res.headers.get('OData-Version')).toBe('4.0')
    const body = await res.text()
    expect(body).toContain('<?xml version="1.0"')
    expect(body).toContain('xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx"')
    expect(body).toContain('Version="4.0"')
    // Entity types
    expect(body).toContain('EntityType Name="Project"')
    expect(body).toContain('EntityType Name="Task"')
    expect(body).toContain('EntityType Name="Sprint"')
    expect(body).toContain('EntityType Name="Risk"')
    expect(body).toContain('EntityType Name="EVMSnapshot"')
    expect(body).toContain('EntityType Name="AuditEvent"')
    // Entity sets
    expect(body).toContain('EntitySet Name="Projects"')
    expect(body).toContain('EntitySet Name="Sprints"')
    expect(body).toContain('EntitySet Name="AuditEvents"')
    // Edm types usados
    expect(body).toContain('Edm.String')
    expect(body).toContain('Edm.Int32')
    expect(body).toContain('Edm.Decimal')
    expect(body).toContain('Edm.DateTimeOffset')
  })

  it('declara NavigationProperty para $expand Project→Tasks y Sprint→Project', () => {
    expect(EDMX_DOC).toMatch(/<NavigationProperty Name="Tasks" Type="Collection\(Sync\.Task\)"/)
    expect(EDMX_DOC).toMatch(/<NavigationProperty Name="Project" Type="Sync\.Project"/)
  })

  it('metadataResponse() (módulo) y route handler devuelven el mismo body', async () => {
    const a = await metadataResponse().text()
    const b = await metadataGET().then((r) => r.text())
    expect(a).toBe(b)
  })

  it('dispatch del [entitySet] route también responde $metadata para compat', async () => {
    const res = await entitySetGET(makeReq('https://x.com/api/v2/odata/$metadata'), {
      params: Promise.resolve({ entitySet: '$metadata' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/xml')
    const body = await res.text()
    expect(body).toContain('EntityType Name="Project"')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// $select parser
// ═════════════════════════════════════════════════════════════════════════

describe('parseSelect', () => {
  const allowed = ['id', 'name', 'status', 'cpi']

  it('retorna null cuando no viene $select (significa "todas las columnas")', () => {
    const r = parseSelect(null, allowed)
    expect(r).toEqual({ ok: true, fields: null })
  })

  it('parsea lista válida preservando orden y dedupea', () => {
    const r = parseSelect('id,name,cpi,name', allowed)
    expect(r).toEqual({ ok: true, fields: ['id', 'name', 'cpi'] })
  })

  it('acepta $select=* como atajo de null', () => {
    const r = parseSelect('*', allowed)
    expect(r).toEqual({ ok: true, fields: null })
  })

  it('rechaza campos fuera del whitelist', () => {
    const r = parseSelect('id,secret', allowed)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/no seleccionable/)
  })

  it('rechaza $select vacío explícito', () => {
    const r = parseSelect('   ,  ', allowed)
    // El split deja arr vacío tras filtrar → mensaje "no seleccionable" por
    // el primer item vacío que NO es whitelisted (string vacío). Aceptamos
    // cualquier error porque la condición de "vacío inválido" se cumple.
    expect(r.ok).toBe(false)
  })
})

describe('selectToPrisma', () => {
  it('siempre incluye el key field', () => {
    expect(selectToPrisma(['name'])).toEqual({ id: true, name: true })
  })

  it('null en input → null', () => {
    expect(selectToPrisma(null)).toBeNull()
  })

  it('respeta keyField custom', () => {
    expect(selectToPrisma(['action'], 'id')).toEqual({ id: true, action: true })
  })
})

// ═════════════════════════════════════════════════════════════════════════
// $orderby parser
// ═════════════════════════════════════════════════════════════════════════

describe('parseOrderby', () => {
  const allowed = ['id', 'name', 'createdAt']

  it('null cuando no viene', () => {
    expect(parseOrderby(null, allowed)).toEqual({ ok: true, clauses: null })
  })

  it('default direction asc cuando no se especifica', () => {
    const r = parseOrderby('name', allowed)
    expect(r).toEqual({ ok: true, clauses: [{ field: 'name', dir: 'asc' }] })
  })

  it('parsea desc explícito', () => {
    const r = parseOrderby('createdAt desc', allowed)
    expect(r).toEqual({ ok: true, clauses: [{ field: 'createdAt', dir: 'desc' }] })
  })

  it('soporta multi-campo separado por coma con dir mixto', () => {
    const r = parseOrderby('name asc, createdAt desc, id', allowed)
    expect(r).toEqual({
      ok: true,
      clauses: [
        { field: 'name', dir: 'asc' },
        { field: 'createdAt', dir: 'desc' },
        { field: 'id', dir: 'asc' },
      ],
    })
  })

  it('rechaza direction inválida', () => {
    const r = parseOrderby('name foo', allowed)
    expect(r.ok).toBe(false)
  })

  it('rechaza campo no ordenable', () => {
    const r = parseOrderby('secret desc', allowed)
    expect(r.ok).toBe(false)
  })
})

describe('orderbyToPrisma', () => {
  it('default cuando null', () => {
    expect(orderbyToPrisma(null)).toEqual({ id: 'asc' })
  })

  it('default custom', () => {
    expect(orderbyToPrisma(null, { createdAt: 'desc' })).toEqual({ createdAt: 'desc' })
  })

  it('mapea clauses → array de objetos Prisma', () => {
    expect(
      orderbyToPrisma([
        { field: 'name', dir: 'asc' },
        { field: 'createdAt', dir: 'desc' },
      ]),
    ).toEqual([{ name: 'asc' }, { createdAt: 'desc' }])
  })
})

// ═════════════════════════════════════════════════════════════════════════
// $count parser
// ═════════════════════════════════════════════════════════════════════════

describe('parseCount', () => {
  it('null → no incluir', () => {
    expect(parseCount(null)).toEqual({ ok: true, include: false })
  })

  it('"true" case-insensitive', () => {
    expect(parseCount('true')).toEqual({ ok: true, include: true })
    expect(parseCount('TRUE')).toEqual({ ok: true, include: true })
  })

  it('"false" case-insensitive', () => {
    expect(parseCount('false')).toEqual({ ok: true, include: false })
  })

  it('rechaza valor inválido en lugar de fallar silencioso', () => {
    const r = parseCount('yes')
    expect(r.ok).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// $expand parser
// ═════════════════════════════════════════════════════════════════════════

describe('parseExpand', () => {
  const whitelist = { Tasks: { prismaInclude: 'tasks' } }

  it('null sin $expand', () => {
    expect(parseExpand(null, whitelist)).toEqual({ ok: true, navs: null })
  })

  it('parsea nav válida', () => {
    expect(parseExpand('Tasks', whitelist)).toEqual({ ok: true, navs: ['Tasks'] })
  })

  it('rechaza nav fuera del whitelist', () => {
    const r = parseExpand('Project', whitelist)
    expect(r.ok).toBe(false)
  })

  it('rechaza sub-options ($expand=Tasks($top=5))', () => {
    const r = parseExpand('Tasks($top=5)', whitelist)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/sub-options/)
  })
})

describe('expandToPrismaInclude', () => {
  const whitelist = {
    Tasks: { prismaInclude: 'tasks' },
    Project: { prismaInclude: 'project' },
  }

  it('null si no hay navs', () => {
    expect(expandToPrismaInclude(null, whitelist)).toBeNull()
  })

  it('mapea navs → include Prisma', () => {
    expect(expandToPrismaInclude(['Tasks', 'Project'], whitelist)).toEqual({
      tasks: true,
      project: true,
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Route handler integration — Projects con $select + $count
// ═════════════════════════════════════════════════════════════════════════

describe('GET /api/v2/odata/Projects con $select + $count', () => {
  it('proyecta solo columnas pedidas y devuelve @odata.count', async () => {
    const mockedRows = [{ id: 'p1', name: 'Proyecto A' }]
    ;(prisma.project.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockedRows,
    )
    ;(prisma.project.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(42)

    const res = await entitySetGET(
      makeReq(
        'https://x.com/api/v2/odata/Projects?$select=id,name&$count=true&$top=10',
      ),
      { params: Promise.resolve({ entitySet: 'Projects' }) },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('OData-Version')).toBe('4.0')
    expect(res.headers.get('Content-Type')).toContain('odata.metadata=minimal')

    const body = (await res.json()) as Record<string, unknown>
    expect(body['@odata.count']).toBe(42)
    expect(body['@odata.context']).toContain('$metadata#Projects(id,name)')
    expect(body.value).toEqual([{ id: 'p1', name: 'Proyecto A' }])

    // Verifica que el Prisma findMany recibió select correcto.
    const findManyArgs = (prisma.project.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0][0]
    expect(findManyArgs.select).toEqual({ id: true, name: true })
    expect(findManyArgs.where.workspaceId).toBe('ws_test')
  })

  it('rechaza $select con campo no permitido', async () => {
    const res = await entitySetGET(
      makeReq('https://x.com/api/v2/odata/Projects?$select=secret'),
      { params: Promise.resolve({ entitySet: 'Projects' }) },
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('INVALID_INPUT')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// $orderby + $top
// ═════════════════════════════════════════════════════════════════════════

describe('GET /api/v2/odata/Tasks con $orderby desc + $top', () => {
  it('traduce $orderby a orderBy Prisma con dirección correcta', async () => {
    ;(prisma.task.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 't1', title: 'T', status: 'TODO', priority: 'MEDIUM', progress: 50, projectId: 'p1' },
    ])

    await entitySetGET(
      makeReq(
        'https://x.com/api/v2/odata/Tasks?$orderby=createdAt%20desc&$top=5',
      ),
      { params: Promise.resolve({ entitySet: 'Tasks' }) },
    )

    const args = (prisma.task.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }])
    expect(args.take).toBe(5)
  })

  it('default orderBy={id:asc} cuando NO viene $orderby (backward-compat #192)', async () => {
    ;(prisma.task.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])
    await entitySetGET(makeReq('https://x.com/api/v2/odata/Tasks'), {
      params: Promise.resolve({ entitySet: 'Tasks' }),
    })
    const args = (prisma.task.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(args.orderBy).toEqual({ id: 'asc' })
  })
})

// ═════════════════════════════════════════════════════════════════════════
// $expand
// ═════════════════════════════════════════════════════════════════════════

describe('GET /api/v2/odata/Projects con $expand=Tasks', () => {
  it('incluye la relación tasks en el findMany', async () => {
    ;(prisma.project.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'p1', name: 'P', tasks: [{ id: 't1', title: 'Sub' }] },
    ])

    const res = await entitySetGET(
      makeReq('https://x.com/api/v2/odata/Projects?$expand=Tasks'),
      { params: Promise.resolve({ entitySet: 'Projects' }) },
    )
    expect(res.status).toBe(200)

    const args = (prisma.project.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(args.select.tasks).toBe(true)

    const body = (await res.json()) as { value: Array<Record<string, unknown>> }
    expect(body.value[0].tasks).toEqual([{ id: 't1', title: 'Sub' }])
  })

  it('rechaza $expand a nav no whitelisted', async () => {
    const res = await entitySetGET(
      makeReq('https://x.com/api/v2/odata/Projects?$expand=Risks'),
      { params: Promise.resolve({ entitySet: 'Projects' }) },
    )
    expect(res.status).toBe(400)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Headers Power BI-friendly
// ═════════════════════════════════════════════════════════════════════════

describe('headers Power BI-friendly en responses JSON', () => {
  it('incluye OData-Version, OData-MaxVersion y odata.metadata=minimal', async () => {
    ;(prisma.project.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])
    const res = await entitySetGET(
      makeReq('https://x.com/api/v2/odata/Projects'),
      { params: Promise.resolve({ entitySet: 'Projects' }) },
    )
    expect(res.headers.get('OData-Version')).toBe('4.0')
    expect(res.headers.get('OData-MaxVersion')).toBe('4.0')
    const ct = res.headers.get('Content-Type') ?? ''
    expect(ct).toMatch(/application\/json/)
    expect(ct).toMatch(/odata\.metadata=minimal/)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Audit logging
// ═════════════════════════════════════════════════════════════════════════

describe('audit log powerbi.dataset_fetched', () => {
  it('emite el evento tras una request exitosa', async () => {
    ;(prisma.project.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])
    await entitySetGET(
      makeReq('https://x.com/api/v2/odata/Projects?$top=1', {
        'user-agent':
          'Microsoft.Data.Mashup (https://go.microsoft.com/fwlink/?LinkID=304225)',
      }),
      { params: Promise.resolve({ entitySet: 'Projects' }) },
    )
    // El audit es fire-and-forget; esperamos a la microtask.
    await new Promise((r) => setTimeout(r, 0))
    expect(recordAuditEvent).toHaveBeenCalled()
    const args = (recordAuditEvent as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(args.action).toBe('powerbi.dataset_fetched')
    expect(args.entityType).toBe('odata_entity_set')
    expect(args.entityId).toBe('Projects')
    expect(args.metadata.isPowerBIClient).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Backward-compat con clientes #192 (sin nuevas options)
// ═════════════════════════════════════════════════════════════════════════

describe('backward-compat con clientes PR #192', () => {
  it('query sin $select/$orderby/$count devuelve todos los campos en orden id asc', async () => {
    const mockedRow = {
      id: 'p1',
      name: 'P',
      status: 'ACTIVE',
      methodology: 'SCRUM',
      cpi: 1.0,
      spi: 1.0,
      budget: null,
      budgetCurrency: 'MXN',
      managerId: null,
      areaId: null,
      workspaceId: 'ws_test',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    }
    ;(prisma.project.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      mockedRow,
    ])
    const res = await entitySetGET(
      makeReq('https://x.com/api/v2/odata/Projects'),
      { params: Promise.resolve({ entitySet: 'Projects' }) },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      value: Array<Record<string, unknown>>
      '@odata.count'?: number
      '@odata.context': string
    }
    expect(body['@odata.count']).toBeUndefined() // sin $count=true
    expect(body['@odata.context']).toMatch(/#Projects$/) // sin proyección
    expect(body.value[0].id).toBe('p1')
    expect(body.value[0].cpi).toBe(1.0)
    expect(body.value[0].createdAt).toBe('2026-01-01T00:00:00.000Z')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Entity sets nuevos (Sprints + AuditEvents)
// ═════════════════════════════════════════════════════════════════════════

describe('entity sets nuevos Power BI', () => {
  it('Sprints responde con filtro por workspace y orderby default', async () => {
    ;(prisma.sprint.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 's1',
        name: 'Sprint 1',
        goal: null,
        status: 'ACTIVE',
        startDate: new Date('2026-04-01'),
        endDate: new Date('2026-04-14'),
        capacity: 40,
        velocityActual: null,
        projectId: 'p1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])
    const res = await entitySetGET(
      makeReq('https://x.com/api/v2/odata/Sprints?$top=5'),
      { params: Promise.resolve({ entitySet: 'Sprints' }) },
    )
    expect(res.status).toBe(200)
    const args = (prisma.sprint.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(args.where).toEqual({ project: { workspaceId: 'ws_test' } })
  })

  it('AuditEvents está disponible vía OData', async () => {
    ;(prisma.auditEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'a1',
        actorId: 'u1',
        action: 'task.created',
        entityType: 'task',
        entityId: 't1',
        ipAddress: '127.0.0.1',
        userAgent: 'PowerBI',
        createdAt: new Date(),
      },
    ])
    const res = await entitySetGET(
      makeReq('https://x.com/api/v2/odata/AuditEvents?$top=1&$orderby=createdAt%20desc'),
      { params: Promise.resolve({ entitySet: 'AuditEvents' }) },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { value: Array<Record<string, unknown>> }
    expect(body.value[0].action).toBe('task.created')
  })

  it('entity set inválido devuelve 404 con código NOT_FOUND', async () => {
    const res = await entitySetGET(
      makeReq('https://x.com/api/v2/odata/Unknown'),
      { params: Promise.resolve({ entitySet: 'Unknown' }) },
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('NOT_FOUND')
  })
})
