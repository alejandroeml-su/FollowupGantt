'use client'

import { useTransition } from 'react'
import { Paperclip, FileIcon, Link2 } from 'lucide-react'
import type { SerializedTask } from '@/lib/types'
import { createAttachment } from '@/lib/actions'
import { toast } from '../../Toaster'

type Props = {
  /** `null` = modo creación: tab placeholder. */
  task: SerializedTask | null
}

/**
 * Tab "Adjuntos" extraído 1-a-1 desde `TaskDrawerContent`.
 * Mantiene el "subir simulado" del drawer (un PDF mock por click).
 */
export function AttachmentsTab({ task }: Props) {
  const [isPending, startTransition] = useTransition()

  if (!task) {
    return (
      <div className="text-center py-12">
        <Paperclip className="h-10 w-10 text-foreground mx-auto mb-2 opacity-30" />
        <p className="text-muted-foreground text-sm italic">
          Disponible al guardar la tarea.
        </p>
      </div>
    )
  }

  const handleSimulateUpload = () => {
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('taskId', task.id)
        fd.set('filename', 'respaldo_actividad.pdf')
        fd.set('url', 'https://example.com/file.pdf')
        await createAttachment(fd)
        toast.success('Archivo adjuntado (Simulado)')
      } catch {
        toast.error('Error al adjuntar archivo')
      }
    })
  }

  return (
    <section className="space-y-6">
      <div
        className="border-2 border-dashed border-border rounded-2xl p-10 text-center space-y-4 hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all cursor-pointer group"
        onClick={handleSimulateUpload}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleSimulateUpload()
        }}
      >
        <div className="h-14 w-14 rounded-full bg-card border border-border flex items-center justify-center mx-auto group-hover:scale-110 transition-transform shadow-lg">
          <Paperclip className="h-6 w-6 text-muted-foreground group-hover:text-indigo-400" />
        </div>
        <div>
          <p className="text-sm font-bold text-foreground">Subir archivos de respaldo</p>
          <p className="text-[11px] text-muted-foreground mt-1 uppercase tracking-tighter">
            Documenta tus actividades realizadas
          </p>
        </div>
        <button
          type="button"
          disabled={isPending}
          className="bg-indigo-600 text-white px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest hover:bg-indigo-500 transition-colors shadow-lg disabled:opacity-50"
        >
          Seleccionar Archivos
        </button>
      </div>

      <div className="space-y-3">
        {task.attachments?.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between p-4 bg-card border border-border rounded-xl group hover:bg-secondary/50 transition-all border-l-4 border-l-indigo-500"
          >
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                <FileIcon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground group-hover:text-indigo-300 transition-colors">
                  {a.filename}
                </p>
                <p className="text-[10px] text-muted-foreground font-medium">
                  Subido por {a.user?.name || 'Sistema'} ·{' '}
                  {new Date(a.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="p-2 bg-background rounded-lg text-muted-foreground hover:text-white transition-colors border border-border"
              >
                <Link2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
        {(!task.attachments || task.attachments.length === 0) && (
          <div className="text-center py-8">
            <Paperclip className="h-10 w-10 text-foreground mx-auto mb-2 opacity-30" />
            <p className="text-muted-foreground text-xs italic">
              No hay archivos adjuntos aún.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
