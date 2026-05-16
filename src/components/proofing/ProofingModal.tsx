'use client'

/**
 * US-7.5 · Proofing (R4) — Modal contenedor.
 *
 * Layout dos columnas (canvas + lista). Carga signed URL del attachment y
 * sus anotaciones, expone callbacks que hablan con los server actions de
 * `@/lib/actions/proofing`.
 *
 * Decisión: la lista lateral es siempre visible para flujos de revisión
 * (mismo patrón que Figma/Frame.io). Versionado (compare versions) lo
 * difiero a una iteración menor — el modelo `AttachmentVersion` ya está,
 * la UI requiere coordinación adicional con un Uploader de versión que
 * no entró en el alcance de la US (deuda registrada).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  createAnnotation,
  listAnnotationsForAttachment,
  replyAnnotation,
  updateAnnotationStatus,
  deleteAnnotation,
  type ProofingAnnotationDTO,
} from '@/lib/actions/proofing'
import { getSignedUrl, type SignedUrlResult } from '@/lib/storage/get-signed-url'
import { ProofingCanvas } from './ProofingCanvas'
import { AnnotationList, type AnnotationListFilter } from './AnnotationList'

export interface ProofingModalProps {
  attachmentId: string
  mimeTypeHint?: string | null
  filenameHint?: string
  onClose: () => void
}

export function ProofingModal({
  attachmentId,
  mimeTypeHint,
  filenameHint,
  onClose,
}: ProofingModalProps) {
  const [signed, setSigned] = useState<SignedUrlResult | null>(null)
  const [annotations, setAnnotations] = useState<ProofingAnnotationDTO[]>([])
  const [filter, setFilter] = useState<AnnotationListFilter>('ALL')
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const lastAttachmentIdRef = useRef<string | null>(null)

  const refreshAnnotations = useCallback(async () => {
    try {
      const rows = await listAnnotationsForAttachment({ attachmentId })
      setAnnotations(rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar anotaciones')
    }
  }, [attachmentId])

  useEffect(() => {
    if (lastAttachmentIdRef.current === attachmentId) return
    lastAttachmentIdRef.current = attachmentId
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      getSignedUrl({ attachmentId }),
      listAnnotationsForAttachment({ attachmentId }),
    ])
      .then(([s, rows]) => {
        if (cancelled) return
        setSigned(s)
        setAnnotations(rows)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Error al cargar proofing')
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [attachmentId])

  // Cierre con Escape (parental UX).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (typeof window === 'undefined') return
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleCreate = useCallback(
    async (input: { x: number; y: number; text: string }) => {
      await createAnnotation({
        attachmentId,
        x: input.x,
        y: input.y,
        text: input.text,
      })
      await refreshAnnotations()
    },
    [attachmentId, refreshAnnotations],
  )

  const handleReply = useCallback(
    async (parentId: string, text: string) => {
      await replyAnnotation({ parentAnnotationId: parentId, text })
      await refreshAnnotations()
    },
    [refreshAnnotations],
  )

  const handleUpdateStatus = useCallback(
    async (
      id: string,
      status: 'OPEN' | 'RESOLVED' | 'CHANGES_REQUESTED',
    ) => {
      await updateAnnotationStatus({ annotationId: id, status })
      await refreshAnnotations()
    },
    [refreshAnnotations],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteAnnotation({ annotationId: id })
      await refreshAnnotations()
    },
    [refreshAnnotations],
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="proofing-modal-title"
      data-testid="proofing-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-md bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-2">
          <h2
            id="proofing-modal-title"
            className="truncate text-sm font-semibold"
            title={filenameHint ?? signed?.filename ?? 'Proofing'}
          >
            Proofing · {filenameHint ?? signed?.filename ?? 'archivo'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            data-testid="proofing-modal-close"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        {loading ? (
          <div
            className="flex h-64 items-center justify-center text-xs text-muted-foreground"
            data-testid="proofing-modal-loading"
          >
            Cargando preview…
          </div>
        ) : error ? (
          <div
            role="alert"
            data-testid="proofing-modal-error"
            className="p-4 text-sm text-destructive"
          >
            {error}
          </div>
        ) : signed ? (
          <div className="grid flex-1 min-h-0 grid-cols-1 md:grid-cols-[1fr_320px]">
            <div className="overflow-auto p-3">
              <ProofingCanvas
                signedUrl={signed.signedUrl}
                mimeType={signed.mimeType ?? mimeTypeHint ?? null}
                filename={signed.filename ?? filenameHint ?? 'archivo'}
                annotations={annotations}
                onCreate={handleCreate}
                selectedAnnotationId={selected}
                onSelectAnnotation={setSelected}
                statusFilter={filter}
              />
            </div>
            <aside className="min-h-0 border-t border-border md:border-l md:border-t-0">
              <AnnotationList
                annotations={annotations}
                filter={filter}
                onFilterChange={setFilter}
                selectedAnnotationId={selected}
                onSelectAnnotation={setSelected}
                onUpdateStatus={handleUpdateStatus}
                onReply={handleReply}
                onDelete={handleDelete}
              />
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  )
}
