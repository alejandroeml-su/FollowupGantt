/**
 * HU-4.5 · GET /api/import/template
 *
 * Sirve la plantilla `.xlsx` canónica con datos demo. El navegador
 * dispara la descarga directa sin pasar por server action (más simple
 * y permite que herramientas como `curl`/Power Query la consuman).
 *
 * Cabeceras:
 *  - Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
 *  - Content-Disposition: attachment; filename="followupgantt-plantilla-v1.xlsx"
 *  - Cache-Control: public, max-age=3600 — la plantilla es estática
 *    pero está versionada en el filename, así que un cache corto está
 *    bien (refresca rápido si cambiamos los demos).
 */

import { NextResponse } from 'next/server'
import { buildTemplateWorkbook, TEMPLATE_FILENAME } from '@/lib/import-export/template-data'

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// El handler usa Buffer (Node runtime) y filesystem-free.
export const runtime = 'nodejs'

export async function GET(): Promise<NextResponse> {
  try {
    const buffer = await buildTemplateWorkbook()
    // Convertir Uint8Array → ArrayBuffer plano para NextResponse.
    const body = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': XLSX_MIME,
        'Content-Disposition': `attachment; filename="${TEMPLATE_FILENAME}"`,
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { ok: false, error: `[TEMPLATE_BUILD_FAILED] ${detail}` },
      { status: 500 },
    )
  }
}
