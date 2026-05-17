'use client'

import { useRef, useState, type ReactNode, type PointerEvent } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { clsx } from 'clsx'
import { useCoarsePointer } from '@/lib/hooks/useMediaQuery'

/**
 * Wave R5E · Mobile-first refinements (2026-05-17)
 *
 * Pull-to-refresh ligero para vistas mobile (/list, /kanban).
 *
 * Implementación:
 *   - Solo activo en `pointer: coarse` (touch) — evita falsos
 *     positivos con mouse-wheel scroll en desktop.
 *   - Sólo dispara cuando el scroll de la ventana ya está en `0`:
 *     un swipe-down a mitad de página no debe disparar refresh.
 *   - Umbral: 80px de drag visible (≈ altura del banner). Antes del
 *     umbral, banner muestra "Desliza para refrescar"; en/después,
 *     "Suelta para refrescar". Al soltar pasado el umbral, llama
 *     `router.refresh()` (Next 16: re-fetcha RSC payload sin
 *     full reload, así no perdemos estado de zustand stores).
 *
 * No interfiere con scroll horizontal (kanban) ni con el drag
 * vertical interno de `<DndContext>` porque sólo capturamos eventos
 * cuando el dedo arranca arriba del todo del wrapper.
 */
export function PullToRefresh({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const router = useRouter()
  const isCoarse = useCoarsePointer()
  const startYRef = useRef<number | null>(null)
  // `dragging` espeja `startYRef.current != null` como state porque el
  // render usa ese flag para decidir si aplicar transición CSS (suave al
  // soltar, ninguna durante el drag). El plugin `react-hooks/refs` no
  // permite leer `ref.current` durante render, así que mantenemos un
  // estado paralelo que se actualiza junto con el ref en los handlers.
  const [dragging, setDragging] = useState(false)
  const [pullY, setPullY] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const TRIGGER = 80 // px de pull para confirmar refresh
  const MAX = 140 // tope visual

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!isCoarse) return
    // Sólo arrancamos pull si el documento ya está en top. Permite que
    // el usuario haga scroll-up normal por la lista sin disparar refresh.
    const scrollY =
      typeof window !== 'undefined'
        ? window.scrollY || document.documentElement.scrollTop
        : 0
    if (scrollY > 0) return
    if (refreshing) return
    startYRef.current = e.clientY
    setDragging(true)
  }

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (startYRef.current == null) return
    const delta = e.clientY - startYRef.current
    if (delta > 0) {
      // Limitamos con una pendiente para que se sienta elástico.
      setPullY(Math.min(delta * 0.5, MAX))
    } else if (pullY !== 0) {
      setPullY(0)
    }
  }

  const handlePointerUp = () => {
    if (startYRef.current == null) return
    startYRef.current = null
    setDragging(false)
    if (pullY >= TRIGGER && !refreshing) {
      setRefreshing(true)
      setPullY(TRIGGER) // mantener banner visible durante refresh
      // router.refresh() es async (re-fetchea RSC en server) pero su
      // promesa no es awaitable de manera fiable; usamos un timeout
      // mínimo para que el banner se quede visible un instante y
      // luego se oculta. El UI cambia al re-render del RSC payload.
      try {
        router.refresh()
      } catch {
        // ignore
      }
      window.setTimeout(() => {
        setRefreshing(false)
        setPullY(0)
      }, 700)
    } else {
      setPullY(0)
    }
  }

  // En desktop / no-coarse simplemente renderiza children sin overhead.
  if (!isCoarse) {
    return <div className={className}>{children}</div>
  }

  const armed = pullY >= TRIGGER
  return (
    <div
      className={clsx('relative', className)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      data-testid="pull-to-refresh"
    >
      {/* Banner indicador. Vive absoluto sobre el flujo para no empujar
          el contenido cuando aparece. */}
      <div
        className={clsx(
          'pointer-events-none absolute left-0 right-0 z-10 flex items-center justify-center overflow-hidden',
          'text-xs font-medium text-muted-foreground bg-card/95 backdrop-blur',
        )}
        style={{
          height: `${pullY}px`,
          opacity: pullY > 8 ? 1 : 0,
          transition: dragging
            ? 'none'
            : 'height 180ms ease-out, opacity 180ms ease-out',
        }}
        aria-hidden={pullY === 0}
      >
        <span className="flex items-center gap-2">
          <RefreshCw
            className={clsx(
              'h-4 w-4 transition-transform',
              refreshing && 'animate-spin',
              armed && !refreshing && 'rotate-180',
            )}
            aria-hidden="true"
          />
          {refreshing
            ? 'Actualizando…'
            : armed
              ? 'Suéltala para refrescar'
              : 'Desliza para refrescar'}
        </span>
      </div>

      <div
        style={{
          transform: pullY > 0 ? `translateY(${pullY}px)` : undefined,
          transition: dragging ? 'none' : 'transform 180ms ease-out',
        }}
      >
        {children}
      </div>
    </div>
  )
}
