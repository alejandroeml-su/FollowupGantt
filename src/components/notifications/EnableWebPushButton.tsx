'use client'

/**
 * Wave P6 · Equipo A4 — Botón "Habilitar notificaciones push".
 *
 * Estados visuales:
 *   - permission='unsupported' / !isSupported → botón deshabilitado, texto
 *     "Tu navegador no soporta push".
 *   - permission='denied' → botón deshabilitado, "Bloqueadas (ajustes del
 *     navegador)".
 *   - permission='default' → "Habilitar notificaciones push" (acción:
 *     requestPermission + subscribe).
 *   - permission='granted' && !isSubscribed → "Suscribirse" (acción:
 *     subscribe).
 *   - isSubscribed → "Notificaciones activas (deshabilitar)" (acción:
 *     unsubscribe).
 *
 * Errores del flujo se muestran en un `<p>` debajo del botón con
 * `role='status'` (UI minimal, sin Toaster — el componente es self-contained).
 */

import { useState } from 'react'
import { BellRing, BellOff, Bell } from 'lucide-react'
import { clsx } from 'clsx'
import { useWebPush } from '@/lib/realtime-notifications/use-web-push'

type Props = {
  userId?: string | null
  className?: string
}

export function EnableWebPushButton({ userId, className }: Props) {
  const { isSupported, permission, isSubscribed, busy, subscribe, unsubscribe } =
    useWebPush(userId)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setError(null)
    try {
      if (isSubscribed) {
        await unsubscribe()
      } else {
        await subscribe()
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error desconocido al gestionar push'
      setError(message)
    }
  }

  let label: string
  let Icon = Bell
  let disabled = busy
  let tone: 'primary' | 'success' | 'muted' | 'danger' = 'primary'

  if (!isSupported || permission === 'unsupported') {
    label = 'Tu navegador no soporta notificaciones push'
    Icon = BellOff
    disabled = true
    tone = 'muted'
  } else if (permission === 'denied') {
    label = 'Bloqueadas (cambiar en ajustes del navegador)'
    Icon = BellOff
    disabled = true
    tone = 'danger'
  } else if (isSubscribed) {
    label = busy ? 'Deshabilitando…' : 'Notificaciones activas (deshabilitar)'
    Icon = BellRing
    tone = 'success'
  } else if (permission === 'granted') {
    label = busy ? 'Suscribiendo…' : 'Suscribirse a notificaciones'
    Icon = BellRing
    tone = 'primary'
  } else {
    label = busy ? 'Habilitando…' : 'Habilitar notificaciones push'
    Icon = Bell
    tone = 'primary'
  }

  const toneClass: Record<typeof tone, string> = {
    primary:
      'bg-primary text-primary-foreground hover:bg-primary/90 focus:ring-primary/40',
    success:
      'bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500/40',
    muted:
      'bg-muted text-muted-foreground cursor-not-allowed focus:ring-muted/40',
    danger:
      'bg-red-100 text-red-800 cursor-not-allowed focus:ring-red-400/40 dark:bg-red-950 dark:text-red-200',
  }

  return (
    <div className={clsx('flex flex-col gap-2', className)}>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        data-testid="enable-web-push-button"
        data-state={
          !isSupported
            ? 'unsupported'
            : permission === 'denied'
              ? 'denied'
              : isSubscribed
                ? 'subscribed'
                : permission === 'granted'
                  ? 'granted'
                  : 'default'
        }
        className={clsx(
          'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all focus:outline-none focus:ring-2 disabled:opacity-60',
          toneClass[tone],
        )}
        aria-busy={busy}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span>{label}</span>
      </button>
      {error && (
        <p
          role="status"
          className="text-xs text-red-600 dark:text-red-400"
          data-testid="enable-web-push-error"
        >
          {error}
        </p>
      )}
    </div>
  )
}
