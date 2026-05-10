import { NextResponse } from 'next/server'
import { loadProjectReportData } from '@/lib/reports/pmi/queries'
import { renderFinalReportXlsx } from '@/lib/reports/pmi/final-report-xlsx'

/**
 * Wave P18-D · GET /api/reports/pmi/final/{projectId}
 * Devuelve XLSX del Final Project Report PMI (multi-sheet).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const data = await loadProjectReportData(projectId)
  if (!data) {
    return NextResponse.json({ error: 'PROJECT_NOT_FOUND' }, { status: 404 })
  }
  const buf = await renderFinalReportXlsx(data)
  const fileName = `Final-Report-${data.project.name.replace(/[^a-z0-9]+/gi, '-')}-${new Date().toISOString().slice(0, 10)}.xlsx`
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'content-type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'no-store',
    },
  })
}
