'use client'

/**
 * Wave P16-A · Equipo A — Barra de presencia en el header del DocEditor.
 *
 * Conecta `usePresence` al canal del doc y renderiza:
 *  - `<PresenceAvatars>` con hasta 5 avatares solapados.
 *  - `<PresenceIndicator>` con el conteo y el texto "editando ahora".
 *
 * Diseño:
 *  - El `currentUser` viene drilled desde el RSC padre (mismo patrón que
 *    `ProjectHeaderPresence`) para no fetchear en mount.
 *  - Si `usePresence` retorna lista vacía (env vars Supabase ausentes o
 *    aún no llegó el primer sync), el componente queda invisible — sin
 *    "0 editando" ruidoso.
 *  - El conteo refleja la lista real: usePresence ya incluye al "me" tras
 *    el primer sync, así que mostramos `users.length` directamente.
 */
import { usePresence } from '@/lib/realtime/use-presence'
import PresenceAvatars from '@/components/realtime/PresenceAvatars'
import PresenceIndicator from '@/components/realtime/PresenceIndicator'
import { docChannelTopic } from '@/lib/realtime/doc-presence'
import type { CurrentUserPresence } from '@/lib/auth/get-current-user-presence'

type Props = {
  docId: string
  currentUser: CurrentUserPresence
}

export default function DocPresenceBar({ docId, currentUser }: Props) {
  const topic = docChannelTopic(docId)
  const { users } = usePresence(topic, {
    userId: currentUser.userId,
    name: currentUser.name,
    avatarUrl: currentUser.avatarUrl,
  })

  if (users.length === 0) return null

  // El indicador muestra "viendo" cuando estoy solo y "editando ahora"
  // cuando hay >=2 personas, alineado al copy del README de Sync.
  const label = users.length >= 2 ? 'editando ahora' : 'viendo'

  return (
    <div
      className="flex items-center gap-2"
      data-testid="doc-presence-bar"
      aria-label="Personas editando este documento"
    >
      <PresenceAvatars users={users} max={5} />
      <PresenceIndicator count={users.length} label={label} />
    </div>
  )
}
