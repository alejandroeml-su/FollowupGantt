'use client'

/**
 * Ola P1 · Botón con icono `Bell` + badge de no-leídas.
 *
 * Comportamiento:
 *   - Al montar, hace fetch del count y la lista (las primeras 10).
 *   - Polling cada 30s para refrescar el count (P1 stretch — sin
 *     websockets). El polling se pausa cuando la pestaña está oculta
 *     (`document.visibilityState`) para no spammear cuando nadie mira.
 *   - Al click abre `NotificationsDropdown`. Click-outside cierra.
 *
 * Sin auth real: leemos al usuario "Edwin Martinez" en server (default)
 * y propagamos `userId` a las acciones. El switch a sesión real solo
 * sustituye este accesor, el resto del flujo no cambia.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { clsx } from 'clsx'
import {
  getNotificationsForCurrentUser,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  type SerializedNotification,
} from '@/lib/actions/notifications'
import { NotificationsDropdown } from './NotificationsDropdown'

const POLLING_INTERVAL_MS = 30_000

type Props = {
  /** Permite forzar el polling off en tests/Storybook. */
  enablePolling?: boolean
  /** Inyectable para tests: si se provee, omite la primera llamada a getUnreadCount. */
  initialCount?: number
  /** Compactar el botón cuando el sidebar está colapsado. */
  collapsed?: boolean
}

export function NotificationsBell({
  enablePolling = true,
  initialCount,
  collapsed = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState<number>(initialCount ?? 0)
  const [items, setItems] = useState<SerializedNotification[]>([])
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const refreshCount = useCallback(async () => {
    try {
      const c = await getUnreadCount()
      setCount(c)
    } catch (err) {
      console.error('[NotificationsBell] count', err)
    }
  }, [])

  const refreshList = useCallback(async () => {
    setLoading(true)
    try {
      const list = await getNotificationsForCurrentUser({ limit: 10 })
      setItems(list)
      // Recalcular count desde la lista para el caso "miss del cache".
      setCount(list.filter((n) => !n.readAt).length)
    } catch (err) {
      console.error('[NotificationsBell] list', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // Carga inicial del count si no nos lo pasaron.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (initialCount === undefined) refreshCount()
  }, [initialCount, refreshCount])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Polling 30s (pausa cuando la pestaña está oculta).
  useEffect(() => {
    if (!enablePolling) return
    let timer: ReturnType<typeof setInterval> | null = null

    function start(): void {
      if (timer) return
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') {
          refreshCount()
        }
      }, POLLING_INTERVAL_MS)
    }
    function stop(): void {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }
    function onVisibility(): void {
      if (document.visibilityState === 'visible') {
        refreshCount()
        start()
      } else {
        stop()
      }
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enablePolling, refreshCount])

  // Cuando se abre el panel, recargamos la lista (single source of truth).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) refreshList()
  }, [open, refreshList])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Click outside.
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent): void {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onEsc(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  async function handleMarkOne(id: string): Promise<void> {
    // Optimistic update — el server lo confirma luego.
    setItems((prev) =>
      prev.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)),
    )
    setCount((c) => Math.max(0, c - 1))
    try {
      await markNotificationRead(id)
    } catch (err) {
      console.error('[NotificationsBell] markOne', err)
      // Revertir: re-fetch consistente.
      await refreshList()
    }
  }

  async function handleMarkAll(): Promise<void> {
    const previousItems = items
    const previousCount = count
    setItems((prev) =>
      prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })),
    )
    setCount(0)
    try {
      await markAllNotificationsRead()
    } catch (err) {
      console.error('[NotificationsBell] markAll', err)
      setItems(previousItems)
      setCount(previousCount)
    }
  }

  const badge = count > 99 ? '99+' : String(count)

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          count > 0
            ? `Notificaciones (${count} sin leer)`
            : 'Notificaciones'
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="notifications-bell"
        className={clsx(
          'relative inline-flex items-center justify-center rounded-lg p-2 text-muted-foreground transition-all hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40',
          collapsed ? 'h-9 w-9' : 'h-9 w-9',
        )}
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {count > 0 && (
          <span
            data-testid="notifications-bell-badge"
            className={clsx(
              'absolute -right-0.5 -top-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-[18px] text-white shadow-sm ring-2 ring-card',
              count > 99 && 'min-w-[26px]',
            )}
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <NotificationsDropdown
          items={items}
          loading={loading}
          unreadCount={count}
          onClose={() => setOpen(false)}
          onMarkOne={handleMarkOne}
          onMarkAll={handleMarkAll}
        />
      )}
    </div>
  )
}
