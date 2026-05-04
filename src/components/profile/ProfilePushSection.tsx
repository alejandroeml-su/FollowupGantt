'use client'

/**
 * Wave P6 · Equipo B2 — Sección "Notificaciones push" del perfil.
 *
 * Wrapper client del `<EnableWebPushButton>` con título h2 + texto
 * explicativo. Vive en `/settings/profile` y guía al usuario sobre
 * cuándo se disparan los push (asignación, mención, baseline).
 *
 * Es un client component porque `EnableWebPushButton` (y el hook
 * `useWebPush` debajo) consultan APIs del navegador (`Notification`,
 * `serviceWorker`, `PushManager`). El wrapper se mantiene minimal:
 * sin estado propio, sin fetch — toda la lógica vive en el botón.
 */

import { EnableWebPushButton } from '@/components/notifications/EnableWebPushButton'

type Props = {
  /**
   * userId del usuario autenticado. Se propaga a `EnableWebPushButton`
   * que lo pasa a `subscribeToPush` para que la fila de
   * `PushSubscription` quede ligada al usuario correcto. Si es
   * `null`/`undefined`, las server actions caen al fallback
   * `getDefaultUserId` (Edwin Martinez).
   */
  userId?: string | null
}

export function ProfilePushSection({ userId }: Props) {
  return (
    <section
      data-testid="profile-push-section"
      aria-labelledby="profile-push-section-title"
      className="rounded-2xl border border-border bg-card p-6"
    >
      <h2
        id="profile-push-section-title"
        className="text-lg font-semibold text-foreground"
      >
        Notificaciones push
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Recibe alertas inmediatas cuando se te asigne una tarea, mencionen en
        un comentario o se capture un baseline. Las notificaciones llegan al
        navegador incluso si la pestaña de FollowupGantt está cerrada.
      </p>
      <div className="mt-4">
        <EnableWebPushButton userId={userId ?? null} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Puedes desactivarlas cuando quieras. Si el navegador bloquea los
        permisos, ajusta los permisos del sitio desde la configuración del
        navegador.
      </p>
    </section>
  )
}
