'use client'

import { useState, useTransition } from 'react'
import {
  Globe,
  ShieldCheck,
  Send,
  MessageSquare,
} from 'lucide-react'
import type { SerializedTask } from '@/lib/types'
import { createComment } from '@/lib/actions'
import { toast } from '../../Toaster'

type Props = {
  /** `null` = modo creación: tab deshabilitado / placeholder. */
  task: SerializedTask | null
  /** Se mantiene la dependencia (autor inferido). */
  users: { id: string; name: string }[]
}

/**
 * Tab "Comentarios" (renombrado desde "Seguimiento" / Tracking del drawer).
 *
 * Sprint 2: extracción 1-a-1 del JSX y handlers que estaban inline en
 * `TaskDrawerContent`. La etiqueta visible al usuario cambia a "Comentarios"
 * pero el modelo Prisma sigue siendo `Comment` con `isInternal: boolean`.
 */
export function CommentsTab({ task, users }: Props) {
  const [comment, setComment] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [isPending, startTransition] = useTransition()

  if (!task) {
    return (
      <div className="text-center py-12">
        <MessageSquare className="h-10 w-10 text-foreground mx-auto mb-2 opacity-30" />
        <p className="text-muted-foreground text-sm italic">
          Disponible al guardar la tarea.
        </p>
      </div>
    )
  }

  const handleAddComment = () => {
    if (!comment.trim()) return
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('content', comment)
        fd.set('taskId', task.id)
        fd.set('isInternal', String(isInternal))
        fd.set('authorId', users[0]?.id || '')
        await createComment(fd)
        setComment('')
        toast.success('Comentario agregado')
      } catch {
        toast.error('Error al agregar comentario')
      }
    })
  }

  return (
    <section className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-4 space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground/90">Nuevo comentario</h3>
          <div className="flex items-center gap-1 bg-background rounded-lg p-1 border border-border">
            <button
              type="button"
              onClick={() => setIsInternal(false)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-bold uppercase transition-all ${
                !isInternal
                  ? 'bg-indigo-600 text-white'
                  : 'text-muted-foreground hover:text-foreground/90'
              }`}
            >
              <Globe className="h-3 w-3" /> Externo
            </button>
            <button
              type="button"
              onClick={() => setIsInternal(true)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-bold uppercase transition-all ${
                isInternal
                  ? 'bg-amber-600 text-white'
                  : 'text-muted-foreground hover:text-foreground/90'
              }`}
            >
              <ShieldCheck className="h-3 w-3" /> Interno
            </button>
          </div>
        </div>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Escribe tu actualización... Usa @ para mencionar."
          className="w-full bg-background border border-border rounded-lg px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none h-28"
        />
        <div className="flex justify-between items-center">
          <p className="text-[11px] text-muted-foreground max-w-[200px]">
            Menciona @usuario para enviar alerta automática.
          </p>
          <button
            type="button"
            onClick={handleAddComment}
            disabled={isPending || !comment.trim()}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-bold transition-all shadow-lg"
          >
            <Send className="h-4 w-4" /> Enviar
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {task.comments?.map((c) => (
          <div
            key={c.id}
            className={`p-4 rounded-xl border relative overflow-hidden ${
              c.isInternal
                ? 'bg-amber-500/5 border-amber-500/20'
                : 'bg-card border-border'
            }`}
          >
            {c.isInternal && (
              <div className="absolute top-0 right-0 h-1 w-20 bg-amber-500 opacity-50" />
            )}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-indigo-400 border border-border">
                  {c.author?.name?.charAt(0) || '?'}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-foreground">
                    {c.author?.name || 'Sistema'}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(c.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>
              {c.isInternal && (
                <span className="flex items-center gap-1 text-[9px] font-black bg-amber-500/20 text-amber-500 px-2 py-0.5 rounded-full uppercase tracking-tighter border border-amber-500/30">
                  <ShieldCheck className="h-2.5 w-2.5" /> Comentario interno
                </span>
              )}
            </div>
            <p className="text-sm text-foreground/90 leading-relaxed pl-9">
              {c.content
                .split(/(@[\w.-]+@[\w.-]+\.\w+|@[\w.-]+)/g)
                .map((part, i) =>
                  part.startsWith('@') ? (
                    <span
                      key={i}
                      className="text-indigo-400 font-bold underline decoration-indigo-500/30 cursor-help"
                      title="Usuario mencionado"
                    >
                      {part}
                    </span>
                  ) : (
                    part
                  ),
                )}
            </p>
          </div>
        ))}
        {(!task.comments || task.comments.length === 0) && (
          <div className="text-center py-8">
            <MessageSquare className="h-10 w-10 text-foreground mx-auto mb-2 opacity-30" />
            <p className="text-muted-foreground text-xs italic">
              Aún no hay comentarios registrados.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
