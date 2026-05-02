'use client'

/**
 * Ola P1 · Dropdown de notificaciones (lista + acciones).
 *
 * Renderiza:
 *   - Header con título "Notificaciones" + botón "Marcar todas leídas"
 *     (deshabilitado si no hay no-leídas).
 *   - Lista de hasta 10 últimas. Cada item es clickable: navega al
 *     `link` y marca como leída.
 *   - Empty state "Sin notificaciones".
 *   - Footer con link "Ver todas" → /notifications.
 *
 * No hace fetch propio: recibe `items` y callbacks desde el `Bell`.
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AtSign,
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
import type { SerializedNotification } from '@/lib/actions/notifications'

type Props = {
  items: SerializedNotification[]
  loading: boolean
  unreadCount: number
  onClose: () => void
  onMarkOne: (id: string) => Promise<void> | void
  onMarkAll: () => Promise<void> | void
}

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

export function NotificationsDropdown({
  items,
  loading,
  unreadCount,
  onClose,
  onMarkOne,
  onMarkAll,
}: Props) {
  const router = useRouter()

  function handleItemClick(n: SerializedNotification): void {
    if (!n.readAt) void onMarkOne(n.id)
    if (n.link) {
      router.push(n.link)
      onClose()
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Centro de notificaciones"
      data-testid="notifications-dropdown"
      className="absolute right-0 top-full z-50 mt-2 w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card shadow-2xl ring-1 ring-black/5"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Notificaciones</h2>
          {unreadCount > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {unreadCount} sin leer
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void onMarkAll()}
          disabled={unreadCount === 0}
          className={clsx(
            'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
            unreadCount === 0
              ? 'cursor-not-allowed text-muted-foreground/50'
              : 'text-primary hover:bg-primary/10',
          )}
          data-testid="notifications-mark-all"
        >
          <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Marcar como leídas
        </button>
      </div>

      <div className="max-h-[420px] overflow-y-auto custom-scrollbar">
        {loading && items.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Cargando...
          </div>
        ) : items.length === 0 ? (
          <div
            className="px-4 py-10 text-center text-sm text-muted-foreground"
            data-testid="notifications-empty"
          >
            Sin notificaciones
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((n) => {
              const Icon = iconFor(n.type)
              const isUnread = !n.readAt
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleItemClick(n)}
                    className={clsx(
                      'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50 focus:bg-accent/50 focus:outline-none',
                      isUnread && 'bg-primary/5',
                    )}
                    data-testid="notifications-item"
                    data-unread={isUnread ? 'true' : 'false'}
                  >
                    <div
                      className={clsx(
                        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
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
                      <p className="mt-0.5 truncate text-sm font-medium text-foreground">
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">
                          {n.body}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground/70">
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

      <div className="border-t border-border bg-muted/20 px-4 py-2 text-center">
        <Link
          href="/notifications"
          onClick={onClose}
          className="text-[12px] font-medium text-primary hover:underline"
          data-testid="notifications-view-all"
        >
          Ver todas las notificaciones
        </Link>
      </div>
    </div>
  )
}
