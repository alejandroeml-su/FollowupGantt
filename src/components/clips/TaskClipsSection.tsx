'use client'

/**
 * Wave R4 · US-7.3 · Clips de video — Sección embebida en TaskDrawer.
 *
 * Compone `ClipRecorder` (modal on-demand) + listado de `ClipPlayer`s.
 * Hace feature detection: si el navegador no soporta Screen Capture API
 * (Safari iOS, Chrome Android, etc.), el botón "Grabar clip" se sustituye
 * por un hint informativo.
 */

import { useEffect, useRef, useState } from 'react'
import { Video, Plus, Info } from 'lucide-react'
import { ClipRecorder } from './ClipRecorder'
import { ClipPlayer } from './ClipPlayer'
import { deleteClip, listClipsForTask } from '@/lib/actions/clips'
import {
  canRecordClips,
  type ClipDTO,
} from '@/lib/storage/clip-validation'

interface Props {
  taskId: string
}

export function TaskClipsSection({ taskId }: Props) {
  const [items, setItems] = useState<ClipDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recorderOpen, setRecorderOpen] = useState(false)
  const [canRecord, setCanRecord] = useState(false)
  const lastTaskIdRef = useRef<string | null>(null)

  // Feature detection sólo cliente — `canRecordClips` consulta `navigator`.
  // El estado arranca en false para que SSR renderice consistente y el
  // botón aparezca tras hidratación. `setState` síncrono dentro del effect
  // es necesario aquí (regla react-hooks/set-state-in-effect): no hay
  // forma de hidratar este flag sin pasar por effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCanRecord(canRecordClips())
  }, [])

  useEffect(() => {
    if (lastTaskIdRef.current === taskId) return
    lastTaskIdRef.current = taskId
    let cancelled = false
    listClipsForTask({ taskId })
      .then((rows) => {
        if (cancelled) return
        setItems(rows)
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setItems([])
        setError(e instanceof Error ? e.message : 'Error al cargar clips')
      })
    return () => {
      cancelled = true
    }
  }, [taskId])

  function handleCreated(clip: ClipDTO) {
    setItems((prev) => (prev ? [clip, ...prev] : [clip]))
  }

  async function handleDelete(clipId: string) {
    const prev = items
    // Optimistic.
    setItems((curr) => (curr ? curr.filter((c) => c.id !== clipId) : curr))
    try {
      await deleteClip({ clipId })
    } catch (e) {
      setItems(prev)
      setError(e instanceof Error ? e.message : 'Error al eliminar clip')
    }
  }

  return (
    <section
      aria-labelledby="clips-heading"
      data-testid="task-clips-section"
      className="space-y-3"
    >
      <div className="flex items-center justify-between">
        <h3
          id="clips-heading"
          className="flex items-center gap-2 text-sm font-medium"
        >
          <Video className="h-4 w-4 text-muted-foreground" aria-hidden />
          Clips de video
          {items ? (
            <span
              className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              aria-label={`${items.length} clips`}
            >
              {items.length}
            </span>
          ) : null}
        </h3>
        {canRecord ? (
          <button
            type="button"
            onClick={() => setRecorderOpen(true)}
            data-testid="task-clip-record-button"
            className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs hover:bg-muted"
          >
            <Plus className="h-3 w-3" aria-hidden />
            <span aria-hidden>🎥</span>
            Grabar clip
          </button>
        ) : null}
      </div>

      {!canRecord ? (
        <p
          className="flex items-center gap-2 rounded border border-border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground"
          data-testid="task-clip-unsupported"
        >
          <Info className="h-3 w-3" aria-hidden />
          Grabar clips solo está disponible en navegadores desktop (Chrome,
          Edge, Firefox). En iOS, Safari móvil y Chrome Android puedes ver
          los clips existentes.
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          data-testid="task-clips-error"
          className="rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}

      {items === null ? (
        <p className="text-xs text-muted-foreground">Cargando clips…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No hay clips para esta tarea todavía.
        </p>
      ) : (
        <ul role="list" className="space-y-3">
          {items.map((clip) => (
            <li key={clip.id}>
              <ClipPlayer clip={clip} onDelete={handleDelete} />
            </li>
          ))}
        </ul>
      )}

      {recorderOpen && canRecord ? (
        <ClipRecorder
          taskId={taskId}
          onCreated={handleCreated}
          onClose={() => setRecorderOpen(false)}
        />
      ) : null}
    </section>
  )
}
