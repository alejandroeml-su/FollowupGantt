'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { clsx } from 'clsx'

/**
 * Bottom sheet (panel modal que sube desde el borde inferior) pensado
 * para reemplazar dialogs centrados en mobile (P4-3).
 *
 * Características:
 *   - Cierra con Esc, click en backdrop, o botón "Cerrar".
 *   - Focus trap básico: enfoca el contenedor al abrir y devuelve foco
 *     al elemento activo previo al cerrar.
 *   - `aria-modal=true`, `role=dialog`. El consumidor debe pasar `title`
 *     que se usa como `aria-label`.
 *   - Hit area del botón cerrar: 44x44 px mínimo.
 *   - `safe-area-inset-bottom` para no chocar con la home indicator iOS.
 *
 * Diseñado para no depender de Radix (Radix Dialog ya cubre desktop;
 * aquí queremos un comportamiento mobile-first sin animaciones complejas
 * y sin añadir dependencias).
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    previousFocus.current = (document.activeElement as HTMLElement | null) ?? null
    // Enfocar el contenedor para que ESC funcione sin click previo.
    containerRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)

    // Bloquear scroll del body mientras está abierto.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      previousFocus.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      data-testid="bottom-sheet-root"
      className="fixed inset-0 z-50 flex flex-col justify-end"
      aria-hidden={false}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        tabIndex={-1}
      />

      {/* Sheet */}
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-safe-area="bottom"
        className={clsx(
          'relative max-h-[90vh] w-full overflow-hidden rounded-t-2xl border-t border-border bg-card text-foreground shadow-2xl outline-none pb-[env(safe-area-inset-bottom)]',
          'animate-in slide-in-from-bottom duration-200',
          className,
        )}
      >
        {/* Drag handle visual */}
        <div className="flex justify-center pt-2" aria-hidden="true">
          <div className="h-1.5 w-10 rounded-full bg-muted" />
        </div>

        <header className="flex items-center justify-between gap-2 px-4 pb-3 pt-2">
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="overflow-y-auto px-4 pb-4" style={{ maxHeight: 'calc(90vh - 4rem)' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
