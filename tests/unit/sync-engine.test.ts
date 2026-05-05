import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Wave P8 · Equipo P8-5 — Tests del motor de sync-engine.
 *
 * Cubre:
 *   - collectSyncableItems respeta toggles (milestones/deadlines/sprints).
 *   - syncOneConnection refresca tokens expirados antes de upsert.
 *   - syncOneConnection es idempotente (busca CalendarEvent previo →
 *     pasa externalEventId al provider).
 *   - syncOneConnection aísla fallos per-item (un fallo no rompe el batch).
 *   - ICS provider no llama a APIs externas.
 *   - runSyncForUser actualiza lastSyncAt + persiste tokens refrescados.
 *   - runSyncForAll itera distinct users y aísla fallos per-user.
 *
 * Se inyecta un `prismaClient` y `google`/`microsoft` mockeados — NO
 * tocamos la BD real ni la red.
 */

vi.mock('server-only', () => ({}))

import {
  collectSyncableItems,
  syncOneConnection,
  runSyncForUser,
  runSyncForAll,
  type SyncDependencies,
} from '@/lib/calendar/sync-engine'

interface MockPrisma {
  task: { findMany: ReturnType<typeof vi.fn> }
  sprint: { findMany: ReturnType<typeof vi.fn> }
  user: { findUnique: ReturnType<typeof vi.fn> }
  calendarConnection: {
    findMany: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  calendarEvent: {
    findFirst: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
  }
  projectAssignment: { findMany: ReturnType<typeof vi.fn> }
}

function makePrisma(): MockPrisma {
  return {
    task: { findMany: vi.fn().mockResolvedValue([]) },
    sprint: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findUnique: vi.fn() },
    calendarConnection: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    calendarEvent: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    projectAssignment: { findMany: vi.fn().mockResolvedValue([]) },
  }
}

function makeGoogleMock() {
  return {
    upsertEvent: vi
      .fn()
      .mockResolvedValue({ externalEventId: 'gevt-1', updated: false }),
    deleteEvent: vi.fn().mockResolvedValue({ removed: true }),
    refreshAccessToken: vi.fn().mockResolvedValue({
      accessToken: 'new-token',
      expiresAt: new Date('2099-01-01'),
    }),
    isAccessTokenExpired: vi.fn().mockReturnValue(false),
  }
}

function makeMicrosoftMock() {
  return {
    upsertEvent: vi
      .fn()
      .mockResolvedValue({ externalEventId: 'mevt-1', updated: false }),
    deleteEvent: vi.fn().mockResolvedValue({ removed: true }),
    refreshAccessToken: vi.fn().mockResolvedValue({
      accessToken: 'ms-new',
      expiresAt: new Date('2099-01-01'),
    }),
    isAccessTokenExpired: vi.fn().mockReturnValue(false),
  }
}

let prismaMock: MockPrisma
let googleMock: ReturnType<typeof makeGoogleMock>
let microsoftMock: ReturnType<typeof makeMicrosoftMock>
let deps: SyncDependencies

beforeEach(() => {
  prismaMock = makePrisma()
  googleMock = makeGoogleMock()
  microsoftMock = makeMicrosoftMock()
  deps = {
    prismaClient: prismaMock as unknown as never,
    google: googleMock,
    microsoft: microsoftMock,
    now: () => new Date('2026-05-04T12:00:00.000Z'),
  }
})

describe('collectSyncableItems', () => {
  it('1. respeta syncMilestones=false (no consulta milestones)', async () => {
    await collectSyncableItems(prismaMock as unknown as never, {
      projectIds: ['p1'],
      syncMilestones: false,
      syncDeadlines: false,
      syncSprints: false,
      userId: 'u1',
    })
    expect(prismaMock.task.findMany).not.toHaveBeenCalled()
    expect(prismaMock.sprint.findMany).not.toHaveBeenCalled()
  })

  it('2. recolecta milestones + deadlines + sprints según toggles', async () => {
    prismaMock.task.findMany
      // milestones
      .mockResolvedValueOnce([
        {
          id: 't-m1',
          title: 'Hito 1',
          startDate: new Date('2026-05-10'),
          endDate: new Date('2026-05-10'),
        },
      ])
      // deadlines
      .mockResolvedValueOnce([
        {
          id: 't-d1',
          title: 'Entregar reporte',
          hardDeadline: new Date('2026-05-20'),
        },
      ])
    prismaMock.sprint.findMany.mockResolvedValueOnce([
      {
        id: 's-1',
        name: 'Sprint 12',
        startDate: new Date('2026-05-01'),
        endDate: new Date('2026-05-14'),
      },
    ])

    const items = await collectSyncableItems(prismaMock as unknown as never, {
      projectIds: ['p1'],
      syncMilestones: true,
      syncDeadlines: true,
      syncSprints: true,
      userId: 'u1',
    })

    expect(items).toHaveLength(3)
    expect(items.find((i) => i.type === 'milestone')?.title).toContain('Hito 1')
    expect(items.find((i) => i.type === 'deadline')?.title).toContain(
      'Entregar reporte',
    )
    expect(items.find((i) => i.type === 'sprint')?.title).toContain(
      'Sprint 12',
    )
  })

  it('3. projectIds=null (admin) NO filtra por proyecto', async () => {
    prismaMock.task.findMany.mockResolvedValue([])
    await collectSyncableItems(prismaMock as unknown as never, {
      projectIds: null,
      syncMilestones: true,
      syncDeadlines: false,
      syncSprints: false,
      userId: 'admin',
    })
    const callArg = prismaMock.task.findMany.mock.calls[0]?.[0] as {
      where?: { projectId?: unknown }
    }
    // No debe haber filtro de projectId
    expect(callArg.where?.projectId).toBeUndefined()
  })
})

