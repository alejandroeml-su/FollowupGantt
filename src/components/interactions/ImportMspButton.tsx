'use client'

import { useRef, useState, useTransition } from 'react'
import { FileUp, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { importMspXml } from '@/lib/actions/import-export-msp'
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

/**
 * HU-4.1 · Botón "Importar de MS Project".
 *
 * Flujo:
 *  1. Click → abre file picker nativo (.xml, MSP 2003+).
 *  2. Selecciona archivo → POST `/api/import/preview` con multipart.
 *  3. Modal preview muestra conteos + warnings + sample con OutlineNumber.
 *  4. Confirmar → server action `importMspXml` con archivo en base64.
 *  5. Toast verde al éxito; revalidatePath('/gantt') ya disparado por la action.
 *
 * Strings en español (D9). Etiqueta accesible: "Importar de MS Project".
 */

type Props = {
  /** Proyecto activo. `null` deshabilita. */
  projectId: string | null
  className?: string
}

interface MspPreviewSuccess {
  ok: true
  detected?: 'msp-xml'
  counts: {
    tasks: number
    deps: number
    resources: number
    matchedUsers: number
    unmatchedEmails: string[]
    rootCount?: number
    maxDepth?: number
  }
  sample: Array<{
    title: string
    start_date: string | Date
    end_date: string | Date
    parent_outline?: string
    outline?: string
    is_milestone: boolean
    progress: number
    priority: string
  }>
  warnings: ImportWarning[]
  projectName?: string | null
}

interface MspPreviewFailure {
  ok: false
  errors: ImportError[]
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
  let binary = ''
  const bytes = new Uint8Array(buf)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function ImportMspButton({ projectId, className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [filename, setFilename] = useState<string | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [state, setState] = useState<PreviewState>({ status: 'idle' })
  const [isPending, startTransition] = useTransition()

  const disabled = !projectId || isPending
  const title = !projectId
    ? 'Selecciona un proyecto'
    : 'Importar tareas desde un archivo MS Project (.xml)'

  function onClick() {
    if (!projectId) return
    inputRef.current?.click()
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
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
      const body = (await res.json()) as MspPreviewSuccess | MspPreviewFailure

      if (body.ok) {
        const sample: PreviewSampleRow[] = body.sample.map((t) => ({
          outline: t.outline,
          parent_outline: t.parent_outline,
          title: t.title,
          start_date: t.start_date,
          end_date: t.end_date,
          priority: t.priority,
          is_milestone: t.is_milestone,
          progress: t.progress,
        }))
        setState({
          status: 'preview',
          counts: {
            tasks: body.counts.tasks,
            deps: body.counts.deps,
            resources: body.counts.resources,
            matchedUsers: body.counts.matchedUsers,
            unmatchedEmails: body.counts.unmatchedEmails,
          },
          sample,
          warnings: body.warnings,
        })
      } else {
        setState({ status: 'errors', errors: body.errors })
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
        const result = await importMspXml({
          fileBase64,
          filename: pendingFile.name,
          projectId,
          mode: 'replace',
        })
        if (result.ok) {
          toast.success(
            `Import MS Project completado: ${result.counts?.tasksCreated ?? 0} tareas, ${result.counts?.depsCreated ?? 0} dependencias`,
          )
          announce(
            `Import MS Project completado: ${result.counts?.tasksCreated ?? 0} tareas`,
          )
          if (result.warnings && result.warnings.length > 0) {
            toast.error(
              `${result.warnings.length} advertencias en el import. Revisa la consola para detalle.`,
            )
            console.warn('[importMspXml] warnings:', result.warnings)
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
        accept=".xml,application/xml,text/xml"
        className="hidden"
        onChange={onFileChosen}
        data-testid="import-msp-input"
      />
      <button
        type="button"
        data-testid="import-msp-button"
        aria-label="Importar de MS Project"
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-300 transition-colors',
          'hover:bg-cyan-500/20',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-cyan-500/10',
          className,
        )}
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <FileUp className="h-3.5 w-3.5" aria-hidden />
        )}
        Importar de MS Project
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
        format="msp-xml"
      />
    </>
  )
}
