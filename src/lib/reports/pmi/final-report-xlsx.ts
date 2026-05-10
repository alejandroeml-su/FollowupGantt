import 'server-only'

/**
 * Wave P18-D · Renderer Excel del Final Project Report (PMBOK cierre).
 *
 * Genera un XLSX multi-sheet con: Resumen, Tareas, Sprints, Riesgos,
 * Calidad, Lecciones. Pensado para entregables ejecutivos al cierre del
 * proyecto y para archivo histórico (PMI close phase).
 */

import ExcelJS from 'exceljs'
import type { ProjectReportData } from './queries'

export async function renderFinalReportXlsx(
  data: ProjectReportData,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Sync · FollowupGantt'
  wb.created = new Date()

  // ── Sheet 1: Resumen ──
  const summary = wb.addWorksheet('Resumen')
  summary.columns = [
    { header: 'Métrica', key: 'metric', width: 32 },
    { header: 'Valor', key: 'value', width: 28 },
  ]
  summary.getRow(1).font = { bold: true }
  summary.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E1B4B' },
  }
  summary.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }

  summary.addRows([
    { metric: 'Proyecto', value: data.project.name },
    { metric: 'Estado', value: data.project.status },
    { metric: 'Metodología', value: data.project.methodology ?? '—' },
    {
      metric: 'Período',
      value: `${data.project.startDate?.slice(0, 10) ?? '—'} → ${data.project.endDate?.slice(0, 10) ?? '—'}`,
    },
    { metric: 'Generado', value: new Date(data.generatedAt).toLocaleString('es-MX') },
    { metric: '', value: '' },
    { metric: '— TAREAS —', value: '' },
    { metric: 'Total tareas', value: data.tasks.total },
    { metric: 'Completadas', value: data.tasks.done },
    { metric: 'En progreso', value: data.tasks.inProgress },
    { metric: 'Revisión', value: data.tasks.review },
    { metric: 'Por hacer', value: data.tasks.todo },
    { metric: 'Story Points totales', value: data.tasks.totalSp },
    { metric: 'Story Points completados', value: data.tasks.doneSp },
    {
      metric: '% Completado',
      value:
        data.tasks.total > 0
          ? `${((data.tasks.done / data.tasks.total) * 100).toFixed(1)}%`
          : '—',
    },
    { metric: '', value: '' },
    { metric: '— EVM —', value: '' },
    { metric: 'PV (Planned Value)', value: data.evm?.pv ?? '—' },
    { metric: 'EV (Earned Value)', value: data.evm?.ev ?? '—' },
    { metric: 'AC (Actual Cost)', value: data.evm?.ac ?? '—' },
    { metric: 'BAC (Budget at Completion)', value: data.evm?.bac ?? '—' },
    { metric: 'EAC (Estimate at Completion)', value: data.evm?.eac ?? '—' },
    { metric: 'CPI (Cost Performance Index)', value: data.evm?.cpi.toFixed(2) ?? '—' },
    { metric: 'SPI (Schedule Performance Index)', value: data.evm?.spi.toFixed(2) ?? '—' },
    { metric: '', value: '' },
    { metric: '— RIESGOS —', value: '' },
    { metric: 'High/Critical', value: data.risks.high },
    { metric: 'Medium', value: data.risks.medium },
    { metric: 'Low', value: data.risks.low },
    { metric: 'Abiertos / Mitigando', value: data.risks.open },
    { metric: 'Cerrados', value: data.risks.closed },
    { metric: '', value: '' },
    { metric: '— CALIDAD —', value: '' },
    { metric: 'Inspecciones totales', value: data.inspections.total },
    { metric: 'Inspecciones PASS', value: data.inspections.pass },
    { metric: 'Inspecciones FAIL', value: data.inspections.fail },
    { metric: 'Defectos totales', value: data.defects.total },
    { metric: 'Defectos críticos abiertos', value: data.defects.critical },
    { metric: 'Defectos resueltos', value: data.defects.fixed },
  ])

  // ── Sheet 2: Riesgos top ──
  const risksSheet = wb.addWorksheet('Riesgos')
  risksSheet.columns = [
    { header: 'Título', key: 'title', width: 50 },
    { header: 'Tier', key: 'tier', width: 12 },
    { header: 'Score', key: 'score', width: 8 },
    { header: 'Estado', key: 'status', width: 14 },
  ]
  risksSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  risksSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF991B1B' },
  }
  data.risks.topRisks.forEach((r) => risksSheet.addRow(r))

  // ── Sheet 3: Sprints ──
  const sprintsSheet = wb.addWorksheet('Sprints')
  sprintsSheet.columns = [
    { header: 'Sprint', key: 'name', width: 28 },
    { header: 'Inicio', key: 'startDate', width: 14 },
    { header: 'Fin', key: 'endDate', width: 14 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Velocity', key: 'velocityActual', width: 12 },
  ]
  sprintsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sprintsSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E40AF' },
  }
  data.sprints.forEach((s) =>
    sprintsSheet.addRow({
      ...s,
      startDate: s.startDate.slice(0, 10),
      endDate: s.endDate.slice(0, 10),
    }),
  )

  // ── Sheet 4: Lecciones ──
  const lessonsSheet = wb.addWorksheet('Lecciones')
  lessonsSheet.columns = [
    { header: 'Categoría', key: 'category', width: 16 },
    { header: 'Título', key: 'title', width: 36 },
    { header: 'Contexto', key: 'context', width: 50 },
    { header: 'Qué pasó', key: 'whatHappened', width: 50 },
    { header: 'Recomendación', key: 'recommendation', width: 50 },
    { header: 'Fecha', key: 'createdAt', width: 14 },
  ]
  lessonsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  lessonsSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF065F46' },
  }
  data.lessons.forEach((l) =>
    lessonsSheet.addRow({
      ...l,
      createdAt: l.createdAt.slice(0, 10),
    }),
  )

  // Wrap text en columnas largas.
  for (const sheetName of ['Lecciones'] as const) {
    const s = wb.getWorksheet(sheetName)
    if (s) s.eachRow((row) => row.eachCell((cell) => (cell.alignment = { wrapText: true, vertical: 'top' })))
  }

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}
