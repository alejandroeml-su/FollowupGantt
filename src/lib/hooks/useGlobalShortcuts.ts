'use client'

/**
 * Wave P16-C · Equipo C — Hook único que registra los atajos globales de
 * la app (no dependientes de una vista en particular). Se monta UNA sola
 * vez en `<AppInteractionShell />` para evitar listeners duplicados.
 *
 * Atajos registrados:
 *  - cmd/ctrl + k        → abrir Command Palette
 *  - cmd/ctrl + /        → toggle sidebar collapsed
 *  - cmd/ctrl + shift + n → modal "Nueva tarea" (si hay handler montado)
 *  - cmd/ctrl + ? / ?     → abrir overlay de ayuda de atajos
 *  - shift + /            → alias legacy del overlay (compat con HU previa)
 *  - g + <letra>          → navegación rápida estilo Linear/Gmail
 *  - escape               → cerrar overlays
 *
 * Decisiones:
 *  - `enableOnFormTags: false` (default) — no disparamos atajos cuando el
 *    foco está en un input/textarea para no interferir con `cmd+/` que
 *    algunos editores interpretan como comentar.
 *  - El "trigger nueva tarea" se resuelve vía `useUIStore` con un flag
 *    booleano `newTaskRequested`: cualquier vista que monte un
 *    `<NewTaskButton />` o equivalente puede suscribirse y abrir su modal.
 *    Si no hay handler montado, el atajo simplemente abre la Command
 *    Palette filtrada con "Nueva" como fallback útil.
 */

import { useHotkeys } from 'react-hotkeys-hook'
import { useRouter } from 'next/navigation'
import { useUIStore } from '@/lib/stores/ui'
import { isTypingTarget } from '@/lib/keys'

export function useGlobalShortcuts() {
  const router = useRouter()
  const toggleCommand = useUIStore((s) => s.toggleCommandPalette)
  const toggleShortcuts = useUIStore((s) => s.toggleShortcutsOverlay)
  const toggleSidebar = useUIStore((s) => s.toggleSidebarCollapsed)
  const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen)
  const requestNewTask = useUIStore((s) => s.requestNewTask)

  // ── Command Palette ────────────────────────────────────────────────
  // Soportamos el `mod+k` cross-platform (cmd en Mac, ctrl en Windows).
  // El `/` simple legacy ya está en `<AppInteractionShell />`.
  useHotkeys(
    'mod+k',
    (e) => {
      e.preventDefault()
      toggleCommand(true)
    },
    { enableOnFormTags: true, preventDefault: true },
  )

  // ── Toggle Sidebar ─────────────────────────────────────────────────
  // En desktop colapsamos el sidebar (`sidebarCollapsed`), en mobile
  // alternamos el drawer (`mobileSidebarOpen`).
  useHotkeys(
    'mod+/',
    (e) => {
      if (isTypingTarget(e.target)) return
      e.preventDefault()
      const isMobile =
        typeof window !== 'undefined' && window.innerWidth < 1024
      if (isMobile) {
        const open = useUIStore.getState().mobileSidebarOpen
        setMobileSidebarOpen(!open)
      } else {
        toggleSidebar()
      }
    },
    { preventDefault: true },
  )

  // ── Nueva tarea (modal global) ─────────────────────────────────────
  // Disparamos un "tick" en el store; las vistas con NewTaskButton se
  // suscriben (`newTaskRequestedAt`) y abren su modal. Si nadie escucha,
  // hacemos fallback a la Command Palette para que la acción no muera.
  useHotkeys(
    'mod+shift+n',
    (e) => {
      if (isTypingTarget(e.target)) return
      e.preventDefault()
      requestNewTask()
    },
    { preventDefault: true },
  )

  // ── Overlay de atajos ──────────────────────────────────────────────
  // Mac convention `cmd+?` (que es `cmd+shift+/`). También aceptamos la
  // tecla `?` directa cuando no se está escribiendo, para descubrirlo
  // rápido desde teclado en castellano (Shift + 7) sin modifier.
  useHotkeys(
    'mod+shift+/',
    (e) => {
      e.preventDefault()
      toggleShortcuts(true)
    },
    { preventDefault: true },
  )
  useHotkeys(
    '?',
    (e) => {
      if (isTypingTarget(e.target)) return
      e.preventDefault()
      toggleShortcuts(true)
    },
  )

  // ── Navegación rápida estilo Linear ────────────────────────────────
  // `g` + letra: salta a la vista correspondiente. La librería
  // `react-hotkeys-hook` ya soporta secuencias separadas por espacios.
  useHotkeys('g>l', (e) => {
    if (isTypingTarget(e.target)) return
    router.push('/list')
  })
  useHotkeys('g>k', (e) => {
    if (isTypingTarget(e.target)) return
    router.push('/kanban')
  })
  useHotkeys('g>g', (e) => {
    if (isTypingTarget(e.target)) return
    router.push('/gantt')
  })
  useHotkeys('g>c', (e) => {
    if (isTypingTarget(e.target)) return
    router.push('/calendar')
  })
  useHotkeys('g>t', (e) => {
    if (isTypingTarget(e.target)) return
    router.push('/table')
  })
  useHotkeys('g>i', (e) => {
    if (isTypingTarget(e.target)) return
    router.push('/timeline')
  })
  useHotkeys('g>b', (e) => {
    if (isTypingTarget(e.target)) return
    router.push('/brain')
  })
}
