'use client'

import { useTransition } from 'react'
import { FileSpreadsheet, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { exportExcel } from '@/lib/actions/import-export'
import { toast } from './Toaster'

/**
 * HU-4.4 · Botón "Exportar a Excel".
 *
 * UX:
 *  - Disabled si no hay proyecto seleccionado o no hay tareas.
 *  - Dispara la server action `exportExcel(projectId)`. La acción
 *    devuelve `payloadBase64` con el workbook ya armado. El cliente
 *    decodifica → Blob → URL.createObjectURL → click programático y
 *    revoca la URL al final para no filtrar memoria.
 *  - Toast verde al éxito ("Excel descargado") y rojo al error con el
 *    código + detalle (`[FILE_TOO_LARGE]`, `[NOT_FOUND]`, etc.).
 *  - Spinner inline durante la transición.
 *
 * Strings en español (D9). Etiqueta accesible: "Exportar a Excel".
 */

type Props = {
  /** Proyecto activo (filtrado por TaskFiltersBar). `null` deshabilita. */
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
  // atob → Uint8Array byte-a-byte. Para 5MB esto es <50ms; suficiente
  // para no necesitar streaming. Si llegáramos a tamaños mayores habría
  // que cambiar a `fetch(streamingURL)` con range requests.
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

export function ExportExcelButton({ projectId, taskCount, className }: Props) {
  const [isPending, startTransition] = useTransition()

  const noProject = !projectId
  const noTasks = !!projectId && taskCount === 0
  const disabled = noProject || noTasks || isPending

  const title = noProject
    ? 'Selecciona un proyecto con tareas'
    : noTasks
      ? 'El proyecto no tiene tareas para exportar'
      : 'Descargar el proyecto como archivo Excel (.xlsx)'

  function onClick() {
    if (!projectId) return
    startTransition(async () => {
      const result = await exportExcel(projectId)
      if (result.ok && result.payloadBase64 && result.filename && result.mimeType) {
        triggerDownload({
          payloadBase64: result.payloadBase64,
          filename: result.filename,
          mimeType: result.mimeType,
        })
        toast.success('Excel descargado correctamente')
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
        toast.error('No se pudo generar el archivo Excel')
      }
    })
  }

  return (
    <button
      type="button"
      data-testid="export-excel-button"
      aria-label="Exportar a Excel"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition-colors',
        'hover:bg-emerald-500/20',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-emerald-500/10',
        className,
      )}
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
      )}
      Exportar a Excel
    </button>
  )
}
