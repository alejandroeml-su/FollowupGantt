'use client'

import { Plus } from 'lucide-react'
import { useUIStore } from '@/lib/stores/ui'

/**
 * Wave R5E · Mobile-first refinements (2026-05-17)
 *
 * Floating Action Button para crear una nueva tarea desde las vistas
 * /list, /kanban y /timeline en mobile. Despacha el "tick"
 * `requestNewTask()` del UI store; cualquier `<NewTaskButton/>` montado
 * en la vista (en el header top-right) reacciona y abre su modal —
 * reutilizamos la infraestructura ya provista por Wave P16-C
 * (atajo cmd+shift+n) sin duplicar el modal aquí.
 *
 * Posición: `fixed bottom-20 right-4` — el `bottom-20` deja espacio
 * para la `MobileBottomNav` (h-16 = 4rem) más un pequeño aire, y
 * respeta `env(safe-area-inset-bottom)` indirectamente porque la
 * bottom-nav ya lo absorbe. Z-index 30 queda debajo del drawer
 * mobile (z-50) y del sidebar mobile drawer (z-50), pero por encima
 * de listados normales.
 *
 * Hit area: 56×56 px (h-14 w-14), supera los 44px mínimos WCAG/HIG y
 * coincide con el tamaño Material Design para FABs primarios.
 *
 * Visibilidad: oculto en `md+` (donde el header ya muestra el botón
 * "Nueva tarea" tradicional sin tocar viewport limitado).
 */
export function MobileTaskFAB({ label = 'Nueva tarea' }: { label?: string }) {
  const requestNewTask = useUIStore((s) => s.requestNewTask)

  return (
    <button
      type="button"
      onClick={() => requestNewTask()}
      aria-label={label}
      title={label}
      data-testid="mobile-task-fab"
      // bottom-20 (5rem) deja la MobileBottomNav (h-16) visible debajo
      // sin que el FAB se monte sobre los íconos de navegación.
      className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl ring-1 ring-primary/30 active:scale-95 transition-transform md:hidden"
    >
      <Plus className="h-6 w-6" aria-hidden="true" />
    </button>
  )
}
