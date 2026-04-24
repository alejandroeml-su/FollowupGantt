'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useMemo, useState } from 'react'
import Fuse from 'fuse.js'
import { Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useUIStore } from '@/lib/stores/ui'
import { fetchPaletteData, type PaletteEntry } from '@/lib/actions/search'

type Cmd = {
  id: string
  kind: 'task' | 'project' | 'action'
  label: string
  hint?: string
  onRun: () => void
}

/**
 * Comandos estáticos (acciones globales). Se combinan con tareas/proyectos
 * cargados bajo demanda al abrir la paleta por primera vez.
 */
function buildActionCommands(router: ReturnType<typeof useRouter>): Cmd[] {
  return [
    {
      id: 'nav:list',
      kind: 'action',
      label: 'Ir a Lista',
      hint: '/list',
      onRun: () => router.push('/list'),
    },
    {
      id: 'nav:kanban',
      kind: 'action',
      label: 'Ir a Kanban',
      hint: '/kanban',
      onRun: () => router.push('/kanban'),
    },
    {
      id: 'nav:gantt',
      kind: 'action',
      label: 'Ir a Gantt',
      hint: '/gantt',
      onRun: () => router.push('/gantt'),
    },
    {
      id: 'nav:projects',
      kind: 'action',
      label: 'Ir a Proyectos',
      hint: '/projects',
      onRun: () => router.push('/projects'),
    },
    {
      id: 'help:shortcuts',
      kind: 'action',
      label: 'Ver atajos de teclado',
      hint: 'Shift + /',
      onRun: () => useUIStore.getState().toggleShortcutsOverlay(true),
    },
  ]
}

function entryToCmd(
  e: PaletteEntry,
  router: ReturnType<typeof useRouter>,
): Cmd {
  if (e.kind === 'project') {
    return {
      id: `proj:${e.id}`,
      kind: 'project',
      label: e.label,
      hint: e.hint,
      onRun: () => router.push(`/projects/${e.id}`),
    }
  }
  return {
    id: `task:${e.id}`,
    kind: 'task',
    label: e.label,
    hint: e.hint,
    onRun: () => {
      useUIStore.getState().openDrawer(e.id)
    },
  }
}

export function CommandPalette() {
  const open = useUIStore((s) => s.commandPaletteOpen)
  const toggle = useUIStore((s) => s.toggleCommandPalette)
  const router = useRouter()
  const [q, setQ] = useState('')
  const [entries, setEntries] = useState<PaletteEntry[]>([])
  const [loaded, setLoaded] = useState(false)

  // Carga perezosa al abrir por primera vez (evita round-trip en cada render)
  useEffect(() => {
    if (!open || loaded) return
    let alive = true
    fetchPaletteData().then((data) => {
      if (alive) {
        setEntries(data)
        setLoaded(true)
      }
    })
    return () => {
      alive = false
    }
  }, [open, loaded])

  const commands = useMemo<Cmd[]>(
    () => [
      ...buildActionCommands(router),
      ...entries.map((e) => entryToCmd(e, router)),
    ],
    [entries, router],
  )

  const fuse = useMemo(
    () => new Fuse(commands, { keys: ['label', 'hint'], threshold: 0.35 }),
    [commands],
  )

  const results = q ? fuse.search(q).map((r) => r.item) : commands.slice(0, 12)

  // Limpia el query al cerrar la palette (patrón de reset UI).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!open) setQ('')
  }, [open])

  return (
    <Dialog.Root open={open} onOpenChange={(v) => toggle(v)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-[20%] z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-border dark:bg-card">
          <Dialog.Title className="sr-only">Paleta de comandos</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-border">
            <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={
                loaded
                  ? 'Buscar tareas, proyectos o acciones…'
                  : 'Cargando datos…'
              }
              className="w-full bg-transparent text-sm outline-none"
            />
            <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-muted-foreground dark:bg-secondary">
              Esc
            </kbd>
          </div>
          <ul role="listbox" className="max-h-80 overflow-auto py-1">
            {results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    c.onRun()
                    toggle(false)
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-blue-50 dark:hover:bg-secondary"
                >
                  <span className="flex items-center gap-2">
                    <KindBadge k={c.kind} />
                    <span>{c.label}</span>
                  </span>
                  {c.hint && (
                    <span className="text-xs text-muted-foreground">{c.hint}</span>
                  )}
                </button>
              </li>
            ))}
            {results.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                Sin coincidencias
              </li>
            )}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function KindBadge({ k }: { k: Cmd['kind'] }) {
  const map = {
    task: { label: 'tarea', cls: 'bg-indigo-500/15 text-indigo-400' },
    project: { label: 'proyecto', cls: 'bg-emerald-500/15 text-emerald-400' },
    action: { label: 'acción', cls: 'bg-amber-500/15 text-amber-400' },
  }[k]
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${map.cls}`}
    >
      {map.label}
    </span>
  )
}
