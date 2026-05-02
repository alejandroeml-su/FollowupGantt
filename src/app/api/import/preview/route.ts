/**
 * HU-4.2/4.1 · POST /api/import/preview
 *
 * Recibe un archivo (Excel `.xlsx` HU-4.2 o MSP XML `.xml` HU-4.1) en
 * `multipart/form-data` y devuelve un `PreviewResult` con conteos,
 * sample y warnings/errors. NO commitea nada en BD.
 *
 * D16: se sirvió como Route Handler (no Server Action) porque
 * permite procesar `File` sin re-codificar a base64 antes de
 * enviarlo al servidor.
 *
 * Form fields esperados:
 *   file: archivo .xlsx o .xml (multipart blob)
 * Query params:
 *   projectId: UUID del proyecto destino
 *
 * Response shape (200 OK):
 *   { ok: true, detected: 'excel' | 'msp-xml', counts, sample, warnings, ... }
 * Response shape (4xx):
 *   { ok: false, errors: [{ code, detail, sheet?, row? }] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { buildImportPreview } from '@/lib/actions/import-export'
import { buildMspImportPreview } from '@/lib/actions/import-export-msp'
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

  const filename = (file instanceof File ? file.name : '') ?? ''
  const lowerName = filename.toLowerCase()
  const isXlsx =
    lowerName.endsWith('.xlsx') ||
    file.type ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const isXml =
    lowerName.endsWith('.xml') ||
    file.type === 'application/xml' ||
    file.type === 'text/xml'

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  if (isXlsx) {
    const preview = await buildImportPreview({
      buffer,
      projectId,
      filename,
    })
    if (preview.ok) {
      return NextResponse.json(
        { ...preview, detected: 'excel' },
        { status: 200 },
      )
    }
    return NextResponse.json(preview, { status: 422 })
  }

  if (isXml) {
    const preview = await buildMspImportPreview({ buffer, projectId })
    if (preview.ok) {
      return NextResponse.json(
        { ...preview, detected: 'msp-xml' },
        { status: 200 },
      )
    }
    return NextResponse.json(preview, { status: 422 })
  }

  return NextResponse.json(
    {
      ok: false,
      errors: [
        {
          code: 'INVALID_FILE',
          detail:
            'tipo de archivo no soportado; usa .xlsx (Excel) o .xml (MS Project)',
        },
      ],
    },
    { status: 415 },
  )
}
