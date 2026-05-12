'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useUIStore } from '@/lib/stores/ui'
import type { ReactNode } from 'react'
import type { CurrentUserPresence } from '@/lib/auth/get-current-user-presence'

/**
 * Panel lateral deslizable (Drawer) para el detalle de una tarea.
 * Se monta una sola vez por vista y se controla con el store UI.
 * La lista/kanban permanece visible: el drawer ocupa ~520px a la derecha.
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

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && closeDrawer()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-[520px] flex-col border-l border-slate-200 bg-white shadow-xl outline-none md:max-w-[520px] max-md:max-w-full dark:border-border dark:bg-background"
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
          <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-border">
            <button
              type="button"
              aria-label="Anterior (K)"
              onClick={onPrev}
              className="rounded p-1 hover:bg-secondary dark:hover:bg-secondary"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Siguiente (J)"
              onClick={onNext}
              className="rounded p-1 hover:bg-secondary dark:hover:bg-secondary"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {breadcrumbs}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Cerrar (Esc)"
                className="rounded p-1 hover:bg-secondary dark:hover:bg-secondary"
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
