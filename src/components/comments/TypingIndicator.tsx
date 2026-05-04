'use client'

/**
 * Wave P6 · Equipo A3 — Indicador "está escribiendo…".
 *
 * Renderiza:
 *   - 0 usuarios → null (componente invisible).
 *   - 1 usuario  → "Ana está escribiendo…"
 *   - 2 usuarios → "Ana y Pedro escribiendo…"
 *   - >2         → "Ana, Pedro y N más escribiendo…"
 *
 * Animación: tres puntos que parpadean (`animate-pulse`).
 */

import type { TypingUser } from '@/lib/realtime-comments/use-typing-indicator'

type Props = {
  users: TypingUser[]
}

function describe(users: TypingUser[]): string {
  if (users.length === 0) return ''
  // Usamos `nombre` o, si está vacío, "Alguien" (fallback ES).
  const labels = users.map((u) => (u.name && u.name.trim()) || 'Alguien')
  if (labels.length === 1) {
    return `${labels[0]} está escribiendo…`
  }
  if (labels.length === 2) {
    return `${labels[0]} y ${labels[1]} escribiendo…`
  }
  const extra = labels.length - 2
  return `${labels[0]}, ${labels[1]} y ${extra} más escribiendo…`
}

export function TypingIndicator({ users }: Props) {
  if (!users || users.length === 0) return null
  const label = describe(users)
  return (
    <div
      data-testid="typing-indicator"
      aria-live="polite"
      role="status"
      className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground"
    >
      <span className="flex items-center gap-0.5" aria-hidden="true">
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse [animation-delay:300ms]" />
      </span>
      <span className="italic">{label}</span>
    </div>
  )
}
