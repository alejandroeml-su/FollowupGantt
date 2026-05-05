'use client'

/**
 * Wave P8 · Equipo P8-4 — Preview de attachments con signed URL.
 *
 * Renderiza:
 *   - `image/*`  → `<img src={signedUrl}>` lazy.
 *   - `application/pdf` → `<iframe>` con altura adaptativa.
 *   - Otros → bloque informativo + botón de descarga.
 *
 * El componente solicita la signed URL a través de `getSignedUrl` cuando se
 * monta. Mientras carga muestra un placeholder y, en error, el mensaje
 * tipado de la action.
 */

import { useEffect, useRef, useState, useTransition } from 'react'
import { Download, FileText, AlertTriangle } from 'lucide-react'
import { getSignedUrl, type SignedUrlResult } from '@/lib/storage/get-signed-url'

interface Props {
  attachmentId: string
  /** Hint de mime para evitar parpadeo del layout (la signed URL trae el real). */
  mimeTypeHint?: string | null
  filenameHint?: string
  /** Permite forzar `iframe` height; default 480px para PDF. */
  pdfHeight?: number
}

export function AttachmentPreview({
  attachmentId,
  mimeTypeHint,
  filenameHint,
  pdfHeight = 480,
}: Props) {
  const [signed, setSigned] = useState<SignedUrlResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const lastIdRef = useRef<string | null>(null)
  // Loading se deriva del attachmentId actual vs el último cargado: si
  // cambió y todavía no hay `signed`, estamos cargando. Esto evita
  // `setState` síncrono dentro del effect (regla react-hooks/set-state-in-effect).
  const loading = signed === null && error === null

  useEffect(() => {
    if (lastIdRef.current === attachmentId) return
    lastIdRef.current = attachmentId
    let cancelled = false
    startTransition(async () => {
      try {
        const res = await getSignedUrl({ attachmentId })
        if (cancelled) return
        setSigned(res)
        setError(null)
      } catch (e) {
        if (cancelled) return
        setSigned(null)
        setError(e instanceof Error ? e.message : 'Error al obtener URL')
      }
    })
    return () => {
      cancelled = true
    }
  }, [attachmentId])

  if (loading) {
    return (
      <div
        data-testid="attachment-preview-loading"
        className="flex h-32 items-center justify-center rounded border border-border bg-muted/30 text-xs text-muted-foreground"
      >
        Cargando preview…
      </div>
    )
  }

  if (error || !signed) {
    return (
      <div
        data-testid="attachment-preview-error"
        role="alert"
        className="flex items-center gap-2 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
      >
        <AlertTriangle className="h-4 w-4" aria-hidden />
        <span>{error ?? 'No se pudo generar la vista previa'}</span>
      </div>
    )
  }

  const mime = (signed.mimeType ?? mimeTypeHint ?? '').toLowerCase()
  const filename = signed.filename ?? filenameHint ?? 'archivo'

  if (mime.startsWith('image/')) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        data-testid="attachment-preview-image"
        src={signed.signedUrl}
        alt={filename}
        loading="lazy"
        className="max-h-[480px] w-full rounded border border-border object-contain"
      />
    )
  }

  if (mime === 'application/pdf') {
    return (
      <iframe
        data-testid="attachment-preview-pdf"
        src={signed.signedUrl}
        title={filename}
        className="w-full rounded border border-border"
        style={{ height: `${pdfHeight}px` }}
      />
    )
  }

  // Fallback: download.
  return (
    <div
      data-testid="attachment-preview-download"
      className="flex items-center justify-between gap-2 rounded border border-border bg-muted/30 px-3 py-2 text-sm"
    >
      <span className="flex items-center gap-2 truncate">
        <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="truncate" title={filename}>
          {filename}
        </span>
      </span>
      <a
        href={signed.signedUrl}
        download={filename}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90"
      >
        <Download className="h-3 w-3" aria-hidden />
        Descargar
      </a>
    </div>
  )
}
