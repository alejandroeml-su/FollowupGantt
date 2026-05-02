'use client'

/**
 * Cliente de la página `/notifications`. Reusa las helpers de iconos del
 * dropdown vía import lazy (no, mejor inline para mantenerlo simple) y
 * reaplica la misma estética: bandera de no-leídas, marcar como leído,
 * tipo, fecha relativa.
 */

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AtSign,
  Bell,
  CalendarCheck,
  CheckCheck,
  FileDown,
  Flag,
  GitBranch,
  MessageCircle,
  UserPlus,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { clsx } from 'clsx'
import type { NotificationType } from '@prisma/client'
import {
  markAllNotificationsRead,
  markNotificationRead,
  type SerializedNotification,
} from '@/lib/actions/notifications'

const TYPE_LABEL: Record<NotificationType, string> = {
  MENTION: 'Mención',
  TASK_ASSIGNED: 'Asignación',
  COMMENT_REPLY: 'Respuesta',
  BASELINE_CAPTURED: 'Línea base',
  DEPENDENCY_VIOLATION: 'Dependencia',
  IMPORT_COMPLETED: 'Import',
}

function iconFor(type: NotificationType) {
  switch (type) {
    case 'MENTION':
      return AtSign
    case 'TASK_ASSIGNED':
      return UserPlus
    case 'COMMENT_REPLY':
      return MessageCircle
    case 'BASELINE_CAPTURED':
      return Flag
    case 'DEPENDENCY_VIOLATION':
      return GitBranch
    case 'IMPORT_COMPLETED':
      return FileDown
    default:
      return CalendarCheck
  }
}

function formatRelative(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: es })
  } catch {
    return iso
  }
}

type Filter = 'all' | 'unread'

type Props = {
  initialItems: SerializedNotification[]
}

export function NotificationsPageClient({ initialItems }: Props) {
  const router = useRouter()
  const [items, setItems] = useState(initialItems)
  const [filter, setFilter] = useState<Filter>('all')
  const [isPending, startTransition] = useTransition()

  const unreadCount = items.filter((n) => !n.readAt).length
  const visible = filter === 'unread' ? items.filter((n) => !n.readAt) : items

  function handleClick(n: SerializedNotification): void {
    if (!n.readAt) {
      // Optimistic.
      setItems((prev) =>
        prev.map((x) =>
          x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x,
        ),
      )
      startTransition(async () => {
        try {
          await markNotificationRead(n.id)
        } catch (err) {
          console.error('[Notifications] markRead', err)
        }
      })
    }
    if (n.link) router.push(n.link)
  }

  function handleMarkAll(): void {
    const previous = items
    setItems((prev) =>
      prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })),
    )
    startTransition(async () => {
      try {
        await markAllNotificationsRead()
      } catch (err) {
        console.error('[Notifications] markAll', err)
        setItems(previous)
      }
    })
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <header className="flex flex-col gap-3 border-b border-border bg-card px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Bell className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <h1 className="text-lg font-semibold text-foreground">Notificaciones</h1>
            <p className="text-[12px] text-muted-foreground">
              {unreadCount > 0
                ? `${unreadCount} sin leer · ${items.length} totales`
                : `${items.length} totales`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex items-center rounded-lg border border-border bg-muted/30 p-0.5 text-[12px]">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={clsx(
                'rounded-md px-3 py-1 font-medium transition-colors',
                filter === 'all'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Todas
            </button>
            <button
              type="button"
              onClick={() => setFilter('unread')}
              className={clsx(
                'rounded-md px-3 py-1 font-medium transition-colors',
                filter === 'unread'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              No leídas
              {unreadCount > 0 && (
                <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                  {unreadCount}
                </span>
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={handleMarkAll}
            disabled={unreadCount === 0 || isPending}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors',
              unreadCount === 0
                ? 'cursor-not-allowed border border-border text-muted-foreground/50'
                : 'border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20',
            )}
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Marcar como leídas
          </button>
        </div>
      </header>

      {/* List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {visible.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 py-20 text-center">
            <div>
              <Bell className="mx-auto h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-foreground">
                {filter === 'unread' ? 'No hay notificaciones sin leer' : 'Sin notificaciones'}
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Cuando alguien te mencione o se complete un import lo verás aquí.
              </p>
            </div>
          </div>
        ) : (
          <ul className="mx-auto max-w-3xl divide-y divide-border px-2 py-2 sm:px-4">
            {visible.map((n) => {
              const Icon = iconFor(n.type)
              const isUnread = !n.readAt
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleClick(n)}
                    className={clsx(
                      'flex w-full items-start gap-4 rounded-lg px-3 py-3 text-left transition-colors hover:bg-accent/50 focus:bg-accent/50 focus:outline-none',
                      isUnread && 'bg-primary/5',
                    )}
                    data-testid="notifications-page-item"
                    data-unread={isUnread ? 'true' : 'false'}
                  >
                    <div
                      className={clsx(
                        'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                        isUnread
                          ? 'bg-primary/15 text-primary'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          {TYPE_LABEL[n.type]}
                        </span>
                        {isUnread && (
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-primary"
                            aria-label="No leída"
                          />
                        )}
                      </div>
                      <p className="mt-0.5 text-sm font-medium text-foreground">
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="mt-1 text-[13px] text-muted-foreground">
                          {n.body}
                        </p>
                      )}
                      <p className="mt-1.5 text-[11px] text-muted-foreground/70">
                        {formatRelative(n.createdAt)}
                      </p>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-border bg-muted/10 px-6 py-2 text-center text-[11px] text-muted-foreground">
        <Link href="/settings" className="hover:underline">
          Preferencias de notificación
        </Link>
      </footer>
    </div>
  )
}
