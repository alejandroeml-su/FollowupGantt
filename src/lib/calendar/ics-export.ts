import 'server-only'

/**
 * Wave P8 · Equipo P8-5 — Export universal en formato iCalendar (RFC 5545).
 *
 * Sirve dos propósitos:
 *   1. Endpoint público `/api/calendar/ics/[token]` que cualquier cliente
 *      puede subscribir (Apple Calendar, Thunderbird, Outlook ICS feeds,
 *      Google Calendar "From URL"). Sin OAuth, sin push: el cliente
 *      sondea cada N minutos según su política.
 *   2. Botón de descarga "Exportar como .ics" que devuelve el mismo
 *      contenido como blob descargable (usado en Settings/Calendar).
 *
 * Decisiones:
 *   - NO añadimos `ical-generator`: el formato es texto plano simple,
 *     mantenemos el módulo zero-deps para reducir bundle + auditoría.
 *   - Folding de líneas a 75 octetos según RFC 5545 §3.1. Usamos el
 *     algoritmo conservador (75 chars + CRLF + space).
 *   - PRODID con dominio `followupgantt.avante.com` para distinguir
 *     nuestros eventos del feed de otros sistemas.
 *   - Cada VEVENT emite UID estable: `{token}-{taskId}-{type}` para que
 *     el cliente no duplique al re-bajar el feed.
 *   - DTSTAMP: timestamp del momento de generación (UTC).
 */

import prisma from '@/lib/prisma'
import { collectSyncableItems, type SyncableItem } from '@/lib/calendar/sync-engine'

export interface IcsExportOptions {
  /** Si lo pasas, override del "ahora" para tests deterministas. */
  now?: () => Date
  prismaClient?: typeof prisma
}

export interface IcsExportResult {
  /** Cuerpo ICS completo (texto plano con CRLF). */
  body: string
  /** Cantidad de VEVENTs emitidos. Útil para logging/observabilidad. */
  eventCount: number
}

const CRLF = '\r\n'

/**
 * RFC 5545 §3.1: las líneas no deben exceder 75 octetos. Si lo hacen,
 * se "doblan" insertando CRLF + un espacio (continuation). Usamos chars
 * en vez de octetos: aceptable para texto ASCII (nuestros TÍtulos los
 * normalizamos arriba).
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line
  const parts: string[] = []
  let remaining = line
  parts.push(remaining.slice(0, 75))
  remaining = remaining.slice(75)
  while (remaining.length > 0) {
    parts.push(' ' + remaining.slice(0, 74))
    remaining = remaining.slice(74)
  }
  return parts.join(CRLF)
}

/**
 * Escapa caracteres reservados en valores TEXT (RFC 5545 §3.3.11):
 * comma, semicolon, backslash, newline → secuencias `\,` `\;` `\\` `\n`.
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

/**
 * Formato DATE-TIME UTC: `YYYYMMDDTHHMMSSZ`.
 */
export function formatIcsDateTime(d: Date): string {
  const iso = d.toISOString() // 2026-05-04T12:00:00.000Z
  // Quitar guiones, dos puntos, milisegundos.
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Formato DATE (all-day): `YYYYMMDD`.
 */
export function formatIcsDate(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

/**
 * Construye un VEVENT individual. Items con `type='milestone'` o
 * `type='deadline'` se emiten como all-day (DATE), sprints como bloque
 * con horas (DATE-TIME).
 */
export function buildVEvent(
  item: SyncableItem,
  options: { uid: string; dtstamp: Date },
): string {
  const allDay = item.type === 'milestone' || item.type === 'deadline'
  const lines: string[] = ['BEGIN:VEVENT']
  lines.push(foldLine(`UID:${escapeIcsText(options.uid)}`))
  lines.push(`DTSTAMP:${formatIcsDateTime(options.dtstamp)}`)

  if (allDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(item.startsAt)}`)
    // RFC 5545: end exclusivo. Para evento puntual de un día, end = start + 1 día.
    const endExclusive = new Date(item.endsAt.getTime() + 24 * 60 * 60 * 1000)
    lines.push(`DTEND;VALUE=DATE:${formatIcsDate(endExclusive)}`)
  } else {
    lines.push(`DTSTART:${formatIcsDateTime(item.startsAt)}`)
    lines.push(`DTEND:${formatIcsDateTime(item.endsAt)}`)
  }

  lines.push(foldLine(`SUMMARY:${escapeIcsText(item.title)}`))
  lines.push(
    foldLine(
      `DESCRIPTION:${escapeIcsText(`FollowupGantt · tipo=${item.type}`)}`,
    ),
  )
  lines.push('END:VEVENT')
  return lines.join(CRLF)
}

/**
 * Genera el cuerpo ICS completo dado un array de items. Exportado para
 * facilitar tests sin BD.
 */
export function buildIcsBody(
  items: SyncableItem[],
  options: { feedToken: string; dtstamp: Date },
): IcsExportResult {
  const header = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FollowupGantt//Calendar Sync P8-5//ES',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText('FollowupGantt — eventos del proyecto')}`,
    'CALSCALE:GREGORIAN',
  ].join(CRLF)

  const events = items.map((item, idx) => {
    const taskKey = item.taskId ?? `noid-${idx}`
    const uid = `${options.feedToken}-${taskKey}-${item.type}@followupgantt.avante.com`
    return buildVEvent(item, { uid, dtstamp: options.dtstamp })
  })

  const footer = 'END:VCALENDAR'

  return {
    body: [header, ...events, footer].join(CRLF) + CRLF,
    eventCount: events.length,
  }
}

/**
 * Punto de entrada principal del endpoint público.
 *   1. Resuelve la conexión por `icsToken`.
 *   2. Recolecta items syncables del usuario.
 *   3. Devuelve el ICS body + count.
 *
 * Si el token no existe o `syncEnabled=false`, devuelve un calendario
 * vacío (header+footer) sin lanzar — evita filtrar información de
 * existencia de tokens vía status codes.
 */
export async function generateIcsForToken(
  icsToken: string,
  options: IcsExportOptions = {},
): Promise<IcsExportResult> {
  const prismaClient = options.prismaClient ?? prisma
  const dtstamp = (options.now ?? (() => new Date()))()

  const connection = await prismaClient.calendarConnection.findUnique({
    where: { icsToken },
    select: {
      id: true,
      userId: true,
      syncEnabled: true,
      syncMilestones: true,
      syncDeadlines: true,
      syncSprints: true,
    },
  })

  if (!connection || !connection.syncEnabled) {
    return buildIcsBody([], { feedToken: icsToken, dtstamp })
  }

  // Detectar acceso admin para incluir todos los proyectos.
  const userRoles = await prismaClient.userRole.findMany({
    where: { userId: connection.userId },
    select: { role: { select: { name: true } } },
  })
  const isAdmin = userRoles.some(
    (r) =>
      r.role.name === 'SUPER_ADMIN' ||
      r.role.name === 'ADMIN' ||
      r.role.name === 'admin',
  )

  let projectIds: string[] | null = null
  if (!isAdmin) {
    const assignments = await prismaClient.projectAssignment.findMany({
      where: { userId: connection.userId },
      select: { projectId: true },
    })
    projectIds = assignments.map((a) => a.projectId)
  }

  const items = await collectSyncableItems(prismaClient, {
    projectIds,
    syncMilestones: connection.syncMilestones,
    syncDeadlines: connection.syncDeadlines,
    syncSprints: connection.syncSprints,
    userId: connection.userId,
  })

  return buildIcsBody(items, { feedToken: icsToken, dtstamp })
}
