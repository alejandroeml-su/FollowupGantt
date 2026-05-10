import { NextResponse } from 'next/server'
import { loadProjectReportData } from '@/lib/reports/pmi/queries'
import { renderStatusReportHtml } from '@/lib/reports/pmi/status-report-html'

/**
 * Wave P18-D · GET /api/reports/pmi/status/{projectId}
 * Devuelve HTML print-friendly del Status Report PMI.
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
  const html = renderStatusReportHtml(data)
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
