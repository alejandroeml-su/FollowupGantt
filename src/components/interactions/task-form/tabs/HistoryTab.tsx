'use client'

import { ChevronRight, History, Activity } from 'lucide-react'
import type { SerializedTask } from '@/lib/types'

type Props = {
  /** `null` = modo creación: tab placeholder. */
  task: SerializedTask | null
}

/**
 * Tab "Historial" extraído 1-a-1 desde `TaskDrawerContent`.
 * Sin handlers — sólo render del array `task.history`.
 */
export function HistoryTab({ task }: Props) {
  if (!task) {
    return (
      <div className="text-center py-12">
        <History className="h-10 w-10 text-foreground mx-auto mb-2 opacity-30" />
        <p className="text-muted-foreground text-sm italic">
          Disponible al guardar la tarea.
        </p>
      </div>
    )
  }

  return (
    <section className="space-y-4">
      <div className="space-y-0 relative before:absolute before:left-[15px] before:top-2 before:bottom-2 before:w-[2px] before:bg-secondary/50">
        {task.history?.map((h) => (
          <div key={h.id} className="relative pl-10 pb-8 group">
            <div className="absolute left-0 top-1 h-8 w-8 rounded-full bg-background border-2 border-border flex items-center justify-center z-10 group-hover:border-indigo-500 transition-all">
              <History className="h-3.5 w-3.5 text-muted-foreground group-hover:text-indigo-400" />
            </div>
            <div className="bg-card/40 border border-border/50 rounded-xl p-4 text-sm group-hover:border-border transition-all">
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-black text-xs text-indigo-400 uppercase tracking-widest">
                    {h.field}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground font-medium">
                  {new Date(h.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Modificado por{' '}
                <span className="text-foreground font-bold">
                  @{h.user?.name || 'Sistema'}
                </span>
              </p>
              <div className="flex items-center gap-3 font-mono text-[11px] p-2 bg-background/95 rounded border border-border/50">
                <span className="text-rose-400/70 line-through truncate max-w-[120px]">
                  {h.oldValue || '(vacio)'}
                </span>
                <ChevronRight className="h-3 w-3 text-foreground shrink-0" />
                <span className="text-emerald-400 truncate max-w-[120px]">
                  {h.newValue || '(vacio)'}
                </span>
              </div>
            </div>
          </div>
        ))}
        {(!task.history || task.history.length === 0) && (
          <div className="text-center py-12">
            <Activity className="h-12 w-12 text-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm italic">
              No hay historial de cambios aún.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
