/**
 * HU-13 (2026-05-14) · Exportación PDF + alta resolución + selección.
 *
 * Reutiliza el renderer de `export-png.ts` para componer el contenido del
 * lienzo a alta resolución (3× = ~288 DPI sobre la base de 96 DPI, apto
 * para impresión según el criterio "≥300 dpi" de la HU-13) y luego
 * envuelve el PNG resultante en un PDF de una sola página via `jspdf`.
 *
 * Permite filtrar `elements` por una colección de `selectedIds`, dejando
 * al consumidor (`WhiteboardEditor`) decidir si exporta todo o la
 * selección actual.
 */

import { jsPDF } from 'jspdf'
import { exportElementsToPng, downloadDataUrl } from './export-png'
import { unionBounds } from './geometry'
import type { WhiteboardElement } from './types'

const HI_RES_SCALE = 3

export type ExportPdfOptions = {
  background?: string
  /**
   * Si se provee, exporta sólo los elementos cuyo `id` esté en la lista.
   * Si la lista es vacía o no se provee, exporta todo.
   */
  selectedIds?: string[]
  /** Título visible del PDF + metadata. Default: "Pizarra". */
  title?: string
}

export function exportElementsToPdf(
  elements: WhiteboardElement[],
  options: ExportPdfOptions = {},
): jsPDF {
  const filtered =
    options.selectedIds && options.selectedIds.length > 0
      ? elements.filter((e) => options.selectedIds!.includes(e.id))
      : elements

  if (filtered.length === 0) {
    throw new Error('[EXPORT_FAILED] No hay elementos para exportar')
  }

  // 1. Generar PNG a alta resolución
  const dataUrl = exportElementsToPng(filtered, {
    background: options.background,
    scale: HI_RES_SCALE,
  })

  // 2. Calcular tamaño del PDF — derivado del bbox real para que no haya
  // bandas vacías. La unidad `pt` (1pt = 1/72") se mapea directamente al
  // tamaño en pulgadas: width_pt = px / 96 * 72.
  const bounds = unionBounds(
    filtered.map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height })),
  )
  const PADDING_PX = 40
  const PX_TO_PT = 72 / 96
  const widthPt = Math.max(1, (bounds.width + PADDING_PX * 2) * PX_TO_PT)
  const heightPt = Math.max(1, (bounds.height + PADDING_PX * 2) * PX_TO_PT)

  const orientation = widthPt >= heightPt ? 'l' : 'p'
  const pdf = new jsPDF({
    orientation,
    unit: 'pt',
    format: [widthPt, heightPt],
    compress: true,
  })

  pdf.setProperties({
    title: options.title ?? 'Pizarra',
    creator: 'Sync · Avante',
  })

  // 3. Insertar la imagen escalada al tamaño completo de la página.
  // `addImage` acepta dataURL `image/png` directamente.
  pdf.addImage(dataUrl, 'PNG', 0, 0, widthPt, heightPt, undefined, 'FAST')

  return pdf
}

/**
 * Atajo: exporta + dispara la descarga. Mantiene la API consistente con
 * `downloadDataUrl` para PNG.
 */
export function downloadPdf(pdf: jsPDF, filename: string): void {
  pdf.save(filename)
}

/**
 * Re-export del helper PNG hi-res para callers que sólo quieren imagen
 * de alta resolución sin envolver en PDF.
 */
export function exportElementsToHighResPng(
  elements: WhiteboardElement[],
  options: { background?: string; selectedIds?: string[] } = {},
): string {
  const filtered =
    options.selectedIds && options.selectedIds.length > 0
      ? elements.filter((e) => options.selectedIds!.includes(e.id))
      : elements
  if (filtered.length === 0) {
    throw new Error('[EXPORT_FAILED] No hay elementos para exportar')
  }
  return exportElementsToPng(filtered, {
    background: options.background,
    scale: HI_RES_SCALE,
  })
}

// Re-export para que el toolbar pueda importar todo desde un sólo módulo.
export { downloadDataUrl }
