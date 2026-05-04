'use client'

import { useEffect, useRef } from 'react'
import {
  useLiveCursors,
  type CurrentUserIdentity,
} from '@/lib/realtime-cursors/use-live-cursors'
import { LiveCursor } from './LiveCursor'

type Props = {
  /**
   * Nombre del canal Supabase Realtime, p.ej. `whiteboard:<id>` o
   * `project:<id>:gantt`. Define el "cuarto" de colaboración.
   */
  channelName: string
  /**
   * Usuario actual. Si es `null` el componente sigue mostrando los
   * cursores remotos pero no envía broadcast (modo lectura).
   */
  currentUser: CurrentUserIdentity | null
  /**
   * Throttle del envío en ms. Por defecto 50 ms (≈ 20 fps), suficiente
   * para sentir el movimiento "vivo" sin saturar el canal.
   */
  throttleMs?: number
  /**
   * Tag opcional usado solamente para tests/inspección.
   */
  testId?: string
}

/**
 * Capa que se monta como overlay (`position: absolute; inset: 0`) y:
 *   1) Suscribe al canal de cursores y renderiza los remotos.
 *   2) Adjunta un listener `mousemove` al **elemento padre** real (no a
 *      window) para emitir la posición local en coordenadas relativas
 *      al contenedor (que es el área "compartida" lógica). Usa el
 *      patrón ref + listener nativo, sin `useEffect → setState` para
 *      el envío (cumple `react-hooks/set-state-in-effect`).
 *   3) `pointer-events: none` global para no interferir con clics.
 *
 * El listener se registra una sola vez por montaje (deps estables) y
 * lee `sendPosition` desde una ref interna del hook (que es estable).
 */
export function LiveCursorsLayer({
  channelName,
  currentUser,
  throttleMs,
  testId,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { cursors, sendPosition } = useLiveCursors(channelName, currentUser, {
    throttleMs,
  })

  // `sendPosition` ya es estable (referencia constante via useCallback en
  // el hook). Lo usamos directo dentro del effect.
  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const parent = node.parentElement
    if (!parent) return

    const handleMove = (e: MouseEvent) => {
      const rect = parent.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      // Si el ratón sale del rect (caso raro: pointer-events: none en
      // hijos), no enviamos coordenadas absurdas.
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return
      sendPosition(x, y)
    }

    parent.addEventListener('mousemove', handleMove, { passive: true })
    return () => {
      parent.removeEventListener('mousemove', handleMove)
    }
  }, [sendPosition])

  return (
    <div
      ref={containerRef}
      data-testid={testId ?? 'live-cursors-layer'}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 50,
        overflow: 'hidden',
      }}
    >
      {cursors.map((c) => (
        <LiveCursor
          key={c.userId}
          userId={c.userId}
          x={c.x}
          y={c.y}
          name={c.name}
          color={c.color}
        />
      ))}
    </div>
  )
}
