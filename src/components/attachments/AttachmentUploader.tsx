'use client'

/**
 * Wave P8 · Equipo P8-4 — Componente de upload (drag-drop + multi-file).
 *
 * Recibe un `taskId` y, al soltar/seleccionar archivos, sube cada uno por
 * separado mostrando una progress row mientras dura. Tras éxito invoca
 * `onUploaded(attachment)` para que el contenedor (`AttachmentList`)
 * inserte el DTO en su estado.
 *
 * Convenciones:
 *   - Drop zone con `dragover`/`drop` nativos.
 *   - Botón "Buscar archivos" que abre `<input type="file" multiple hidden>`.
 *   - Filtro mime en el `accept` del input para guiar al usuario; la
 *     validación dura ocurre en server.
 *   - Errores tipados de la action se muestran en línea.
 *   - Tamaño máximo se valida client-side antes de enviar (UX rápida).
 */

import { useCallback, useRef, useState } from 'react'
import { Paperclip, Upload, X } from 'lucide-react'
import {
  uploadAttachmentAction,
  MAX_FILE_BYTES,
  type AttachmentDTO,
} from '@/lib/storage/upload-attachment'

interface Props {
  taskId: string
  onUploaded: (att: AttachmentDTO) => void
  /**
   * Override del `accept` del input. Por defecto acepta imágenes, PDF,
   * texto y zip — alineado con la whitelist server.
   */
  accept?: string
}

interface ProgressRow {
  id: string
  filename: string
  status: 'uploading' | 'error' | 'done'
  errorMessage?: string
}

const DEFAULT_ACCEPT = 'image/*,application/pdf,text/*,application/zip'

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function AttachmentUploader({
  taskId,
  onUploaded,
  accept = DEFAULT_ACCEPT,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [rows, setRows] = useState<ProgressRow[]>([])

  const uploadOne = useCallback(
    async (file: File) => {
      const rowId = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      // Pre-validación client de tamaño para feedback inmediato.
      if (file.size > MAX_FILE_BYTES) {
        setRows((prev) => [
          ...prev,
          {
            id: rowId,
            filename: file.name,
            status: 'error',
            errorMessage: `Archivo demasiado grande (${humanSize(file.size)} > ${humanSize(MAX_FILE_BYTES)})`,
          },
        ])
        return
      }
      setRows((prev) => [
        ...prev,
        { id: rowId, filename: file.name, status: 'uploading' },
      ])
      try {
        const fd = new FormData()
        fd.set('taskId', taskId)
        fd.set('file', file)
        const att = await uploadAttachmentAction(fd)
        setRows((prev) =>
          prev.map((r) => (r.id === rowId ? { ...r, status: 'done' } : r)),
        )
        onUploaded(att)
        // Auto-clear de filas exitosas tras 2s para no llenar la UI.
        setTimeout(() => {
          setRows((prev) => prev.filter((r) => r.id !== rowId))
        }, 2000)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error desconocido'
        setRows((prev) =>
          prev.map((r) =>
            r.id === rowId
              ? { ...r, status: 'error', errorMessage: msg }
              : r,
          ),
        )
      }
    },
    [taskId, onUploaded],
  )

  const handleFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (!files) return
      const arr = Array.from(files)
      arr.forEach((f) => {
        void uploadOne(f)
      })
    },
    [uploadOne],
  )

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragOver(false)
      handleFiles(e.dataTransfer.files)
    },
    [handleFiles],
  )

  const onBrowseClick = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const removeRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }, [])

  return (
    <div className="space-y-2" data-testid="attachment-uploader">
      <div
        role="button"
        tabIndex={0}
        aria-label="Soltar archivos para subir"
        data-testid="attachment-dropzone"
        data-dragover={isDragOver ? 'true' : 'false'}
        onClick={onBrowseClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onBrowseClick()
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault()
          setIsDragOver(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragOver(true)
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={onDrop}
        className={[
          'flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-4 py-6 text-sm transition-colors',
          isDragOver
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/60',
        ].join(' ')}
      >
        <Upload className="mb-2 h-5 w-5 text-muted-foreground" aria-hidden />
        <p className="text-foreground">
          Arrastra archivos aquí o{' '}
          <span className="font-medium text-primary underline">haz clic para buscar</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Imágenes, PDF, texto, ZIP — máx {humanSize(MAX_FILE_BYTES)}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          data-testid="attachment-file-input"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {rows.length > 0 ? (
        <ul
          role="list"
          aria-label="Archivos en proceso"
          data-testid="attachment-progress-list"
          className="space-y-1"
        >
          {rows.map((r) => (
            <li
              key={r.id}
              data-testid="attachment-progress-row"
              data-status={r.status}
              className="flex items-center justify-between rounded border border-border bg-muted/30 px-2 py-1 text-xs"
            >
              <span className="flex items-center gap-2 truncate">
                <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate" title={r.filename}>
                  {r.filename}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {r.status === 'uploading' && (
                  <span className="text-muted-foreground">Subiendo…</span>
                )}
                {r.status === 'done' && (
                  <span className="text-green-600">Listo</span>
                )}
                {r.status === 'error' && (
                  <span
                    className="text-destructive"
                    title={r.errorMessage}
                    aria-label={r.errorMessage}
                  >
                    {r.errorMessage}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeRow(r.id)}
                  aria-label={`Quitar ${r.filename} del listado`}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
