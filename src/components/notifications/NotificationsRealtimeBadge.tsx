'use client'

/**
 * Wave P6 · Equipo A4 — Badge de notificaciones con counter en vivo.
 *
 * Componente standalone que el equipo del Sidebar monta dentro de su
 * propia estructura. NO toca `Sidebar.tsx`. Usa
 * `useNotificationsRealtime(userId)` para mantener el counter sincronizado
 * sin polling — cada `INSERT` en `Notification` con `readAt=null`
 * incrementa el dot.
 *
 * Animación pulse cuando llega una nueva notificación: detectamos cambios
 * en `unreadCount` (incremento) y aplicamos clase `animate-pulse` durante
 * 1.5s. La clase se quita con timeout para no quedar pulsando para
 * siempre. Respeta `prefers-reduced-motion` vía Tailwind utility.
 */

import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { clsx } from 'clsx'
import { useNotificationsRealtime } from '@/lib/realtime-notifications/use-notifications-realtime'

type Props = {
  userId: string | null | undefined
  /** Permite forzar realtime off en tests/Storybook. */
  enableRealtime?: boolean
  /** Modo compacto (Sidebar collapsed). */
  collapsed?: boolean
  className?: string
}

export function NotificationsRealtimeBadge({
  userId,
  enableRealtime = true,
  collapsed = false,
  className,
}: Props) {
  const { unreadCount, isConnected } = useNotificationsRealtime(userId, {
    enableRealtime,
    limit: 20,
  })

  const [pulsing, setPulsing] = useState(false)
  const previousCountRef = useRef<number>(unreadCount)

  useEffect(() => {
    if (unreadCount > previousCountRef.current) {
      setPulsing(true)
      const t = setTimeout(() => setPulsing(false), 1500)
      previousCountRef.current = unreadCount
      return () => clearTimeout(t)
    }
    previousCountRef.current = unreadCount
  }, [unreadCount])

  const badge = unreadCount > 99 ? '99+' : String(unreadCount)
  const hasUnread = unreadCount > 0

  return (
    <span
      data-testid="notifications-realtime-badge"
      data-connected={isConnected ? 'true' : 'false'}
      className={clsx(
        'relative inline-flex items-center justify-center',
        collapsed ? 'h-9 w-9' : 'h-9 w-9',
        className,
      )}
      aria-label={
        hasUnread
          ? `Notificaciones (${unreadCount} sin leer)`
          : 'Notificaciones'
      }
    >
      <Bell
        className={clsx(
          'h-5 w-5 text-muted-foreground',
          pulsing && 'motion-safe:animate-pulse',
        )}
        aria-hidden="true"
      />
      {hasUnread && (
        <span
          data-testid="notifications-realtime-badge-count"
          className={clsx(
            'absolute -right-0.5 -top-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-[18px] text-white shadow-sm ring-2 ring-card',
            unreadCount > 99 && 'min-w-[26px]',
            pulsing && 'motion-safe:animate-pulse',
          )}
        >
          {badge}
        </span>
      )}
    </span>
  )
}
