'use client'

/**
 * PresenceAvatars · Render compacto de los usuarios online en un channel.
 *
 * Wave P6 · Equipo A1.
 *
 * Diseño:
 * - Hasta `max` avatares solapados (margen negativo). Si la lista excede,
 *   un badge `+N` muestra el resto.
 * - Tooltip nativo (`title`) con nombre y estado. No usamos Radix Tooltip
 *   aquí para no añadir runtime; es información secundaria.
 * - Fade-in al entrar un usuario nuevo: lo manejamos por CSS con
 *   `animate-in` (utility de tailwindcss-animate compatible con Tailwind 4).
 * - Si el usuario no tiene avatarUrl, mostramos las iniciales sobre un
 *   fondo de color derivado del userId (hash determinista).
 */
import type { PresenceUser } from '@/lib/realtime/types'

type Props = {
  users: PresenceUser[]
  /** Número máximo de avatares visibles. Default 5. */
  max?: number
  /** Tamaño del avatar en px. Default 28 (h-7 w-7). */
  size?: number
}

const PALETTE = [
  'bg-rose-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-sky-500',
  'bg-indigo-500',
  'bg-fuchsia-500',
  'bg-teal-500',
  'bg-orange-500',
] as const

function colorFor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function statusLabel(status: PresenceUser['status']): string {
  if (status === 'busy') return 'Ocupado'
  if (status === 'away') return 'Ausente'
  return 'En línea'
}

export default function PresenceAvatars({
  users,
  max = 5,
  size = 28,
}: Props) {
  if (users.length === 0) return null

  const visible = users.slice(0, max)
  const hidden = users.length - visible.length
  const sizeStyle = { width: size, height: size }

  return (
    <div
      className="flex items-center"
      role="group"
      aria-label={`${users.length} ${users.length === 1 ? 'persona viendo' : 'personas viendo'}`}
    >
      {visible.map((u, i) => (
        <div
          key={u.userId}
          title={`${u.name} · ${statusLabel(u.status)}`}
          aria-label={`${u.name}, ${statusLabel(u.status)}`}
          className={[
            'relative inline-flex items-center justify-center rounded-full',
            'ring-2 ring-background text-[10px] font-semibold text-white',
            'shadow-sm transition-transform hover:translate-y-[-1px]',
            i > 0 ? '-ml-2' : '',
            !u.avatarUrl ? colorFor(u.userId) : '',
          ].join(' ')}
          style={sizeStyle}
        >
          {u.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={u.avatarUrl}
              alt=""
              className="h-full w-full rounded-full object-cover"
            />
          ) : (
            <span aria-hidden>{initialsOf(u.name)}</span>
          )}
          {u.status === 'online' ? (
            <span
              aria-hidden
              className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-background"
            />
          ) : null}
        </div>
      ))}
      {hidden > 0 ? (
        <div
          title={`${hidden} ${hidden === 1 ? 'persona más' : 'personas más'}`}
          aria-label={`${hidden} ${hidden === 1 ? 'persona más' : 'personas más'}`}
          className="-ml-2 inline-flex items-center justify-center rounded-full bg-muted ring-2 ring-background text-[10px] font-semibold text-foreground/80"
          style={sizeStyle}
        >
          +{hidden}
        </div>
      ) : null}
    </div>
  )
}
