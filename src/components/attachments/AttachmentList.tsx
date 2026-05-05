'use client'

/**
 * Wave P8 · Equipo P8-4 — Lista de adjuntos para el TaskDrawer.
 *
 * Lazy-load on mount. Cada attachment muestra:
 *   - Icono según mime.
 *   - Filename + tamaño (humanizado).
 *   - Botón "Ver" (abre modal preview con signed URL).
 *   - Botón "Eliminar" (con confirm).
 *
 * Soporta toggle del `AttachmentUploader` con un botón "+".
 */

import { useEffect, useRef, useState } from 'react'
import {
  Paperclip,
  Plus,
  Trash2,
  Eye,
  X,
  Image as ImageIcon,
  FileText,
  FileArchive,
  File,
} from 'lucide-react'
import {
  listAttachmentsForTask,
  deleteAttachment,
} from '@/lib/actions/attachments'
import type { AttachmentDTO } from '@/lib/storage/attachment-validation'
import { AttachmentUploader } from './AttachmentUploader'
import { AttachmentPreview } from './AttachmentPreview'

interface Props {
  taskId: string
}

function humanSize(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function mimeIcon(mime: string | null | undefined) {
  const m = (mime ?? '').toLowerCase()
  if (m.startsWith('image/')) return ImageIcon
  if (m === 'application/pdf') return FileText
  if (m.startsWith('text/')) return FileText
  if (m.includes('zip')) return FileArchive
  return File
}

export function AttachmentList({ taskId }: Props) {
  const [items, setItems] = useState<AttachmentDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showUploader, setShowUploader] = useState(false)
  const [previewing, setPreviewing] = useState<AttachmentDTO | null>(null)
  const lastTaskIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (lastTaskIdRef.current === taskId) return
    lastTaskIdRef.current = taskId
    let cancelled = false
    listAttachmentsForTask({ taskId })
      .then((rows) => {
        if (cancelled) return
        setItems(rows)
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setItems([])
        setError(e instanceof Error ? e.message : 'Error al cargar adjuntos')
      })
    return () => {
      cancelled = true
    }
  }, [taskId])

  function handleUploaded(att: AttachmentDTO) {
    setItems((prev) => (prev ? [att, ...prev] : [att]))
  }

  async function handleDelete(att: AttachmentDTO) {
    const ok =
      typeof window !== 'undefined'
        ? window.confirm(`¿Eliminar "${att.filename}"?`)
        : true
    if (!ok) return
    const prev = items
    // Optimistic.
    setItems((curr) => (curr ? curr.filter((x) => x.id !== att.id) : curr))
    try {
      await deleteAttachment({ attachmentId: att.id })
    } catch (e) {
      setItems(prev)
      setError(e instanceof Error ? e.message : 'Error al eliminar adjunto')
    }
  }

  return (
    <section
      aria-labelledby="attachments-heading"
      data-testid="attachment-list"
      className="space-y-3"
    >
      <div className="flex items-center justify-between">
        <h3
          id="attachments-heading"
          className="flex items-center gap-2 text-sm font-medium"
        >
          <Paperclip className="h-4 w-4 text-muted-foreground" aria-hidden />
          Adjuntos
          {items ? (
            <span
              className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              aria-label={`${items.length} archivos`}
            >
              {items.length}
            </span>
          ) : null}
        </h3>
        <button
          type="button"
          onClick={() => setShowUploader((v) => !v)}
          aria-expanded={showUploader}
          aria-controls="attachment-uploader-region"
          className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs hover:bg-muted"
          data-testid="attachment-toggle-uploader"
        >
          <Plus className="h-3 w-3" aria-hidden />
          {showUploader ? 'Ocultar' : 'Añadir'}
        </button>
      </div>

      {showUploader ? (
        <div id="attachment-uploader-region">
          <AttachmentUploader taskId={taskId} onUploaded={handleUploaded} />
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          data-testid="attachment-list-error"
          className="rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}

      {items === null ? (
        <p className="text-xs text-muted-foreground">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No hay archivos adjuntos.
        </p>
      ) : (
        <ul role="list" className="space-y-1">
          {items.map((att) => {
            const Icon = mimeIcon(att.mimeType)
            return (
              <li
                key={att.id}
                data-testid="attachment-row"
                className="flex items-center justify-between gap-2 rounded border border-border bg-card/40 px-2 py-1.5 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="truncate" title={att.filename}>
                    {att.filename}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {humanSize(att.sizeBytes)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPreviewing(att)}
                    aria-label={`Vista previa de ${att.filename}`}
                    className="rounded p-1 text-muted-foreground hover:bg-muted"
                    data-testid="attachment-preview-button"
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(att)}
                    aria-label={`Eliminar ${att.filename}`}
                    className="rounded p-1 text-destructive hover:bg-destructive/10"
                    data-testid="attachment-delete-button"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {previewing ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="attachment-preview-title"
          data-testid="attachment-preview-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPreviewing(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-md bg-background p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h4
                id="attachment-preview-title"
                className="truncate text-sm font-medium"
                title={previewing.filename}
              >
                {previewing.filename}
              </h4>
              <button
                type="button"
                onClick={() => setPreviewing(null)}
                aria-label="Cerrar vista previa"
                className="rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <AttachmentPreview
              attachmentId={previewing.id}
              mimeTypeHint={previewing.mimeType}
              filenameHint={previewing.filename}
            />
          </div>
        </div>
      ) : null}
    </section>
  )
}
