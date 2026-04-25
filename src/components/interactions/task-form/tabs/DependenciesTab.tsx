'use client'

import { useMemo, useState, useTransition } from 'react'
import { ChevronRight, Trash2, Plus, GitBranch } from 'lucide-react'
import type { SerializedTask } from '@/lib/types'
import { addDependency, removeDependency } from '@/lib/actions'
import { toast } from '../../Toaster'

export type DepType =
  | 'FINISH_TO_START'
  | 'START_TO_START'
  | 'FINISH_TO_FINISH'
  | 'START_TO_FINISH'

const DEP_TYPES: { value: DepType; short: string; label: string }[] = [
  { value: 'FINISH_TO_START', short: 'FS', label: 'Fin → Inicio (FS)' },
  { value: 'START_TO_START', short: 'SS', label: 'Inicio → Inicio (SS)' },
  { value: 'FINISH_TO_FINISH', short: 'FF', label: 'Fin → Fin (FF)' },
  { value: 'START_TO_FINISH', short: 'SF', label: 'Inicio → Fin (SF)' },
]

type Props = {
  /** `null` = modo creación: tab placeholder. */
  task: SerializedTask | null
  allTasks?: SerializedTask[]
}

/**
 * Tab "Dependencias" — extraído del `RelationsTab` interno de
 * `TaskDrawerContent`. Renombrado en UI ("Relaciones" → "Dependencias")
 * pero el modelo Prisma sigue siendo `TaskDependency` con `predecessors` /
 * `successors`. Ambas direcciones se mantienen en el mismo tab.
 */
