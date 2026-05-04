'use client'

/**
 * P3-3 · Botón "Exportar proyecto completo".
 *
 * Llama a la server action `exportProjectFull(projectId)`. Cuando ok,
 * decodifica el `payloadBase64` a Blob y dispara la descarga vía
 * `URL.createObjectURL` + click sintético en un `<a download>`. El
 * estado local cubre loading + error inline (sin toast lib externa).
 */

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { exportProjectFull } from '@/lib/actions/backup-restore'

type Props = {
  projectId: string
  /** Variant minimal para usar dentro de toolbars; default: button completo. */
  compact?: boolean
}

export function ExportProjectButton({ projectId, compact = false }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClick = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await exportProjectFull(projectId)
      if (!res.ok || !res.payloadBase64 || !res.filename) {
        setError(res.error?.detail ?? 'No se pudo exportar')
        return
      }
      // Decodificar base64 → Uint8Array → Blob → click sintético.
      const binary = atob(res.payloadBase64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const blob = new Blob([bytes], {
        type: res.mimeType ?? 'application/zip',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Liberar el blob URL en el siguiente tick (Safari/Firefox a veces
      // necesitan que la descarga arranque antes de revoke).
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="inline-flex flex-col items-stretch gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className={
          compact
            ? 'inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-foreground/90 hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed'
            : 'inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-4 py-2 text-sm font-medium text-foreground/90 hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed'
        }
        aria-busy={busy}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="h-4 w-4" aria-hidden="true" />
        )}
        {busy ? 'Exportando...' : 'Exportar proyecto completo'}
      </button>
      {error && (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
