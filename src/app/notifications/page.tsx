import { getNotificationsForCurrentUser } from '@/lib/actions/notifications'
import { NotificationsPageClient } from './NotificationsPageClient'

/**
 * Ola P1 · Centro de notificaciones — listado completo paginado.
 *
 * Server component: hace el fetch inicial (50 últimas) y delega al
 * cliente la interacción (markRead, markAllRead). El cliente refresca
 * tras cada acción usando las server actions importadas directamente.
 *
 * Paginación: en P1 servimos hasta 50 (cap del action). Cuando el
 * volumen lo justifique, sustituir por cursor pagination.
 */
export default async function NotificationsPage() {
  const items = await getNotificationsForCurrentUser({ limit: 50 })
  return <NotificationsPageClient initialItems={items} />
}

export const metadata = {
  title: 'Notificaciones · FollowupGantt',
  description: 'Centro de notificaciones in-app',
}
