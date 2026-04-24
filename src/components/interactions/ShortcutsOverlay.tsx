'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useUIStore } from '@/lib/stores/ui'
import { SHORTCUTS, displayShortcut } from '@/lib/keys'

const GROUPS = [
  {
    title: 'Navegación',
    rows: [
      ['Mover foco', SHORTCUTS.FOCUS_DOWN + ' / ' + SHORTCUTS.FOCUS_UP],
      ['Abrir detalle', SHORTCUTS.OPEN_DRAWER],
      ['Cerrar / volver', SHORTCUTS.CLOSE],
      ['Siguiente / Anterior', SHORTCUTS.NEXT_TASK + ' / ' + SHORTCUTS.PREV_TASK],
      ['Paleta de comandos', SHORTCUTS.COMMAND_PALETTE],
    ],
  },
  {
    title: 'Acciones rápidas',
    rows: [
      ['Nueva tarea', SHORTCUTS.NEW_TASK],
      ['Editar título', SHORTCUTS.EDIT_TITLE],
      ['Cambiar estado', SHORTCUTS.CHANGE_STATUS],
      ['Asignar', SHORTCUTS.CHANGE_ASSIGNEE],
      ['Fecha', SHORTCUTS.CHANGE_DATE],
      ['Duplicar', SHORTCUTS.DUPLICATE],
      ['Copiar enlace', SHORTCUTS.COPY_LINK],
      ['Eliminar', SHORTCUTS.DELETE],
    ],
  },
]

export function ShortcutsOverlay() {
  const open = useUIStore((s) => s.shortcutsOverlayOpen)
  const toggle = useUIStore((s) => s.toggleShortcutsOverlay)

  return (
    <Dialog.Root open={open} onOpenChange={(v) => toggle(v)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-border dark:bg-card">
          <Dialog.Title className="mb-4 text-lg font-semibold">
            Atajos de teclado
          </Dialog.Title>
          <div className="grid grid-cols-2 gap-6">
            {GROUPS.map((g) => (
              <section key={g.title}>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {g.title}
                </h3>
                <ul className="space-y-1">
                  {g.rows.map(([label, key]) => (
                    <li key={label} className="flex justify-between text-sm">
                      <span>{label}</span>
                      <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-foreground dark:bg-secondary dark:text-foreground/90">
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