describe('syncOneConnection', () => {
  const baseConn = {
    id: 'c1',
    userId: 'u1',
    provider: 'GOOGLE' as const,
    accessToken: 'token-valid',
    refreshToken: 'refresh-1',
    expiresAt: new Date('2099-01-01'),
    externalId: null,
    syncEnabled: true,
    syncMilestones: true,
    syncDeadlines: true,
    syncSprints: false,
  }

  it('4. llama upsert Google con externalEventId previo cuando existe', async () => {
    prismaMock.calendarEvent.findFirst.mockResolvedValueOnce({
      externalEventId: 'gevt-prev',
    })

    const items = [
      {
        taskId: 't1',
        type: 'milestone' as const,
        title: 'M',
        startsAt: new Date('2026-05-10'),
        endsAt: new Date('2026-05-10'),
      },
    ]
    await syncOneConnection(prismaMock as unknown as never, baseConn, items, deps)

    expect(googleMock.upsertEvent).toHaveBeenCalledTimes(1)
    const arg = googleMock.upsertEvent.mock.calls[0]?.[1] as {
      externalEventId: string | null
    }
    expect(arg.externalEventId).toBe('gevt-prev')
  })

  it('5. refresca token si el access token está expirado', async () => {
    googleMock.isAccessTokenExpired.mockReturnValue(true)
    googleMock.refreshAccessToken.mockResolvedValue({
      accessToken: 'fresh-token',
      expiresAt: new Date('2099-12-31'),
    })

    const items = [
      {
        taskId: 't1',
        type: 'milestone' as const,
        title: 'M',
        startsAt: new Date('2026-05-10'),
        endsAt: new Date('2026-05-10'),
      },
    ]
    const out = await syncOneConnection(
      prismaMock as unknown as never,
      baseConn,
      items,
      deps,
    )

    expect(googleMock.refreshAccessToken).toHaveBeenCalledWith('refresh-1')
    expect(googleMock.upsertEvent).toHaveBeenCalledWith(
      'fresh-token',
      expect.any(Object),
    )
    expect(out.refreshedAccessToken).toBe('fresh-token')
  })

  it('6. expirado sin refresh_token → falla todos los items', async () => {
    googleMock.isAccessTokenExpired.mockReturnValue(true)
    const conn = { ...baseConn, refreshToken: null }
    const items = [
      {
        taskId: 't1',
        type: 'milestone' as const,
        title: 'M',
        startsAt: new Date('2026-05-10'),
        endsAt: new Date('2026-05-10'),
      },
    ]
    const { result } = await syncOneConnection(
      prismaMock as unknown as never,
      conn,
      items,
      deps,
    )
    expect(result.itemsFailed).toBe(1)
    expect(result.errors[0]?.message).toContain('refresh_token')
    expect(googleMock.upsertEvent).not.toHaveBeenCalled()
  })

  it('7. fallo de upsert per-item se aísla (sigue con los demás)', async () => {
    googleMock.upsertEvent
      .mockRejectedValueOnce(new Error('[CALENDAR_GOOGLE_ERROR] 500'))
      .mockResolvedValueOnce({ externalEventId: 'gevt-2', updated: false })
    const items = [
      {
        taskId: 't1',
        type: 'milestone' as const,
        title: 'M1',
        startsAt: new Date('2026-05-10'),
        endsAt: new Date('2026-05-10'),
      },
      {
        taskId: 't2',
        type: 'milestone' as const,
        title: 'M2',
        startsAt: new Date('2026-05-11'),
        endsAt: new Date('2026-05-11'),
      },
    ]
    const { result } = await syncOneConnection(
      prismaMock as unknown as never,
      baseConn,
      items,
      deps,
    )
    expect(result.itemsConsidered).toBe(2)
    expect(result.itemsUpserted).toBe(1)
    expect(result.itemsFailed).toBe(1)
    expect(result.errors).toHaveLength(1)
  })

  it('8. provider ICS no llama a APIs externas, solo registra audit log', async () => {
    const conn = { ...baseConn, provider: 'ICS' as const }
    const items = [
      {
        taskId: 't1',
        type: 'milestone' as const,
        title: 'M',
        startsAt: new Date('2026-05-10'),
        endsAt: new Date('2026-05-10'),
      },
    ]
    await syncOneConnection(prismaMock as unknown as never, conn, items, deps)
    expect(googleMock.upsertEvent).not.toHaveBeenCalled()
    expect(microsoftMock.upsertEvent).not.toHaveBeenCalled()
    expect(prismaMock.calendarEvent.create).toHaveBeenCalledTimes(1)
  })

  it('9. provider Microsoft usa microsoft.upsertEvent (no Google)', async () => {
    const conn = { ...baseConn, provider: 'MICROSOFT' as const }
    const items = [
      {
        taskId: 't1',
        type: 'deadline' as const,
        title: 'D',
        startsAt: new Date('2026-05-10'),
        endsAt: new Date('2026-05-10'),
      },
    ]
    await syncOneConnection(prismaMock as unknown as never, conn, items, deps)
    expect(microsoftMock.upsertEvent).toHaveBeenCalledTimes(1)
    expect(googleMock.upsertEvent).not.toHaveBeenCalled()
  })
})

