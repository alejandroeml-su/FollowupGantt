'use client'

import { useRef, useState, useTransition } from 'react'
import { FileUp, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { importExcel } from '@/lib/actions/import-export'
import { toast } from './Toaster'
import {
  ImportPreviewDialog,
  type PreviewSampleRow,
  type PreviewState,
} from './ImportPreviewDialog'
import type {
  ImportError,
  ImportWarning,
} from '@/lib/import-export/MAPPING'

type PreviewSuccess = {
  ok: true
  counts: {
    tasks: number
    deps: number
    resources: number
    matchedUsers: number
    unmatchedEmails: string[]
  }
  sample: PreviewSampleRow[]
  warnings: ImportWarning[]
}

type PreviewFailure = {
  ok: false
  errors: ImportError[]
}

/**
 * HU-4.2 · Botón "Importar de Excel".
 *
 * Flujo:
 *  1. Click → abre file picker nativo (.xlsx).
 *  2. Selecciona archivo → POST `/api/import/preview` con multipart.
 *  3. Modal preview muestra conteos + warnings + tabla.
 *  4. Confirmar → server action `importExcel` con archivo en base64.
 *  5. Toast verde al éxito + revalidatePath ya disparado por la action.
 *
 * Strings en español (D9). Etiqueta accesible: "Importar de Excel".
 */

type Props = {
  /** Proyecto activo. `null` deshabilita. */
  projectId: string | null
  className?: string
}

function announce(msg: string) {
  if (typeof document === 'undefined') return
  const region = document.getElementById('a11y-live')
  if (!region) return
  region.textContent = ''
  setTimeout(() => (region.textContent = msg), 20)
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  // Convertimos sin pasar por FileReader → más rápido y testable.
  let binary = ''
  const bytes = new Uint8Array(buf)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function ImportExcelButton({ projectId, className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [filename, setFilename] = useState<string | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [state, setState] = useState<PreviewState>({ status: 'idle' })
  const [isPending, startTransition] = useTransition()

  const disabled = !projectId || isPending
  const title = !projectId
    ? 'Selecciona un proyecto'
    : 'Importar tareas desde un archivo Excel (.xlsx)'

  function onClick() {
    if (!projectId) return
    inputRef.current?.click()
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reseteamos el input para permitir re-elegir el mismo archivo.
    if (inputRef.current) inputRef.current.value = ''
    if (!file || !projectId) return

    setFilename(file.name)
    setPendingFile(file)
    setOpen(true)
    setState({ status: 'loading' })

    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(
        `/api/import/preview?projectId=${encodeURIComponent(projectId)}`,
        { method: 'POST', body: formData },
      )
      const body = (await res.json()) as PreviewSuccess | PreviewFailure

      if (body.ok) {
        setState({
          status: 'preview',
          counts: body.counts,
          sample: body.sample,
          warnings: body.warnings,
        })
      } else {
        setState({
          status: 'errors',
          errors: body.errors,
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setState({
        status: 'errors',
        errors: [{ code: 'IMPORT_FAILED', detail: msg }],
      })
    }
  }

  function onCancel() {
    setOpen(false)
    setState({ status: 'idle' })
    setPendingFile(null)
    setFilename(null)
  }

  function onConfirm() {
    if (!projectId || !pendingFile) return
    startTransition(async () => {
      setState({ status: 'committing' })
      try {
        const fileBase64 = await fileToBase64(pendingFile)
        const result = await importExcel({
          fileBase64,
          filename: pendingFile.name,
          projectId,
          mode: 'replace',
        })
        if (result.ok) {
          toast.success(
            `Import completado: ${result.counts?.tasksCreated ?? 0} tareas, ${result.counts?.depsCreated ?? 0} dependencias`,
          )
          announce(`Import completado: ${result.counts?.tasksCreated ?? 0} tareas`)
          if (result.warnings && result.warnings.length > 0) {
            toast.error(
              `${result.warnings.length} advertencias en el import. Revisa la consola para detalle.`,
            )
            console.warn('[importExcel] warnings:', result.warnings)
          }
          setOpen(false)
          setState({ status: 'idle' })
          setPendingFile(null)
          setFilename(null)
        } else {
          setState({
            status: 'errors',
            errors: result.errors ?? [],
          })
          toast.error(`Import falló: ${result.errors?.[0]?.code ?? 'UNKNOWN'}`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setState({
          status: 'errors',
          errors: [{ code: 'IMPORT_FAILED', detail: msg }],
        })
        toast.error(`Import falló: ${msg}`)
      }
    })
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={onFileChosen}
        data-testid="import-excel-input"
      />
      <button
        type="button"
        data-testid="import-excel-button"
        aria-label="Importar de Excel"
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-300 transition-colors',
          'hover:bg-violet-500/20',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-violet-500/10',
          className,
        )}
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <FileUp className="h-3.5 w-3.5" aria-hidden />
        )}
        Importar de Excel
      </button>
      <ImportPreviewDialog
        open={open}
        onOpenChange={(o) => {
          if (!o) onCancel()
          else setOpen(o)
        }}
        filename={filename}
        state={state}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </>
  )
}
