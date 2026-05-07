import { NextRequest } from 'next/server'
import ExcelJS from 'exceljs'
import { loadPortfolioFinance } from '@/lib/portfolio/finance'

/**
 * Wave P10 (HU-10.6 · GAMMA-3.3) — Export Excel CFO del estado financiero
 * portfolio. Genera un .xlsx in-memory y lo sirve como attachment.
 *
 * Hoja única "Portfolio Finance" con columnas estándar EVM (PMI):
 * Proyecto / PM / BAC / EV / AC / PV / CPI / SPI / EAC / ETC / VAC / Avance%.
 * Última fila: TOTALES agregados.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const overview = await loadPortfolioFinance({
    areaId: url.searchParams.get('area'),
    managerId: url.searchParams.get('manager'),
    excludeClosed: url.searchParams.get('all') !== '1',
  })

  const wb = new ExcelJS.Workbook()
  wb.creator = 'FollowupGantt · Wave P10'
  wb.created = new Date()
  wb.title = 'Portfolio Finance · EVM'

  const ws = wb.addWorksheet('Portfolio Finance', {
    properties: { defaultColWidth: 14 },
  })

  ws.columns = [
    { header: 'Proyecto', key: 'projectName', width: 32 },
    { header: 'PM', key: 'managerName', width: 22 },
    { header: 'Moneda', key: 'budgetCurrency', width: 8 },
    { header: 'BAC', key: 'bac', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'EV', key: 'ev', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'AC', key: 'ac', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'PV', key: 'pv', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'CPI', key: 'cpi', width: 8, style: { numFmt: '0.00' } },
    { header: 'SPI', key: 'spi', width: 8, style: { numFmt: '0.00' } },
    { header: 'EAC', key: 'eac', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'ETC', key: 'etc', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'VAC', key: 'vac', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Avance %', key: 'progress', width: 10 },
  ]

  ws.getRow(1).font = { bold: true }
  ws.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  }
  ws.getRow(1).font = { bold: true, color: { argb: 'FFE0E7FF' } }

  for (const p of overview.projects) {
    ws.addRow({
      projectName: p.projectName,
      managerName: p.managerName ?? '—',
      budgetCurrency: p.budgetCurrency ?? 'USD',
      bac: p.metrics.bac,
      ev: p.metrics.ev,
      ac: p.metrics.ac,
      pv: p.metrics.pv,
      cpi: p.metrics.cpi,
      spi: p.metrics.spi,
      eac: p.metrics.eac,
      etc: p.metrics.etc,
      vac: p.metrics.vac,
      progress: p.progress,
    })
  }

  // Totales
  const t = overview.totals
  const totalsRow = ws.addRow({
    projectName: 'TOTAL PORTFOLIO',
    managerName: '',
    budgetCurrency: 'USD',
    bac: t.bac,
    ev: t.ev,
    ac: t.ac,
    pv: t.pv,
    cpi: t.cpi,
    spi: t.spi,
    eac: t.eac,
    etc: t.etc,
    vac: t.vac,
    progress: '',
  })
  totalsRow.font = { bold: true }
  totalsRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFCD34D' },
  }

  ws.getColumn(13).numFmt = '0\\%'

  ws.addRow([])
  const meta = ws.addRow([`Generado: ${new Date(overview.generatedAt).toISOString()}`])
  meta.font = { italic: true, color: { argb: 'FF94A3B8' } }

  const buffer = await wb.xlsx.writeBuffer()
  const filename = `portfolio-finance-${new Date().toISOString().slice(0, 10)}.xlsx`

  return new Response(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
