'use client'

/**
 * Wave R4 · US-7.3 · Clips de video — Player inline.
 *
 * Componente liviano: <video controls> con thumbnail (poster) opcional,
 * metadata (duración, tamaño, autor, fecha) y botón eliminar para el dueño.
 *
 * Props soportan bookmarks opcionales (lista de timestamps con etiqueta)
 * que se renderizan como chips clickables debajo del video; al click se
 * salta el `currentTime`. Esto deja la puerta abierta a "anclar
 * comentarios" a marcas de tiempo del clip en futuras iteraciones (deuda
 * registrada).
 */

import { useCallback, useRef, useState } from 'react'
import { Trash2, Clock, User } from 'lucide-react'
import type { ClipDTO } from '@/lib/storage/clip-validation'

export interface ClipBookmark {
  /** Segundo en el video. */
  timeSec: number
  /** Etiqueta mostrada en el chip. */
  label: string
}

interface Props {
  clip: ClipDTO
  /** Si se pasa, el componente muestra el botón eliminar. */
  onDelete?: (clipId: string) => void
  /** Bookmarks opcionales para saltar a momentos clave. */
  bookmarks?: ClipBookmark[]
  /** Nombre del autor para mostrar en metadata. Si null, oculta el campo. */
  authorName?: string | null
}

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

function formatMb(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-MX', {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

export function ClipPlayer({
  clip,
  onDelete,
  bookmarks,
  authorName,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [confirming, setConfirming] = useState(false)

  const handleBookmark = useCallback((sec: number) => {
    const el = videoRef.current
    if (!el) return
    try {
      el.currentTime = sec
      // Si estaba pausado y el usuario salta, lo dejamos pausado para que
      // controle él el play (más predecible que auto-play sin gesture).
      if (el.paused) el.play().catch(() => undefined)
    } catch {
      // ignore
    }
  }, [])

  const handleDelete = useCallback(() => {
    if (!onDelete) return
    if (!confirming) {
      setConfirming(true)
      // Auto-reset tras 4s si no confirma.
      setTimeout(() => setConfirming(false), 4000)
      return
    }
    onDelete(clip.id)
  }, [onDelete, confirming, clip.id])

  return (
    <article
      data-testid="clip-player"
      data-clip-id={clip.id}
      className="overflow-hidden rounded-lg border border-border bg-card/50"
    >
      <video
        ref={videoRef}
        src={clip.videoUrl}
        poster={clip.thumbnailUrl ?? undefined}
        controls
        preload="metadata"
        playsInline
        className="block w-full bg-black"
      >
        Tu navegador no soporta la etiqueta &lt;video&gt;.
      </video>

      <div className="space-y-2 px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden />
            {formatDuration(clip.durationSec)}
          </span>
          <span className="font-mono">{formatMb(clip.sizeBytes)}</span>
          {authorName ? (
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" aria-hidden />
              {authorName}
            </span>
          ) : null}
          <span>{formatDate(clip.createdAt)}</span>
          <span className="ml-auto">
            {onDelete ? (
              <button
                type="button"
                onClick={handleDelete}
                aria-label={confirming ? 'Confirmar eliminación' : 'Eliminar clip'}
                data-testid="clip-delete"
                className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
                  confirming
                    ? 'bg-destructive text-destructive-foreground'
                    : 'text-destructive hover:bg-destructive/10'
                }`}
              >
                <Trash2 className="h-3 w-3" aria-hidden />
                {confirming ? '¿Confirmar?' : 'Eliminar'}
              </button>
            ) : null}
          </span>
        </div>

        {bookmarks && bookmarks.length > 0 ? (
          <div className="flex flex-wrap gap-1" data-testid="clip-bookmarks">
            {bookmarks.map((b, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleBookmark(b.timeSec)}
                className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] hover:bg-muted"
              >
                <span className="font-mono mr-1">{formatDuration(b.timeSec)}</span>
                {b.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  )
}
