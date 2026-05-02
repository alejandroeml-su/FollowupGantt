/**
 * HU-4.2 · POST /api/import/preview
 *
 * Recibe un archivo (Excel hoy, MSP XML cuando llegue HU-4.0) en
 * `multipart/form-data` y devuelve un `PreviewResult` con conteos,
 * sample y warnings/errors. NO commitea nada en BD.
 *
 * D16: se sirvió como Route Handler (no Server Action) porque
 * permite procesar `File` sin re-codificar a base64 antes de
 * enviarlo al servidor.
 *
 * Form fields esperados:
 *   file: archivo .xlsx (multipart blob)
 * Query params:
 *   projectId: UUID del proyecto destino
 */

import { NextRequest, NextResponse } from 'next/server'
import { buildImportPreview } from '@/lib/actions/import-export'
import { FILE_SIZE_LIMIT_BYTES, FILE_SIZE_LIMIT_MB } from '@/lib/import-export/MAPPING'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const projectId = req.nextUrl.searchParams.get('projectId')
  if (!projectId) {
    return NextResponse.json(
      {
        ok: false,
        errors: [
          {
            code: 'INVALID_INPUT',
            detail: 'projectId requerido como query param',
          },
        ],
      },
      { status: 400 },
    )
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      {
        ok: false,
        errors: [
          { code: 'INVALID_FILE', detail: `multipart inválido: ${detail}` },
        ],
      },
      { status: 400 },
    )
  }

  const file = formData.get('file')
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json(
      {
        ok: false,
        errors: [{ code: 'INVALID_FILE', detail: 'campo "file" ausente' }],
      },
      { status: 400 },
    )
  }

  if (file.size > FILE_SIZE_LIMIT_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        errors: [
          {
            code: 'FILE_TOO_LARGE',
            detail: `el archivo supera ${FILE_SIZE_LIMIT_MB} MB`,
          },
        ],
      },
      { status: 413 },
    )
  }

  // Branching de tipo: hoy solo Excel; cuando HU-4.0 llegue, MSP XML
  // se ramifica aquí por mime/extension del archivo.
  const filename = (file instanceof File ? file.name : '') ?? ''
  const isXlsx =
    filename.toLowerCase().endsWith('.xlsx') ||
    file.type ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

  if (!isXlsx) {
    return NextResponse.json(
      {
        ok: false,
        errors: [
          {
            code: 'INVALID_FILE',
            detail:
              'tipo de archivo no soportado; usa .xlsx (MSP XML llegará en HU-4.0)',
          },
        ],
      },
      { status: 415 },
    )
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const preview = await buildImportPreview({
    buffer,
    projectId,
    filename,
  })

  return NextResponse.json(preview, { status: preview.ok ? 200 : 422 })
}
