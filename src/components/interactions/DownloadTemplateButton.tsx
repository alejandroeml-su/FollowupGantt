'use client'

import { FileDown } from 'lucide-react'
import { clsx } from 'clsx'

/**
 * HU-4.5 · Botón "Descargar plantilla".
 *
 * Renderiza un `<a download>` que apunta al Route Handler
 * `/api/import/template`. La descarga la negocia el browser sin
 * pasar por server action (más rápido, permite reanudar, ETag).
 *
 * Strings en español (D9). Etiqueta accesible: "Descargar plantilla".
 */
type Props = {
  className?: string
}

export function DownloadTemplateButton({ className }: Props) {
  return (
    <a
      href="/api/import/template"
      download="followupgantt-plantilla-v1.xlsx"
      data-testid="download-template-button"
      aria-label="Descargar plantilla de importación"
      title="Descargar plantilla .xlsx con datos demo y mapeo canónico"
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 transition-colors',
        'hover:bg-sky-500/20',
        className,
      )}
    >
      <FileDown className="h-3.5 w-3.5" aria-hidden />
      Descargar plantilla
    </a>
  )
}
