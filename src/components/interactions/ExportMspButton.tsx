'use client'

import { useTransition } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { exportMspXml } from '@/lib/actions/import-export-msp'
import { toast } from './Toaster'

/**
 * HU-4.3 · Botón "Exportar a MS Project".
 *
 * UX (paralelo a `ExportExcelButton`):
 *  - Disabled si no hay proyecto seleccionado o no hay tareas.
 *  - Click → server action `exportMspXml(projectId)` → decode base64 →
 *    Blob → download programático. La URL se revoca al final para no
 *    filtrar memoria.
 *  - Toast verde al éxito ("Archivo MSP descargado") y rojo al error
 *    con código + detalle (`[FILE_TOO_LARGE]`, `[NOT_FOUND]`, etc.).
 *  - Spinner inline durante la transición.
 *
 * Strings en español (D9). aria-label: "Exportar a MS Project".
 *
 * IMPORTANTE: este componente NO se integra al toolbar aquí — @Orq lo
 * inyecta junto a `ExportExcelButton` y los demás botones de
 * import/export en `GanttBoardClient` cuando todas las HUs del Sprint 8
 * estén disponibles. Mantenerlo desacoplado evita merge conflicts con
 * los agentes que están tocando el toolbar en paralelo.
 */

type Props = {
  /** Proyecto activo. `null` deshabilita. */
  projectId: string | null
  /** Conteo de tareas no archivadas. 0 → disabled. */
  taskCount: number
  className?: string
}

function announce(msg: string) {
  if (typeof document === 'undefined') return
  const region = document.getElementById('a11y-live')
  if (!region) return
  region.textContent = ''
  setTimeout(() => (region.textContent = msg), 20)
}

function triggerDownload(opts: {
  payloadBase64: string
  filename: string
  mimeType: string
}) {
  const binary = atob(opts.payloadBase64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  const blob = new Blob([bytes], { type: opts.mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = opts.filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function ExportMspButton({ projectId, taskCount, className }: Props) {
  const [isPending, startTransition] = useTransition()

  const noProject = !projectId
  const noTasks = !!projectId && taskCount === 0
  const disabled = noProject || noTasks || isPending

  const title = noProject
    ? 'Selecciona un proyecto con tareas'
    : noTasks
      ? 'El proyecto no tiene tareas para exportar'
      : 'Descargar el proyecto como archivo MS Project (.xml)'

  function onClick() {
    if (!projectId) return
    startTransition(async () => {
      const result = await exportMspXml(projectId)
      if (
        result.ok &&
        result.payloadBase64 &&
        result.filename &&
        result.mimeType
      ) {
        triggerDownload({
          payloadBase64: result.payloadBase64,
          filename: result.filename,
          mimeType: result.mimeType,
        })
        toast.success('Archivo MSP descargado correctamente')
        announce(`Archivo ${result.filename} descargado`)
        return
      }
      const err = result.errors?.[0]
      if (err) {
        const msg =
          err.code === 'FILE_TOO_LARGE'
            ? 'El archivo supera el tope de 5 MB. Reduce el alcance del proyecto o contacta al equipo.'
            : err.code === 'NOT_FOUND'
              ? 'Proyecto no encontrado'
              : `[${err.code}] ${err.detail}`
        toast.error(msg)
      } else {
        toast.error('No se pudo generar el archivo MSP')
      }
    })
  }

  return (
    <button
      type="button"
      data-testid="export-msp-button"
      aria-label="Exportar a MS Project"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 transition-colors',
        'hover:bg-sky-500/20',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-sky-500/10',
        className,
      )}
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <FileText className="h-3.5 w-3.5" aria-hidden />
      )}
      Exportar a MS Project
    </button>
  )
}
