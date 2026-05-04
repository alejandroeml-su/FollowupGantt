'use client'

/**
 * Ola P2 · Equipo P2-5 — Sección "Docs del proyecto" para la project page.
 *
 * Misma forma que `TaskDocsSection` pero filtrando por projectId.
 */

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { FileText, Plus, ExternalLink } from 'lucide-react'
import { getDocsForProject } from '@/lib/actions/docs'
import { CreateDocDialog } from './CreateDocDialog'

type Props = {
  projectId: string
}

type DocLink = { id: string; title: string; updatedAt: string }

export function ProjectDocsSection({ projectId }: Props) {
  const [docs, setDocs] = useState<DocLink[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const lastProjectIdRef = useRef<string | null>(null)

  function reload(targetProjectId: string) {
    start(async () => {
      try {
        const list = await getDocsForProject(targetProjectId)
        setDocs(list)
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error desconocido')
        setDocs([])
      }
    })
  }

  useEffect(() => {
    if (lastProjectIdRef.current === projectId) return
    lastProjectIdRef.current = projectId
    reload(projectId)
  }, [projectId])

  return (
    <section
      className="rounded-xl border border-border bg-card p-6 shadow-sm"
      data-testid="project-docs-section"
    >
      <header className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <FileText className="h-4 w-4 text-primary" />
          Docs del proyecto
          {docs ? (
            <span className="text-[11px] text-muted-foreground">
              ({docs.length})
            </span>
          ) : null}
        </h3>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-secondary"
        >
          <Plus className="h-3 w-3" />
          Nuevo doc
        </button>
      </header>

      {error ? (
        <p className="text-xs text-red-500">{error}</p>
      ) : docs === null ? (
        <p className="text-xs text-muted-foreground">Cargando…</p>
      ) : docs.length === 0 ? (
        <p className="rounded border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          Aún no hay documentos vinculados a este proyecto.
        </p>
      ) : (
        <ul className="space-y-1.5" data-testid="project-docs-list">
          {docs.map((d) => (
            <li key={d.id}>
              <Link
                href={`/docs?id=${d.id}`}
                className="flex items-center justify-between gap-2 rounded border border-border bg-background px-3 py-2 text-sm hover:border-primary"
              >
                <span className="inline-flex items-center gap-2 truncate">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  {d.title}
                </span>
                <span className="inline-flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                  {new Date(d.updatedAt).toLocaleDateString()}
                  <ExternalLink className="h-3 w-3" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <CreateDocDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        parentOptions={[]}
        defaultProjectId={projectId}
        onCreated={() => {
          setCreateOpen(false)
          reload(projectId)
        }}
      />
    </section>
  )
}
