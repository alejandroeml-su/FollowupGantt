'use client'

/**
 * P3-3 · Diálogo "Importar proyecto" — pickeo de ZIP, llamada a
 * `importProjectFull` y redirect al proyecto recién creado.
 *
 * Flow:
 *   1. Abrir modal con `<input type=file accept=".zip">`.
 *   2. Al elegir archivo, leemos como ArrayBuffer y convertimos a base64
 *      (`btoa(String.fromCharCode(...))`).
 *   3. Invocamos `importProjectFull(zipBase64)`.
 *   4. Si ok, mostramos warnings (si hay) y redirigimos a
 *      `/projects/{newId}` tras 1.5s.
 *   5. Si error, lo renderizamos inline con código tipado.
 */

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, X, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { importProjectFull } from '@/lib/actions/backup-restore'

type Props = {
  /** Trigger renderizado fuera del modal — pasa el `open` setter. */
  triggerLabel?: string
  /** Variant minimal para toolbars. */
  compact?: boolean
}

/** Tope cliente: 50MB (el server lo re-valida). */
const MAX_BYTES = 50 * 1024 * 1024

export function ImportProjectDialog({
  triggerLabel = 'Importar proyecto',
  compact = false,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[] | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const reset = () => {
    setBusy(false)
    setError(null)
    setWarnings(null)
    setCreatedId(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleClose = () => {
    if (busy) return
    setOpen(false)
    reset()
  }

  const handleFile = async (file: File) => {
    setError(null)
    setWarnings(null)
    setCreatedId(null)
    if (file.size > MAX_BYTES) {
      setError('El archivo supera 50 MB')
      return
    }
    setBusy(true)
    try {
      const buf = await file.arrayBuffer()
      const bytes = new Uint8Array(buf)
      // Chunked btoa para evitar stack overflow en archivos grandes.
      let binary = ''
      const CHUNK = 0x8000
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(
          ...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)),
        )
      }
      const base64 = btoa(binary)
      const res = await importProjectFull(base64)
      if (!res.ok || !res.projectId) {
        const code = res.error?.code ?? 'IMPORT_FAILED'
        const detail = res.error?.detail ?? 'Error desconocido'
        setError(`[${code}] ${detail}`)
        return
      }
      setCreatedId(res.projectId)
      setWarnings(res.warnings ?? [])
      // Redirect tras dar tiempo al usuario de leer warnings (si los hay).
      const delay = (res.warnings?.length ?? 0) > 0 ? 2500 : 800
      setTimeout(() => {
        router.push(`/projects/${res.projectId}`)
        router.refresh()
        setOpen(false)
        reset()
      }, delay)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    void handleFile(file)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          compact
            ? 'inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-foreground/90 hover:bg-secondary/80'
            : 'inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-4 py-2 text-sm font-medium text-foreground/90 hover:bg-secondary/80'
        }
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
        {triggerLabel}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-project-title"
        >
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between border-b border-border pb-4">
              <h3
                id="import-project-title"
                className="flex items-center gap-2 text-lg font-bold text-white"
              >
                <Upload className="h-5 w-5 text-indigo-400" />
                Importar proyecto
              </h3>
              <button
                type="button"
                onClick={handleClose}
                disabled={busy}
                aria-label="Cerrar"
                className="text-muted-foreground hover:text-white disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mb-4 text-sm text-muted-foreground">
              Selecciona un ZIP generado por &quot;Exportar proyecto
              completo&quot;. Se creará un proyecto nuevo con todas las
              tareas, dependencias, baselines y metadatos.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              onChange={handleChange}
              disabled={busy || createdId !== null}
              className="block w-full text-sm text-foreground/90 file:mr-4 file:rounded-md file:border-0 file:bg-indigo-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-500 disabled:opacity-50"
            />

            {busy && (
              <div className="mt-4 flex items-center gap-2 text-sm text-indigo-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                Importando proyecto...
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {createdId && (
              <div
                role="status"
                className="mt-4 flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">Proyecto importado correctamente.</p>
                  {warnings && warnings.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-xs text-amber-300">
                      {warnings.slice(0, 5).map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                      {warnings.length > 5 && (
                        <li>... y {warnings.length - 5} más</li>
                      )}
                    </ul>
                  )}
                  <p className="mt-2 text-xs text-emerald-200/80">
                    Redirigiendo al proyecto...
                  </p>
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3 border-t border-border pt-4">
              <button
                type="button"
                onClick={handleClose}
                disabled={busy}
                className="rounded-md px-4 py-2 text-sm font-medium text-foreground/90 hover:bg-secondary disabled:opacity-50"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