export function DependenciesTab({ task, allTasks = [] }: Props) {
  const [isPending, startTransition] = useTransition()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [depType, setDepType] = useState<DepType>('FINISH_TO_START')

  const existingPredIds = useMemo(
    () =>
      new Set(
        (task?.predecessors ?? []).map(
          (p: { predecessorId: string }) => p.predecessorId,
        ),
      ),
    [task?.predecessors],
  )

  const candidates = useMemo(() => {
    if (!task) return []
    const q = query.trim().toLowerCase()
    return allTasks
      .filter((t) => t.id !== task.id && !existingPredIds.has(t.id))
      .filter((t) => {
        if (!q) return true
        const mnemonic = (t.mnemonic || '').toLowerCase()
        return mnemonic.includes(q) || t.title.toLowerCase().includes(q)
      })
      .slice(0, 50)
  }, [allTasks, task, existingPredIds, query])

  if (!task) {
    return (
      <div className="text-center py-12">
        <GitBranch className="h-10 w-10 text-foreground mx-auto mb-2 opacity-30" />
        <p className="text-muted-foreground text-sm italic">
          Disponible al guardar la tarea.
        </p>
      </div>
    )
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAdd = (predecessorIds: string[], dt: DepType) => {
    if (predecessorIds.length === 0) return
    startTransition(async () => {
      const results = await Promise.allSettled(
        predecessorIds.map((predecessorId) => {
          const fd = new FormData()
          fd.set('predecessorId', predecessorId)
          fd.set('successorId', task.id)
          fd.set('type', dt)
          return addDependency(fd)
        }),
      )
      const ok = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.length - ok
      if (ok > 0)
        toast.success(`${ok} dependencia${ok === 1 ? '' : 's'} añadida${ok === 1 ? '' : 's'}`)
      if (failed > 0)
        toast.error(`${failed} dependencia${failed === 1 ? '' : 's'} fallaron`)
    })
  }

  const handleRemove = (predecessorId: string, successorId: string) => {
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('predecessorId', predecessorId)
        fd.set('successorId', successorId)
        await removeDependency(fd)
        toast.success('Dependencia eliminada')
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Error al eliminar dependencia',
        )
      }
    })
  }

  const addBatch = () => {
    if (selected.size === 0) return
    handleAdd(Array.from(selected), depType)
    setSelected(new Set())
    setQuery('')
  }

  const depShort = (t: DepType) => DEP_TYPES.find((d) => d.value === t)?.short ?? t

  return (
    <section className="space-y-8">
      {/* Predecesoras */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-foreground/90 flex items-center gap-2">
          <ChevronRight className="h-4 w-4 text-indigo-500 rotate-90" />
          Predecesoras (Tareas que bloquean a esta)
        </h3>
        <div className="space-y-2">
          {task.predecessors?.map(
            (p: {
              id: string
              predecessorId: string
              type?: DepType
              predecessor: { mnemonic?: string | null; id: string; title: string }
            }) => (
              <div
                key={p.id}
                className="flex items-center justify-between p-3 bg-subtle/50 border border-border rounded-lg group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 shrink-0">
                    {p.predecessor.mnemonic || p.predecessor.id.substring(0, 6)}
                  </span>
                  {p.type && (
                    <span
                      className="text-[9px] font-black uppercase tracking-widest text-amber-300 bg-amber-500/15 border border-amber-500/40 px-1.5 py-0.5 rounded shrink-0"
                      title={DEP_TYPES.find((d) => d.value === p.type)?.label}
                    >
                      {depShort(p.type)}
                    </span>
                  )}
                  <span className="text-sm text-foreground/90 truncate">
                    {p.predecessor.title}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(p.predecessorId, task.id)}
                  disabled={isPending}
                  className="p-1.5 text-muted-foreground hover:text-rose-400 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-30 shrink-0"
                  aria-label="Eliminar predecesora"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ),
          )}
          {(!task.predecessors || task.predecessors.length === 0) && (
            <p className="text-xs text-muted-foreground italic pl-6">
              No hay predecesoras definidas.
            </p>
          )}
        </div>
      </div>

      {/* Sucesoras */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-foreground/90 flex items-center gap-2">
          <ChevronRight className="h-4 w-4 text-indigo-500" />
          Sucesoras (Tareas bloqueadas por esta)
        </h3>
        <div className="space-y-2">
          {task.successors?.map(
            (s: {
              id: string
              successorId: string
              type?: DepType
              successor: { mnemonic?: string | null; id: string; title: string }
            }) => (
              <div
                key={s.id}
                className="flex items-center justify-between p-3 bg-subtle/50 border border-border rounded-lg group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 shrink-0">
                    {s.successor.mnemonic || s.successor.id.substring(0, 6)}
                  </span>
                  {s.type && (
                    <span
                      className="text-[9px] font-black uppercase tracking-widest text-amber-300 bg-amber-500/15 border border-amber-500/40 px-1.5 py-0.5 rounded shrink-0"
                      title={DEP_TYPES.find((d) => d.value === s.type)?.label}
                    >
                      {depShort(s.type)}
                    </span>
                  )}
                  <span className="text-sm text-foreground/90 truncate">
                    {s.successor.title}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(task.id, s.successorId)}
                  disabled={isPending}
                  className="p-1.5 text-muted-foreground hover:text-rose-400 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-30 shrink-0"
                  aria-label="Eliminar sucesora"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ),
          )}
          {(!task.successors || task.successors.length === 0) && (
            <p className="text-xs text-muted-foreground italic pl-6">
              No hay sucesoras definidas.
            </p>
          )}
        </div>
      </div>

      {/* Añadir múltiples predecesoras */}
      <div className="pt-4 border-t border-border space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">
            Añadir predecesoras{' '}
            {selected.size > 0 && (
              <span className="text-indigo-400">
                · {selected.size} seleccionada
                {selected.size === 1 ? '' : 's'}
              </span>
            )}
          </p>
          <select
            value={depType}
            onChange={(e) => setDepType(e.target.value as DepType)}
            disabled={isPending}
            className="bg-input border border-border rounded px-2 py-1 text-[11px] text-input-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label="Tipo de dependencia"
          >
            {DEP_TYPES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por mnemónico o título..."
          className="w-full bg-input border border-border rounded-lg px-3 py-2 text-xs text-input-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />

        <div className="max-h-60 overflow-y-auto custom-scrollbar rounded-lg border border-border divide-y divide-border/50">
          {candidates.length === 0 ? (
            <p className="text-xs text-muted-foreground italic p-4 text-center">
              {query
                ? 'Ninguna tarea coincide con la búsqueda.'
                : 'No hay tareas disponibles para agregar.'}
            </p>
          ) : (
            candidates.map((t) => {
              const isSel = selected.has(t.id)
              return (
                <label
                  key={t.id}
                  className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                    isSel ? 'bg-indigo-500/10' : 'hover:bg-secondary/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => toggle(t.id)}
                    className="h-3.5 w-3.5 accent-indigo-500 cursor-pointer"
                  />
                  <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 shrink-0">
                    {t.mnemonic || t.id.substring(0, 6)}
                  </span>
                  <span className="text-xs text-foreground/90 truncate">{t.title}</span>
                </label>
              )
            })
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={isPending}
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground/90 transition-colors"
            >
              Limpiar
            </button>
          )}
          <button
            type="button"
            onClick={addBatch}
            disabled={isPending || selected.size === 0}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all"
          >
            <Plus className="h-3.5 w-3.5" />
            {selected.size === 0
              ? 'Añadir dependencia'
              : `Añadir ${selected.size} dependencia${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </section>
  )
}
