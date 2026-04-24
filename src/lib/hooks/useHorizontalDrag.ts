'use client'

import { useCallback, useRef, useState } from 'react'

type Opts = {
  dayWidth: number
  onPreview?: (deltaDays: number) => void
  onCommit?: (deltaDays: number) => void | Promise<void>
}

/**
 * Drag horizontal nativo basado en pointer events.
 * Captura el puntero, calcula delta en píxeles, y emite delta en días
 * (snap al múltiplo más cercano de dayWidth). Compatible con mouse y táctil.
 *
 * Uso:
 *   const { onPointerDown, deltaPx, isDragging } = useHorizontalDrag({
 *     dayWidth: 40,
 *     onCommit: (days) => shiftTaskDates(taskId, days),
 *   })
 *   <div onPointerDown={onPointerDown} style={{ transform: `translateX(${deltaPx}px)` }}/>
 */
export function useHorizontalDrag({ dayWidth, onPreview, onCommit }: Opts) {
  const startX = useRef<number | null>(null)
  const [deltaPx, setDeltaPx] = useState(0)
  const [isDragging, setDragging] = useState(false)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return // solo primario
      e.stopPropagation()
      e.preventDefault()
      startX.current = e.clientX
      setDragging(true)
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (startX.current == null) return
      const dx = e.clientX - startX.current
      setDeltaPx(dx)
      onPreview?.(Math.round(dx / dayWidth))
    },
    [dayWidth, onPreview],
  )

  const finish = useCallback(
    async (e: React.PointerEvent<HTMLElement>) => {
      if (startX.current == null) return
      const dx = e.clientX - startX.current
      const deltaDays = Math.round(dx / dayWidth)
      startX.current = null
      setDeltaPx(0)
      setDragging(false)
      ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
      if (deltaDays !== 0) await onCommit?.(deltaDays)
    },
    [dayWidth, onCommit],
  )

  return {
    dragProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
    },
    deltaPx,
    isDragging,
  }
}
