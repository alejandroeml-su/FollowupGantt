'use client'

/**
 * ProjectHeaderPresence · Wiring de presence para el header de un proyecto.
 *
 * Wave P6 · Equipo B1.
 *
 * Conecta `usePresence` al canal `project:{projectId}` y renderiza:
 *  - `<PresenceAvatars>` con hasta 5 avatares solapados.
 *  - `<PresenceIndicator>` con el conteo (incluyendo al usuario actual).
 *
 * Diseño:
 *  - El `currentUser` viene drilled desde el RSC padre — esto evita que el
 *    cliente haga un fetch extra en mount y respeta el flujo Auth de Next 16
 *    donde la sesión vive en cookies HTTP-only que no se leen desde JS.
 *  - Si `usePresence` retorna lista vacía (env vars Supabase ausentes), el
 *    componente queda invisible: ni avatars ni indicador molestan en una
 *    instalación sin Realtime configurado (degradación graceful explícita).
 *  - El conteo del indicador suma `users.length + 1` cuando el usuario aún
 *    NO aparece en su propio `presenceState` (sucede entre `subscribe` y el
 *    primer `sync`). Una vez sincronizado, `users` ya incluye al `me`, por
 *    lo que mostramos `users.length` directamente para evitar inflar.
 */
import { usePresence } from '@/lib/realtime/use-presence'
import PresenceAvatars from '@/components/realtime/PresenceAvatars'
import PresenceIndicator from '@/components/realtime/PresenceIndicator'
import type { CurrentUserPresence } from '@/lib/auth/get-current-user-presence'

type Props = {
  currentUser: CurrentUserPresence
  projectId: string
}

export default function ProjectHeaderPresence({ currentUser, projectId }: Props) {
  const { users } = usePresence(`project:${projectId}`, {
    userId: currentUser.userId,
    name: currentUser.name,
    avatarUrl: currentUser.avatarUrl,
  })

  if (users.length === 0) return null

  return (
    <div className="flex gap-2 items-center" data-testid="project-header-presence">
      <PresenceAvatars users={users} max={5} />
      <PresenceIndicator count={users.length} label="viendo" />
    </div>
  )
}
