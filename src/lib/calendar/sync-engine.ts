import 'server-only'

/**
 * Wave P8 · Equipo P8-5 — Motor de sincronización a Google Calendar /
 * Microsoft Graph.
 *
 * Responsabilidad:
 *   - Recolectar items syncables del usuario (milestones, hard
 *     deadlines, sprints) según los toggles de su `CalendarConnection`.
 *   - Para cada item: invocar el wrapper del provider correspondiente
 *     y persistir el resultado en `CalendarEvent` (audit log + base
 *     para idempotencia futura).
 *
 * Decisiones:
 *   - Solo proyectos accesibles: filtramos por `ProjectAssignment`
 *     (mismos criterios que `requireProjectAccess`). Admins ven todo.
 *   - One-way: nunca leemos eventos del provider. Si el usuario borra
 *     manualmente un evento en Google, NO lo recreamos hasta el
 *     próximo cambio del item interno.
 *   - Errores per-item: si una API call falla, registramos el error y
 *     seguimos con el siguiente. El sumario final reporta éxitos +
 *     fallos para que el cron observability pueda alertar.
 *   - Si `CalendarConnection.provider === 'ICS'`, esta función NO
 *     llama a APIs externas: el feed ICS se genera on-demand desde
 *     `ics-export.ts` cuando un cliente subscribe el endpoint público.
 *
 * Inyección para tests: `runSyncForUser` acepta un `deps` opcional con
 * mocks de los wrappers Google/MS y `prismaClient` para evitar tocar
 * red/BD reales en unit tests.
 */

import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import {
  upsertEvent as upsertGoogleEvent,
  deleteEvent as deleteGoogleEvent,
  refreshAccessToken as refreshGoogleToken,
  isAccessTokenExpired as isGoogleTokenExpired,
} from '@/lib/calendar/google-client'
import {
  upsertEvent as upsertMicrosoftEvent,
  deleteEvent as deleteMicrosoftEvent,
  refreshAccessToken as refreshMicrosoftToken,
  isAccessTokenExpired as isMicrosoftTokenExpired,
} from '@/lib/calendar/microsoft-client'

export type SyncItemType = 'milestone' | 'deadline' | 'sprint'

export interface SyncableItem {
  taskId: string | null
  type: SyncItemType
  title: string
  startsAt: Date
  endsAt: Date
}

export interface SyncResult {
  connectionId: string
  provider: 'GOOGLE' | 'MICROSOFT' | 'ICS'
  itemsConsidered: number
  itemsUpserted: number
  itemsFailed: number
  errors: Array<{ taskId: string | null; message: string }>
}

export interface RunSyncSummary {
  userId: string
  totalConnections: number
  totalUpserted: number
  totalFailed: number
  results: SyncResult[]
}

export type GoogleClientLike = {
  upsertEvent: typeof upsertGoogleEvent
  deleteEvent: typeof deleteGoogleEvent
  refreshAccessToken: typeof refreshGoogleToken
  isAccessTokenExpired: typeof isGoogleTokenExpired
}

export type MicrosoftClientLike = {
  upsertEvent: typeof upsertMicrosoftEvent
  deleteEvent: typeof deleteMicrosoftEvent
  refreshAccessToken: typeof refreshMicrosoftToken
  isAccessTokenExpired: typeof isMicrosoftTokenExpired
}

export interface SyncDependencies {
  prismaClient?: typeof prisma
  google?: GoogleClientLike
  microsoft?: MicrosoftClientLike
  /** Override del "ahora" para tests deterministas. */
  now?: () => Date
}

const DEFAULT_GOOGLE: GoogleClientLike = {
  upsertEvent: upsertGoogleEvent,
  deleteEvent: deleteGoogleEvent,
  refreshAccessToken: refreshGoogleToken,
  isAccessTokenExpired: isGoogleTokenExpired,
}

const DEFAULT_MICROSOFT: MicrosoftClientLike = {
  upsertEvent: upsertMicrosoftEvent,
  deleteEvent: deleteMicrosoftEvent,
  refreshAccessToken: refreshMicrosoftToken,
  isAccessTokenExpired: isMicrosoftTokenExpired,
}

