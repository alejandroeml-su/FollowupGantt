'use client'

/**
 * Wave P6 · Equipo A5 — banner amber/yellow que avisa qué peers están
 * editando la entidad actual. Se monta encima del form/section que envuelve
 * `<SoftLockProvider>`.
 *
 * - Strings ES profesionales.
 * - A11y: `role="status"` + `aria-live="polite"` para que el lector de
 *   pantalla anuncie el cambio sin interrumpir.
 * - Acepta hasta N usuarios (default 3 visibles + "y X más").
 */

import { Lock, X as CloseIcon } from 'lucide-react'
import { clsx } from 'clsx'
import type { EditingUser } from '@/lib/realtime-locks/types'

type Props = {
  editingUsers: EditingUser[]
  isLockedByOther: boolean
  /**
   * Si `true`, muestra el botón "Forzar edición" cuando hay lock ajeno. La
   * acción es opcional para que el caller decida si exponer el override.
   */
  onForceOverride?: () => void
  /** Callback opcional para cerrar el banner manualmente. */
  onDismiss?: () => void
  /** Cuántos avatares mostrar antes de colapsar a "+N". Default 3. */
  maxAvatars?: number
  className?: string
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function formatNameList(users: EditingUser[]): string {
  if (users.length === 0) return ''
  if (users.length === 1) return users[0].name
  if (users.length === 2) return `${users[0].name} y ${users[1].name}`
  const head = users.slice(0, users.length - 1).map((u) => u.name).join(', ')
  return `${head} y ${users[users.length - 1].name}`
}

export function EditingByBanner({
  editingUsers,
  isLockedByOther,
  onForceOverride,
  onDismiss,
  maxAvatars = 3,
  className,
}: Props) {
  if (editingUsers.length === 0) return null

  const visible = editingUsers.slice(0, maxAvatars)
  const overflow = editingUsers.length - visible.length

  return (
    <div
      data-testid="editing-by-banner"
      role="status"
      aria-live="polite"
      className={clsx(
        'flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200',
        className,
      )}
    >
      <Lock aria-hidden className="h-4 w-4 shrink-0 text-amber-300" />

      <div
        className="flex -space-x-2"
        aria-hidden
        data-testid="editing-by-banner-avatars"
      >
        {visible.map((u) => (
          <span
            key={u.id}
            title={u.name}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-amber-500/40 bg-amber-500/20 text-[10px] font-semibold text-amber-100"
            style={u.color ? { borderColor: u.color } : undefined}
          >
            {initialsOf(u.name)}
          </span>
        ))}
        {overflow > 0 && (
          <span
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-amber-500/40 bg-amber-500/20 text-[10px] font-semibold text-amber-100"
            data-testid="editing-by-banner-overflow"
          >
            +{overflow}
          </span>
        )}
      </div>

      <p className="flex-1 leading-tight">
        <span className="font-medium">{formatNameList(editingUsers)}</span>{' '}
        {editingUsers.length === 1
          ? 'está editando este registro'
          : 'están editando este registro'}
        {isLockedByOther && (
          <span className="ml-1 text-amber-300/80">— modo solo lectura</span>
        )}
      </p>

      {isLockedByOther && onForceOverride && (
        <button
          type="button"
          onClick={onForceOverride}
          data-testid="editing-by-banner-force"
          className="rounded-md border border-amber-400/60 bg-amber-500/20 px-2 py-1 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-500/30 focus:outline-none focus:ring-2 focus:ring-amber-400/60"
        >
          Forzar edición
        </button>
      )}

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Cerrar aviso"
          data-testid="editing-by-banner-dismiss"
          className="rounded p-1 text-amber-200/70 hover:bg-amber-500/20 hover:text-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400/60"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