describe('runSyncForUser', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1',
      roles: [],
    })
  })

  it('10. lanza si el user no existe', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null)
    await expect(runSyncForUser('u-missing', deps)).rejects.toThrow(
      /CALENDAR_SYNC_USER_NOT_FOUND/,
    )
  })

  it('11. devuelve summary vacío si no hay conexiones', async () => {
    prismaMock.calendarConnection.findMany.mockResolvedValueOnce([])
    const out = await runSyncForUser('u1', deps)
    expect(out.totalConnections).toBe(0)
    expect(out.results).toEqual([])
  })

  it('12. actualiza lastSyncAt y persiste tokens refrescados', async () => {
    prismaMock.calendarConnection.findMany.mockResolvedValueOnce([
      {
        id: 'c1',
        userId: 'u1',
        provider: 'GOOGLE',
        accessToken: 'old',
        refreshToken: 'r1',
        expiresAt: new Date('2020-01-01'), // expirado
        externalId: null,
        syncEnabled: true,
        syncMilestones: false,
        syncDeadlines: false,
        syncSprints: false,
      },
    ])
    googleMock.isAccessTokenExpired.mockReturnValue(true)
    googleMock.refreshAccessToken.mockResolvedValue({
      accessToken: 'fresh',
      expiresAt: new Date('2099-01-01'),
    })
    prismaMock.projectAssignment.findMany.mockResolvedValue([
      { projectId: 'p1' },
    ])

    await runSyncForUser('u1', deps)

    expect(prismaMock.calendarConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({
          accessToken: 'fresh',
        }),
      }),
    )
  })

  it('13. usuario admin (SUPER_ADMIN) NO consulta projectAssignments', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'admin',
      roles: [{ role: { name: 'SUPER_ADMIN' } }],
    })
    prismaMock.calendarConnection.findMany.mockResolvedValueOnce([
      {
        id: 'c1',
        userId: 'admin',
        provider: 'GOOGLE',
        accessToken: 'tok',
        refreshToken: 'r',
        expiresAt: new Date('2099-01-01'),
        externalId: null,
        syncEnabled: true,
        syncMilestones: false,
        syncDeadlines: false,
        syncSprints: false,
      },
    ])
    await runSyncForUser('admin', deps)
    expect(prismaMock.projectAssignment.findMany).not.toHaveBeenCalled()
  })
})

describe('runSyncForAll', () => {
  it('14. itera distinct users y suma totales', async () => {
    prismaMock.calendarConnection.findMany.mockResolvedValueOnce([
      { userId: 'u1' },
      { userId: 'u2' },
    ])
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ id: 'u1', roles: [] })
      .mockResolvedValueOnce({ id: 'u2', roles: [] })
    // No connections per user → 0 upserted, 0 failed.
    prismaMock.calendarConnection.findMany.mockResolvedValue([])

    const out = await runSyncForAll(deps)
    expect(out.usersProcessed).toBe(2)
    expect(out.perUser).toHaveLength(2)
  })

  it('15. aísla fallos per-user (uno falla, otro sigue)', async () => {
    prismaMock.calendarConnection.findMany.mockResolvedValueOnce([
      { userId: 'u-bad' },
      { userId: 'u-good' },
    ])
    prismaMock.user.findUnique
      .mockResolvedValueOnce(null) // u-bad → CALENDAR_SYNC_USER_NOT_FOUND
      .mockResolvedValueOnce({ id: 'u-good', roles: [] })
    prismaMock.calendarConnection.findMany.mockResolvedValue([])

    const out = await runSyncForAll(deps)
    expect(out.usersProcessed).toBe(2)
    expect(out.totalFailed).toBeGreaterThanOrEqual(1)
  })
})
