'use client'

/**
 * Wave R5 Extended · US-Reporting-PDF — Dropdown "Exportar PDF" para el
 * header del proyecto.
 *
 * Implementación deliberadamente ligera (sin Radix DropdownMenu) para
 * mantener el bundle pequeño en el header. Toggle por click + cierre
 * en click-outside con `useRef` + listener global.
 *
 * Cada item abre el endpoint `/api/v2/reports/[projectId]?kind=...` en
 * un tab nuevo. El navegador hace la descarga al recibir el header
 * `Content-Disposition: attachment`. Si el usuario carece de visibilidad
 * (RBAC), el endpoint devuelve 403 y la pestaña queda con el JSON de
 * error — preferimos eso a un toast porque el header no debería
 * sorprender con cambios de estado.
 */

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FileDown, FileText, FilePlus2 } from 'lucide-react'

type Props = {
  projectId: string
  /**
   * Si está presente, el item de Sprint Review apunta a este sprint. Si
   * no, queda visible pero deshabilitado para evitar 400 del endpoint.
   * El parent del proyecto decide qué sprint pasar (típicamente el
   * ACTIVE más reciente).
   */
  activeSprintId?: string | null
  activeSprintName?: string | null
}

export function ExportPdfDropdown({
  projectId,
  activeSprintId,
  activeSprintName,
}: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Cierra al clickear fuera. Listener se monta sólo cuando está abierto
  // para no penalizar el render inicial.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const statusHref = `/api/v2/reports/${projectId}?kind=status`
  const sprintHref = activeSprintId
    ? `/api/v2/reports/${projectId}?kind=sprint-review&sprintId=${activeSprintId}`
    : null

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
        title="Exportar reporte PDF del proyecto"
      >
        <FileDown className="h-3.5 w-3.5" />
        Exportar PDF
        <ChevronDown className="h-3 w-3 opacity-70" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-72 overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        >
          <a
            href={statusHref}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-start gap-2 border-b border-border px-3 py-2 text-xs text-foreground hover:bg-secondary"
            role="menuitem"
          >
            <FileText className="mt-0.5 h-4 w-4 text-indigo-400" />
            <div>
              <div className="font-semibold">Status Report (PMI)</div>
              <div className="text-[11px] text-muted-foreground">
                Avance · EVM · top 5 riesgos · próximos hitos · desviaciones.
              </div>
            </div>
          </a>

          {sprintHref ? (
            <a
              href={sprintHref}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-start gap-2 px-3 py-2 text-xs text-foreground hover:bg-secondary"
              role="menuitem"
            >
              <FilePlus2 className="mt-0.5 h-4 w-4 text-emerald-400" />
              <div>
                <div className="font-semibold">
                  Sprint Review
                  {activeSprintName ? ` · ${activeSprintName}` : ''}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Velocity · historias · retro (si existe).
                </div>
              </div>
            </a>
          ) : (
            <div
              role="menuitem"
              aria-disabled="true"
              className="flex items-start gap-2 px-3 py-2 text-xs text-muted-foreground opacity-60"
              title="Activa un sprint para habilitar este reporte"
            >
              <FilePlus2 className="mt-0.5 h-4 w-4" />
              <div>
                <div className="font-semibold">Sprint Review</div>
                <div className="text-[11px]">
                  Sin sprint activo en el proyecto.
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
