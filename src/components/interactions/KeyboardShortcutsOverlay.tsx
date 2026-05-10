'use client'

/**
 * Wave P16-C · Equipo C — Overlay con TODOS los atajos disponibles,
 * agrupados por categoría (Navegación · Acciones · Vistas).
 *
 * Reemplaza al ShortcutsOverlay legacy (que solo listaba los de tareas).
 * Se invoca con `?`, `cmd+?` o desde la Command Palette.
 */

import * as Dialog from '@radix-ui/react-dialog'
import { Keyboard } from 'lucide-react'
import { useUIStore } from '@/lib/stores/ui'
import { SHORTCUTS, displayShortcut } from '@/lib/keys'

type Group = {
  title: string
  rows: ReadonlyArray<readonly [label: string, key: string]>
}

const GROUPS: ReadonlyArray<Group> = [
  {
    title: 'Globales',
    rows: [
      ['Paleta de comandos', SHORTCUTS.COMMAND_PALETTE_K],
      ['Paleta (alt)', SHORTCUTS.COMMAND_PALETTE],
      ['Ocultar / mostrar sidebar', SHORTCUTS.TOGGLE_SIDEBAR],
      ['Nueva tarea (modal)', SHORTCUTS.NEW_TASK_MODAL],
      ['Ayuda de atajos', '?'],
      ['Cerrar overlays', SHORTCUTS.CLOSE],
    ],
  },
  {
    title: 'Vistas (g + tecla)',
    rows: [
      ['Lista', SHORTCUTS.GOTO_LIST],
      ['Kanban', SHORTCUTS.GOTO_KANBAN],
      ['Gantt', SHORTCUTS.GOTO_GANTT],
      ['Calendario', SHORTCUTS.GOTO_CALENDAR],
      ['Tabla', SHORTCUTS.GOTO_TABLE],
      ['Timeline', SHORTCUTS.GOTO_TIMELINE],
      ['Brain AI', SHORTCUTS.GOTO_BRAIN],
    ],
  },
  {
    title: 'Navegación en lista',
    rows: [
      ['Mover foco arriba/abajo', SHORTCUTS.FOCUS_DOWN + ' / ' + SHORTCUTS.FOCUS_UP],
      ['Abrir detalle', SHORTCUTS.OPEN_DRAWER],
      ['Siguiente / Anterior', SHORTCUTS.NEXT_TASK + ' / ' + SHORTCUTS.PREV_TASK],
      ['Colapsar / expandir', SHORTCUTS.COLLAPSE + ' / ' + SHORTCUTS.EXPAND],
    ],
  },
  {
    title: 'Acciones sobre tarea',
    rows: [
      ['Nueva tarea (inline)', SHORTCUTS.NEW_TASK],
      ['Editar título', SHORTCUTS.EDIT_TITLE],
      ['Cambiar estado', SHORTCUTS.CHANGE_STATUS],
      ['Asignar', SHORTCUTS.CHANGE_ASSIGNEE],
      ['Cambiar fecha', SHORTCUTS.CHANGE_DATE],
      ['Duplicar', SHORTCUTS.DUPLICATE],
      ['Copiar enlace', SHORTCUTS.COPY_LINK],
      ['Eliminar', SHORTCUTS.DELETE],
    ],
  },
]

export function KeyboardShortcutsOverlay() {
  const open = useUIStore((s) => s.shortcutsOverlayOpen)
  const toggle = useUIStore((s) => s.toggleShortcutsOverlay)

  return (
    <Dialog.Root open={open} onOpenChange={(v) => toggle(v)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          data-testid="keyboard-shortcuts-overlay"
          className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[95vw] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        >
          <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Keyboard className="h-5 w-5" aria-hidden />
              </div>
              <div>
                <Dialog.Title className="text-base font-semibold text-foreground">
                  Atajos de teclado
                </Dialog.Title>
                <p className="text-xs text-muted-foreground">
                  Pulsa <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd> para cerrar
                </p>
              </div>
            </div>
          </header>

          <div className="grid max-h-[68vh] grid-cols-1 gap-6 overflow-auto p-6 sm:grid-cols-2">
            {GROUPS.map((g) => (
              <section
                key={g.title}
                data-testid={`shortcuts-group-${g.title.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  {g.title}
                </h3>
                <ul className="space-y-1.5">
                  {g.rows.map(([label, key]) => (
                    <li
                      key={label}
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent/40"
                    >
                      <span className="text-foreground">{label}</span>
                      <kbd className="rounded border border-border bg-secondary px-2 py-0.5 font-mono text-[11px] text-foreground/90">
                        {displayShortcut(key)}
                      </kbd>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
