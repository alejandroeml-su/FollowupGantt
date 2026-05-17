'use client'

import { useRef, useState, useCallback, type PointerEvent as ReactPointerEvent } from 'react'

/**
 * Wave R5E · Mobile-first refinements (2026-05-17)
 *
 * Gestos swipe ligeros sobre PointerEvents (sin libs). Devuelve:
 *   - `offset`: desplazamiento horizontal actual (positivo = derecha,
 *     negativo = izquierda). Útil para animar el "card" con
 *     `transform: translateX(${offset}px)` mientras el usuario
 *     arrastra.
 *   - `bind`: handlers para pegar al elemento arrastrable
 *     (`{...bind}`).
 *   - `direction`: dirección final del swipe cuando se completa
 *     (`'left' | 'right' | null`), útil para mostrar background
 *     icons direccionales.
 *
 * Trigger: cuando |delta| supera `threshold` (default 80px) al
 * soltar, dispara `onSwipeLeft` u `onSwipeRight`. Si no llega al
 * umbral, snap-back a 0 con transición CSS.
 *
 * No-op fuera de pointer-coarse: el caller debe verificar
 * `useCoarsePointer()` y desactivar el bind para evitar que un
 * mouse drag en desktop dispare archivado accidental.
 *
 * Bloquea sólo movimiento horizontal: si el usuario arranca un
 * scroll vertical (|deltaY| > |deltaX|), abandona el gesto y deja
 * que el scroll del contenedor padre tome el control.
 */
export type SwipeBind = {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void
}

type Options = {
  threshold?: number
  enabled?: boolean
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
}

export function useSwipeGesture({
  threshold = 80,
  enabled = true,
  onSwipeLeft,
  onSwipeRight,
}: Options): { offset: number; bind: SwipeBind; resetting: boolean } {
  const startRef = useRef<{ x: number; y: number; id: number } | null>(null)
  const horizontalRef = useRef<boolean | null>(null)
  const [offset, setOffset] = useState(0)
  const [resetting, setResetting] = useState(false)

  const reset = useCallback(() => {
    setOffset(0)
    setResetting(true)
    // Quita el flag tras la transición.
    window.setTimeout(() => setResetting(false), 180)
  }, [])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return
      startRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
      horizontalRef.current = null
      // No capturamos puntero todavía — esperamos a saber si es
      // horizontal o vertical. Capturarlo prematuro bloquea el scroll
      // vertical del contenedor padre.
    },
    [enabled],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return
      const start = startRef.current
      if (!start) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y

      // Resolver intención: en los primeros ~10px decidimos si es
      // horizontal o vertical. Si fue vertical, abandonamos.
      if (horizontalRef.current == null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        horizontalRef.current = Math.abs(dx) > Math.abs(dy)
        if (!horizontalRef.current) {
          // Vertical → liberamos el gesto.
          startRef.current = null
          return
        }
        // Ahora sí capturamos el puntero para no perder eventos.
        try {
          e.currentTarget.setPointerCapture(start.id)
        } catch {
          // ignore
        }
      }

      if (horizontalRef.current) {
        setOffset(dx)
      }
    },
    [enabled],
  )

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return
      const start = startRef.current
      startRef.current = null
      if (!start || !horizontalRef.current) {
        horizontalRef.current = null
        return
      }
      horizontalRef.current = null
      const dx = e.clientX - start.x
      try {
        e.currentTarget.releasePointerCapture(start.id)
      } catch {
        // ignore
      }
      if (dx <= -threshold) {
        onSwipeLeft?.()
      } else if (dx >= threshold) {
        onSwipeRight?.()
      }
      reset()
    },
    [enabled, threshold, onSwipeLeft, onSwipeRight, reset],
  )

  const onPointerCancel = useCallback(() => {
    startRef.current = null
    horizontalRef.current = null
    reset()
  }, [reset])

  return {
    offset,
    resetting,
    bind: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  }
}
