'use client'

/**
 * Ola P2 · Equipo P2-5 — Sección "Docs" del TaskDrawer.
 *
 * Lista los docs vinculados a una task. Read-only en MVP: para crear o
 * editar el contenido el usuario va a `/docs`. Sí permitimos crear UN doc
 * vinculado directamente desde aquí (atajo).
 */

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { FileText, Plus, ExternalLink } from 'lucide-react'
import { getDocsForTask } from '@/lib/actions/docs'
import { CreateDocDialog } from './CreateDocDialog'

type Props = {
  taskId: string
}

type DocLink = { id: string; title: string; updatedAt: string }

export function TaskDocsSection({ taskId }: Props) {
  const [docs, setDocs] = useState<DocLink[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const lastTaskIdRef = useRef<string | null>(null)

  function reload(targetTaskId: string) {
    start(async () => {
      try {
        const list = await getDocsForTask(targetTaskId)
        setDocs(list)
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error desconocido')
        setDocs([])
      }
    })
  }

  // Lazy-load: la primera vez por taskId, cargamos. Esto se dispara desde
  // un useEffect SIN setState síncrono (la ref se muta primero, y reload
  // arranca un transition que actualiza state asíncronamente).
  useEffect(() => {
    if (lastTaskIdRef.current === taskId) return
    lastTaskIdRef.current = taskId
    reload(taskId)
  }, [taskId])

  return (
    <section data-testid="task-docs-section">
      <header className="mb-2 flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <FileText className="h-3.5 w-3.5 text-primary" />
          Docs
          {docs ? (
            <span className="text-[10px] text-muted-foreground">
              ({docs.length})
            </span>
          ) : null}
        </h4>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] hover:bg-secondary"
          data-testid="task-docs-new"
        >
          <Plus className="h-3 w-3" />
          Nuevo
        </button>
      </header>

      {error ? (
        <p className="text-[11px] text-red-500">{error}</p>
      ) : docs === null ? (
        <p className="text-[11px] text-muted-foreground">Cargando…</p>
      ) : docs.length === 0 ? (
        <p className="rounded border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
          Aún no hay documentos vinculados a esta tarea.
        </p>
      ) : (
        <ul className="space-y-1" data-testid="task-docs-list">
          {docs.map((d) => (
            <li key={d.id}>
              <Link
                href={`/docs?id=${d.id}`}
                className="flex items-center justify-between gap-2 rounded border border-border bg-card/40 px-2 py-1.5 text-xs hover:border-primary"
              >
                <span className="inline-flex items-center gap-1.5 truncate">
                  <FileText className="h-3 w-3 text-muted-foreground" />
                  {d.title}
                </span>
                <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <CreateDocDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        parentOptions={[]}
        defaultTaskId={taskId}
        onCreated={() => {
          setCreateOpen(false)
          reload(taskId)
        }}
      />
    </section>
  )
}
