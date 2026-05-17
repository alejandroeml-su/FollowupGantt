'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useUIStore } from '@/lib/stores/ui'
import { useIsMobileViewport } from '@/lib/hooks/useMediaQuery'
import { clsx } from 'clsx'
import type { CurrentUserPresence } from '@/lib/auth/get-current-user-presence'

/**
 * Panel lateral deslizable (Drawer) para el detalle de una tarea.
 * Se monta una sola vez por vista y se controla con el store UI.
 *
 * En desktop (md+): drawer lateral derecho de ~520px (comportamiento
 * histórico).
 *
 * Wave R5E · Mobile-first refinements (2026-05-17) — En mobile (<md)
 * se presenta como bottom-sheet ocupando ~85vh, con un handle visual en
 * la parte superior y soporte de swipe-down para descartar. La altura
 * casi-completa preserva el espacio visible del contexto detrás (lista
 * de tareas / kanban) y es alcanzable con un solo pulgar.
 *
 * Wave P7 · C-DEBT-2 — Acepta `currentUser` para alinear el contrato con
 * los containers que abren el drawer (List/Kanban/Table/Calendar/Gantt/
 * GanttListMobile). El drawer NO consume el campo en su propio DOM —
 * `TaskDrawerContent` (B3) es el consumidor real. La prop existe aquí
 * para que el plumbing desde RSC sea consistente y para que tests
 * puedan verificar que la identidad atraviesa toda la cadena.
 */
export type TaskDrawerProps = {
  children: ReactNode
  breadcrumbs?: ReactNode
  onNext?: () => void
  onPrev?: () => void
  /**
   * Identidad mínima del usuario actual. `null`/`undefined` = sin sesión.
   * Mantenido opcional para back-compat con callers existentes que no
   * forwardean la prop todavía.
   */
  currentUser?: CurrentUserPresence | null
}

export function TaskDrawer({
  children,
  breadcrumbs,
  onNext,
  onPrev,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- API contract; consumido por TaskDrawerContent vía children
  currentUser: _currentUser = null,
}: TaskDrawerProps) {
  const open = useUIStore((s) => s.drawerTaskId != null)
  const closeDrawer = useUIStore((s) => s.closeDrawer)
  const isMobile = useIsMobileViewport()

  // Wave R5E · swipe-down-to-dismiss en bottom-sheet mobile.
  // Solo se activa cuando arrastramos el handle (touchstart sobre él);
  // arrastrar el contenido interno hace scroll normal del overflow.
  const dragStartYRef = useRef<number | null>(null)
  const [dragOffset, setDragOffset] = useState(0)

  // Si el viewport cambia o el drawer se cierra, resetea offset visual.
  // El plugin react-hooks/set-state-in-effect quiere que evitemos setState
  // directo, pero aquí el effect refleja el ciclo de vida open→closed que
  // viene de un store externo (UI Zustand), patrón válido del API rule.
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDragOffset(0)
    }
  }, [open])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isMobile) return
    dragStartYRef.current = e.clientY
    // Capturamos el puntero al handle para no perder eventos si el dedo
    // sale del elemento durante el drag (común en pantallas táctiles).
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isMobile) return
    if (dragStartYRef.current == null) return
    const delta = e.clientY - dragStartYRef.current
    // Solo permitimos arrastrar hacia abajo (delta > 0).
    if (delta > 0) setDragOffset(delta)
  }
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isMobile) return
    if (dragStartYRef.current == null) return
    const delta = e.clientY - dragStartYRef.current
    dragStartYRef.current = null
    // Umbral: 120px de arrastre hacia abajo descarta el drawer. Si no
    // alcanza, snap-back animado (transition CSS sobre transform).
    if (delta > 120) {
      setDragOffset(0)
      closeDrawer()
    } else {
      setDragOffset(0)
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // releasePointerCapture puede lanzar si ya no tenemos el pointer.
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && closeDrawer()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={clsx(
            'fixed inset-0 z-40 bg-black/20 data-[state=open]:animate-in data-[state=open]:fade-in',
            // En mobile usamos backdrop algo más oscuro para destacar el
            // sheet flotante; en desktop mantenemos el 20% histórico.
            isMobile && 'bg-black/50',
          )}
        />
        <Dialog.Content
          className={clsx(
            'fixed z-50 flex flex-col bg-white shadow-xl outline-none dark:bg-background',
            isMobile
              ? // Bottom-sheet: ocupa todo el ancho y ~85vh, anclado al
                // bottom. Esquinas redondeadas arriba. Transición de
                // transform para feedback del drag.
                'inset-x-0 bottom-0 max-h-[85vh] h-[85vh] rounded-t-2xl border-t border-border'
              : // Desktop drawer lateral derecho (legacy).
                'inset-y-0 right-0 h-full w-full max-w-[520px] border-l border-slate-200 md:max-w-[520px] max-md:max-w-full dark:border-border',
          )}
          style={
            isMobile && dragOffset > 0
              ? { transform: `translateY(${dragOffset}px)`, transition: 'none' }
              : isMobile
                ? { transition: 'transform 200ms ease-out' }
                : undefined
          }
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Radix exige Dialog.Title para a11y (screen readers). El diseño
              actual usa breadcrumbs como heading visible, así que ocultamos
              el título visualmente pero lo exponemos al árbol accesible.
              Fix warnings "DialogContent requires a DialogTitle" (incidente
              2026-05-12 reportado en DevTools Issues). */}
          <Dialog.Title className="sr-only">Detalle de tarea</Dialog.Title>
          <Dialog.Description className="sr-only">
            Panel lateral con la información completa de la tarea seleccionada
          </Dialog.Description>

          {/* Wave R5E · Handle de drag (solo mobile). Touch-only por
              `pointerdown`; un mouse click en desktop nunca llega aquí
              porque el contenedor no renderiza el bloque. Aria-hidden
              porque la acción "cerrar" ya está disponible vía botón X. */}
          {isMobile && (
            <div
              className="flex items-center justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing touch-none"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              aria-hidden="true"
              data-testid="task-drawer-mobile-handle"
            >
              <div className="h-1.5 w-12 rounded-full bg-muted-foreground/40" />
            </div>
          )}

          <header
            className={clsx(
              'flex items-center gap-2 border-b border-slate-200 px-4 dark:border-border',
              isMobile ? 'py-2' : 'py-3',
            )}
          >
            <button
              type="button"
              aria-label="Anterior (K)"
              onClick={onPrev}
              className="rounded p-1 hover:bg-secondary dark:hover:bg-secondary min-h-11 min-w-11 md:min-h-0 md:min-w-0 flex items-center justify-center"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Siguiente (J)"
              onClick={onNext}
              className="rounded p-1 hover:bg-secondary dark:hover:bg-secondary min-h-11 min-w-11 md:min-h-0 md:min-w-0 flex items-center justify-center"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1 truncate text-xs text-foreground">
              {breadcrumbs}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Cerrar (Esc)"
                className="rounded p-1 hover:bg-secondary dark:hover:bg-secondary min-h-11 min-w-11 md:min-h-0 md:min-w-0 flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </header>

          <div className="flex-1 overflow-auto p-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function TaskBreadcrumbs({
  segments,
}: {
  segments: { label: string; href?: string }[]
}) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1">
      {segments.map((s, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden>›</span>}
          {s.href ? (
            <a
              href={s.href}
              className="truncate hover:text-foreground dark:hover:text-foreground"
            >
              {s.label}
            </a>
          ) : (
            <span className="truncate">{s.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
