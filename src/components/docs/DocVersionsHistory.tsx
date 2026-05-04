'use client'

/**
 * Ola P2 · Equipo P2-5 — Lista de versiones del doc + restore.
 *
 * Carga las versiones lazy (al expandir el panel) y permite restaurar
 * una versión, lo que crea una nueva entrada en el historial (D-DOC-A2).
 */

import { useState, useTransition } from 'react'
import { History, RotateCcw, Loader2 } from 'lucide-react'
import {
  getDocVersions,
  restoreDocVersion,
  type DocVersionListItem,
} from '@/lib/actions/docs'

type Props = {
  docId: string
  /** Llamado al restaurar exitosamente — el padre debe recargar el doc. */
  onRestored?: () => void
}

export function DocVersionsHistory({ docId, onRestored }: Props) {
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<DocVersionListItem[] | null>(null)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function loadVersions() {
    start(async () => {
      try {
        const v = await getDocVersions(docId)
        setVersions(v)
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error desconocido')
        setVersions([])
      }
    })
  }

  function handleToggle() {
    setOpen((prev) => {
      const next = !prev
      // Disparamos la carga DESDE el handler (no useEffect) para no caer
      // en `react-hooks/set-state-in-effect`. La carga es lazy: la primera
      // vez que se abre el panel, o cualquier reapertura para refrescar.
      if (next) loadVersions()
      return next
    })
  }

  function handleRestore(versionId: string) {
    if (!confirm('¿Restaurar esta versión? El contenido actual será reemplazado.'))
      return
    start(async () => {
      try {
        await restoreDocVersion(versionId)
        // Refresca la lista para mostrar la nueva entrada de auditoría.
        const v = await getDocVersions(docId)
        setVersions(v)
        onRestored?.()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error desconocido')
      }
    })
  }

  return (
    <section
      className="border-t border-border bg-card/30"
      data-testid="doc-versions-history"
    >
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2">
          <History className="h-3.5 w-3.5" />
          Historial de versiones
          {versions ? <span className="text-[10px]">({versions.length})</span> : null}
        </span>
        <span className="text-[10px]">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="border-t border-border px-4 py-2">
          {pending && !versions ? (
            <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Cargando…
            </p>
          ) : error ? (
            <p className="text-[11px] text-red-500">{error}</p>
          ) : versions && versions.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              Sin versiones todavía.
            </p>
          ) : (
            <ul className="space-y-2">
              {versions?.map((v) => (
                <li
                  key={v.id}
                  className="rounded border border-border bg-card p-2"
                  data-testid="doc-version-row"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-foreground">
                        {new Date(v.createdAt).toLocaleString()}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {v.authorName}
                        {v.changeNote ? ` · ${v.changeNote}` : ''}
                      </p>
                      {v.contentPreview ? (
                        <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">
                          {v.contentPreview}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRestore(v.id)}
                      disabled={pending}
                      className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] hover:bg-secondary disabled:opacity-60"
                      title="Restaurar versión"
                      data-testid="doc-version-restore"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Restaurar versión
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