/**
 * Devuelve los projectIds accesibles por el usuario. Si es admin
 * (`isAdmin=true`) devuelve null = "todos".
 */
async function listAccessibleProjectIds(
  prismaClient: typeof prisma,
  userId: string,
  isAdmin: boolean,
): Promise<string[] | null> {
  if (isAdmin) return null
  const rows = await prismaClient.projectAssignment.findMany({
    where: { userId },
    select: { projectId: true },
  })
  return rows.map((r) => r.projectId)
}

/**
 * Recolecta milestones / deadlines / sprints según los toggles de la
 * conexión. Exportado para que los tests puedan aislar la query.
 */
export async function collectSyncableItems(
  prismaClient: typeof prisma,
  options: {
    projectIds: string[] | null
    syncMilestones: boolean
    syncDeadlines: boolean
    syncSprints: boolean
    userId: string
  },
): Promise<SyncableItem[]> {
  const { projectIds, syncMilestones, syncDeadlines, syncSprints, userId } =
    options
  const items: SyncableItem[] = []

  // Helpers de filtro: si projectIds === null el usuario es admin → no
  // filtramos por proyecto. Si es array vacío → cero acceso.
  const projectFilter: Prisma.TaskWhereInput =
    projectIds === null
      ? {}
      : { projectId: { in: projectIds.length > 0 ? projectIds : ['__none__'] } }

  if (syncMilestones) {
    const milestones = await prismaClient.task.findMany({
      where: {
        ...projectFilter,
        isMilestone: true,
        archivedAt: null,
        OR: [{ assigneeId: userId }, { collaborators: { some: { userId } } }],
        endDate: { not: null },
      },
      select: {
        id: true,
        title: true,
        startDate: true,
        endDate: true,
      },
      take: 500,
    })
    for (const t of milestones) {
      const endDate = t.endDate
      if (!endDate) continue
      const startDate = t.startDate ?? endDate
      items.push({
        taskId: t.id,
        type: 'milestone',
        title: `[Milestone] ${t.title}`,
        startsAt: startDate,
        endsAt: endDate,
      })
    }
  }

  if (syncDeadlines) {
    const deadlines = await prismaClient.task.findMany({
      where: {
        ...projectFilter,
        hardDeadline: { not: null },
        archivedAt: null,
        OR: [{ assigneeId: userId }, { collaborators: { some: { userId } } }],
      },
      select: {
        id: true,
        title: true,
        hardDeadline: true,
      },
      take: 500,
    })
    for (const t of deadlines) {
      const dl = t.hardDeadline
      if (!dl) continue
      items.push({
        taskId: t.id,
        type: 'deadline',
        title: `[Deadline] ${t.title}`,
        startsAt: dl,
        endsAt: dl,
      })
    }
  }

  if (syncSprints) {
    const sprintFilter: Prisma.SprintWhereInput =
      projectIds === null
        ? {}
        : { projectId: { in: projectIds.length > 0 ? projectIds : ['__none__'] } }
    const sprints = await prismaClient.sprint.findMany({
      where: sprintFilter,
      select: {
        id: true,
        name: true,
        startDate: true,
        endDate: true,
      },
      take: 200,
    })
    for (const s of sprints) {
      if (!s.startDate || !s.endDate) continue
      items.push({
        taskId: s.id,
        type: 'sprint',
        title: `[Sprint] ${s.name}`,
        startsAt: s.startDate,
        endsAt: s.endDate,
      })
    }
  }

  return items
}

interface ConnectionWithEvents {
  id: string
  userId: string
  provider: 'GOOGLE' | 'MICROSOFT' | 'ICS'
  accessToken: string | null
  refreshToken: string | null
  expiresAt: Date | null
  externalId: string | null
  syncEnabled: boolean
  syncMilestones: boolean
  syncDeadlines: boolean
  syncSprints: boolean
}

/**
 * Sincroniza UNA conexión. Devuelve el resultado per-connection. NO
 * persiste tokens refrescados — eso lo hace `runSyncForUser` mediante
 * `prismaClient.calendarConnection.update`.
 */
