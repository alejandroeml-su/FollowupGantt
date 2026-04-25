'use client'

import { useEffect, useRef, useState } from 'react'
import { X, FileText, Link2, Hash, Search } from 'lucide-react'
import type { AvailableTask } from './MindMapEditor'

type Props = {
  node: {
    id: string
    label: string
    note: string | null
    taskId: string | null
    task: { id: string; mnemonic: string | null; title: string } | null
    isRoot: boolean
  }
  availableTasks: AvailableTask[]
  onLabelChange: (label: string) => void
  onNoteChange: (note: string | null) => void
  onTaskChange: (taskId: string | null) => void
  onClose: () => void
}

export function NotePanel({
  node,
  availableTasks,
  onLabelChange,
  onNoteChange,
  onTaskChange,
  onClose,
}: Props) {
  const [label, setLabel] = useState(node.label)
  const [note, setNote] = useState(node.note ?? '')
  const [taskQuery, setTaskQuery] = useState('')
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const labelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* eslint-disable react-hooks/set-state-in-effect */
  // Reset del formulario al cambiar de nodo seleccionado (evento, no render-derivado).
  useEffect(() => {
    setLabel(node.label)
    setNote(node.note ?? '')
    setTaskQuery('')
  }, [node.id, node.label, node.note])
  /* eslint-enable react-hooks/set-state-in-effect */

  const scheduleLabel = (v: string) => {
    setLabel(v)
    if (labelTimer.current) clearTimeout(labelTimer.current)
    labelTimer.current = setTimeout(() => onLabelChange(v.trim() || 'Nuevo nodo'), 500)
  }

  const scheduleNote = (v: string) => {
    setNote(v)
    if (noteTimer.current) clearTimeout(noteTimer.current)
    noteTimer.current = setTimeout(() => onNoteChange(v.trim() ? v : null), 600)
  }

  const filteredTasks = availableTasks
    .filter((t) => {
      if (!taskQuery.trim()) return true
      const q = taskQuery.trim().toLowerCase()
      return (
        (t.mnemonic ?? '').toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        (t.projectName ?? '').toLowerCase().includes(q)
      )
    })
    .slice(0, 30)

  return (
    <aside
      className="absolute top-0 right-0 h-full w-[340px] max-w-full bg-card border-l border-border shadow-2xl flex flex-col z-10"
      aria-label="Panel de detalle del nodo"
    >
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-primary" />
          Detalle del nodo
        </h3>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
          aria-label="Cerrar panel"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-5">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Título {node.isRoot && <span className="text-primary">· Raíz</span>}
          </label>
          <input
            value={label}
            onChange={(e) => scheduleLabel(e.target.value)}
            className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm font-semibold text-input-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Nota (Markdown opcional)
          </label>
          <textarea
            value={note}
            onChange={(e) => scheduleNote(e.target.value)}
            rows={10}
            placeholder="Agrega detalles, contexto, referencias..."
            className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-input-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none leading-relaxed"
          />
          <p className="text-[10px] text-muted-foreground">
            Se guarda automáticamente al dejar de escribir.
          </p>
        </div>

        <div className="space-y-1.5 pt-2 border-t border-border">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
            <Link2 className="h-3 w-3" />
            Enlazar tarea
          </label>

          {node.task ? (
            <div className="flex items-center justify-between gap-2 bg-indigo-500/10 border border-indigo-500/30 rounded-lg px-3 py-2">
              <span className="flex items-center gap-2 min-w-0">
                <Hash className="h-3 w-3 text-indigo-400 shrink-0" />
                <span className="text-[10px] font-bold text-indigo-400 shrink-0">
                  {node.task.mnemonic || node.task.id.substring(0, 6)}
                </span>
                <span className="text-xs text-foreground truncate">{node.task.title}</span>
              </span>
              <button
                onClick={() => onTaskChange(null)}
                className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive shrink-0"
                aria-label="Desenlazar tarea"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="search"
                  value={taskQuery}
                  onChange={(e) => setTaskQuery(e.target.value)}
                  placeholder="Buscar tarea por mnemónico o título..."
                  className="w-full bg-input border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-input-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="max-h-52 overflow-y-auto custom-scrollbar rounded-lg border border-border divide-y divide-border/40">
                {filteredTasks.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic p-3 text-center">
                    {taskQuery ? 'Sin coincidencias.' : 'No hay tareas disponibles.'}
                  </p>
                ) : (
                  filteredTasks.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => onTaskChange(t.id)}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-secondary/60 transition-colors"
                    >
                      <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/30 px-1.5 py-0.5 rounded shrink-0">
                        {t.mnemonic || t.id.substring(0, 6)}
                      </span>
                      <span className="text-xs text-foreground truncate">{t.title}</span>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  )
}
