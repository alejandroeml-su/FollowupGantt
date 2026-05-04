/**
 * Ola P3 · Equipo P3-2 · Página `/audit-log`.
 *
 * Server component: hace el fetch inicial (50 últimos eventos + listas de
 * actores y entityTypes para los filtros) y delega al cliente la
 * interacción (queryAuditEvents, paginación, purge, expandir filas).
 *
 * Roles: pensada para ADMIN/SUPER_ADMIN. Sin Auth real aún, el guard
 * estricto vive en el Sidebar (debug role switcher); cuando llegue Auth
 * vamos a mover el chequeo aquí con `redirect('/')` si no es admin.
 * Mientras tanto, exponemos `canPurge` en el client basado en el mismo
 * mecanismo que el Sidebar (futuro: `getCurrentUser().role`).
 */

import {
  queryAuditEvents,
  getAuditActors,
  getAuditEntityTypes,
} from '@/lib/actions/audit'
import { AuditLogClient } from '@/components/audit/AuditLogClient'

export default async function AuditLogPage() {
  // Carga paralela — todas son cacheadas con tag `audit-events` y se
  // invalidan juntas tras create/purge.
  const [eventsPage, actors, entityTypes] = await Promise.all([
    queryAuditEvents({ limit: 50 }),
    getAuditActors(),
    getAuditEntityTypes(),
  ])

  return (
    <AuditLogClient
      initialItems={eventsPage.items}
      initialNextCursor={eventsPage.nextCursor}
      actors={actors}
      entityTypes={entityTypes}
      // Hasta tener Auth real, todos los visitantes de esta página
      // (que llegan vía sidebar de SUPER_ADMIN/ADMIN) pueden purgar.
      // Cuando se conecte la sesión, leer rol real y restringir aquí.
      canPurge={true}
    />
  )
}

export const metadata = {
  title: 'Auditoría · FollowupGantt',
  description:
    'Registro centralizado de eventos del sistema (compliance ITIL/SOC2)',
}