export async function syncOneConnection(
  prismaClient: typeof prisma,
  connection: ConnectionWithEvents,
  items: SyncableItem[],
  deps: SyncDependencies = {},
): Promise<{
  result: SyncResult
  refreshedAccessToken?: string
  refreshedExpiresAt?: Date
}> {
  const google = deps.google ?? DEFAULT_GOOGLE
  const microsoft = deps.microsoft ?? DEFAULT_MICROSOFT

  const result: SyncResult = {
    connectionId: connection.id,
    provider: connection.provider,
    itemsConsidered: items.length,
    itemsUpserted: 0,
    itemsFailed: 0,
    errors: [],
  }

  if (connection.provider === 'ICS') {
    // ICS no requiere push: el feed se genera on-demand al subscribir
    // el endpoint público. Aquí solo dejamos un audit-log del intento.
    for (const item of items) {
      await prismaClient.calendarEvent.create({
        data: {
          connectionId: connection.id,
          externalEventId: null,
          taskId: item.taskId,
          type: item.type,
          title: item.title,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
        },
      })
      result.itemsUpserted += 1
    }
    return { result }
  }

  // OAuth providers — refrescar token si está expirado.
  let accessToken = connection.accessToken
  let refreshedAccessToken: string | undefined
  let refreshedExpiresAt: Date | undefined

  const expiredCheck =
    connection.provider === 'GOOGLE'
      ? google.isAccessTokenExpired
      : microsoft.isAccessTokenExpired

  if (expiredCheck(connection.expiresAt)) {
    if (!connection.refreshToken) {
      result.itemsFailed = items.length
      result.errors.push({
        taskId: null,
        message: 'access token expirado y no hay refresh_token',
      })
      return { result }
    }
    try {
      const refreshFn =
        connection.provider === 'GOOGLE'
          ? google.refreshAccessToken
          : microsoft.refreshAccessToken
      const refreshed = await refreshFn(connection.refreshToken)
      accessToken = refreshed.accessToken
      refreshedAccessToken = refreshed.accessToken
      refreshedExpiresAt = refreshed.expiresAt
    } catch (err) {
      result.itemsFailed = items.length
      result.errors.push({
        taskId: null,
        message: `refresh falló: ${(err as Error).message}`,
      })
      return { result }
    }
  }

  if (!accessToken) {
    result.itemsFailed = items.length
    result.errors.push({ taskId: null, message: 'sin access token' })
    return { result, refreshedAccessToken, refreshedExpiresAt }
  }

  // Para cada item, busca audit log previo (mismo connectionId+taskId+type)
  // y hace upsert idempotente.
  for (const item of items) {
    const previous = item.taskId
      ? await prismaClient.calendarEvent.findFirst({
          where: {
            connectionId: connection.id,
            taskId: item.taskId,
            type: item.type,
          },
          orderBy: { syncedAt: 'desc' },
          select: { externalEventId: true },
        })
      : null

    try {
      let externalEventId: string
      if (connection.provider === 'GOOGLE') {
        const res = await google.upsertEvent(accessToken, {
          externalEventId: previous?.externalEventId ?? null,
          summary: item.title,
          description: `FollowupGantt · ${item.type}`,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          allDay: item.type === 'milestone' || item.type === 'deadline',
          calendarId: connection.externalId ?? undefined,
        })
        externalEventId = res.externalEventId
      } else {
        const res = await microsoft.upsertEvent(accessToken, {
          externalEventId: previous?.externalEventId ?? null,
          subject: item.title,
          bodyHtml: `<p>FollowupGantt · ${item.type}</p>`,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          allDay: item.type === 'milestone' || item.type === 'deadline',
          calendarId: connection.externalId ?? undefined,
        })
        externalEventId = res.externalEventId
      }

      await prismaClient.calendarEvent.create({
        data: {
          connectionId: connection.id,
          externalEventId,
          taskId: item.taskId,
          type: item.type,
          title: item.title,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
        },
      })
      result.itemsUpserted += 1
    } catch (err) {
      result.itemsFailed += 1
      result.errors.push({
        taskId: item.taskId,
        message: (err as Error).message,
      })
    }
  }

  return { result, refreshedAccessToken, refreshedExpiresAt }
}

/**
 * Punto de entrada principal: sincroniza todas las conexiones de un
 * usuario. Llamado por el server action manual y por el cron.
 */
export async function runSyncForUser(
  userId: string,
  deps: SyncDependencies = {},
): Promise<RunSyncSummary> {
  const prismaClient = deps.prismaClient ?? prisma
  const now = (deps.now ?? (() => new Date()))()

  const user = await prismaClient.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      roles: {
        select: { role: { select: { name: true } } },
      },
    },
  })
  if (!user) {
    throw new Error(`[CALENDAR_SYNC_USER_NOT_FOUND] userId=${userId}`)
  }

  const isAdmin = user.roles.some(
    (r) =>
      r.role.name === 'SUPER_ADMIN' ||
      r.role.name === 'ADMIN' ||
      r.role.name === 'admin',
  )

  const connections = await prismaClient.calendarConnection.findMany({
    where: { userId, syncEnabled: true },
  })

  if (connections.length === 0) {
    return {
      userId,
      totalConnections: 0,
      totalUpserted: 0,
      totalFailed: 0,
      results: [],
    }
  }

  const projectIds = await listAccessibleProjectIds(
    prismaClient,
    userId,
    isAdmin,
  )

  const summary: RunSyncSummary = {
    userId,
    totalConnections: connections.length,
    totalUpserted: 0,
    totalFailed: 0,
    results: [],
  }

  for (const conn of connections) {
    const items = await collectSyncableItems(prismaClient, {
      projectIds,
      syncMilestones: conn.syncMilestones,
      syncDeadlines: conn.syncDeadlines,
      syncSprints: conn.syncSprints,
      userId,
    })

    const { result, refreshedAccessToken, refreshedExpiresAt } =
      await syncOneConnection(prismaClient, conn, items, deps)

    // Persistir token refrescado + lastSyncAt.
    const dataToUpdate: Prisma.CalendarConnectionUpdateInput = {
      lastSyncAt: now,
    }
    if (refreshedAccessToken) {
      dataToUpdate.accessToken = refreshedAccessToken
    }
    if (refreshedExpiresAt) {
      dataToUpdate.expiresAt = refreshedExpiresAt
    }
    await prismaClient.calendarConnection.update({
      where: { id: conn.id },
      data: dataToUpdate,
    })

    summary.results.push(result)
    summary.totalUpserted += result.itemsUpserted
    summary.totalFailed += result.itemsFailed
  }

  return summary
}

/**
 * Sincroniza TODAS las conexiones habilitadas (cron). Itera por usuario
 * para no saltar políticas de acceso por proyecto. Errores per-user no
 * detienen el job global.
 */
export async function runSyncForAll(
  deps: SyncDependencies = {},
): Promise<{
  usersProcessed: number
  totalUpserted: number
  totalFailed: number
  perUser: RunSyncSummary[]
}> {
  const prismaClient = deps.prismaClient ?? prisma
  const distinctUsers = await prismaClient.calendarConnection.findMany({
    where: { syncEnabled: true },
    distinct: ['userId'],
    select: { userId: true },
  })

  const perUser: RunSyncSummary[] = []
  let totalUpserted = 0
  let totalFailed = 0

  for (const { userId } of distinctUsers) {
    try {
      const s = await runSyncForUser(userId, deps)
      perUser.push(s)
      totalUpserted += s.totalUpserted
      totalFailed += s.totalFailed
    } catch (err) {
      // Log per-user pero no rompemos el cron global.
      perUser.push({
        userId,
        totalConnections: 0,
        totalUpserted: 0,
        totalFailed: 1,
        results: [
          {
            connectionId: '',
            provider: 'GOOGLE',
            itemsConsidered: 0,
            itemsUpserted: 0,
            itemsFailed: 1,
            errors: [{ taskId: null, message: (err as Error).message }],
          },
        ],
      })
      totalFailed += 1
    }
  }

  return {
    usersProcessed: distinctUsers.length,
    totalUpserted,
    totalFailed,
    perUser,
  }
}
