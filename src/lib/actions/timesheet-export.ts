'use server'

/**
 * Ola P1 · Equipo 4 — Exportador del timesheet semanal a Excel.
 *
 * Genera un workbook con dos hojas:
 *   1. "Resumen" — totales por día (Lun-Dom) + total semana.
 *   2. "Detalle" — todas las entries con timestamp, duración y costo.
 *
 * Patrón D6: import server-side de `exceljs` y respuesta como base64
 * (consistente con `import-export.ts`). El cliente decodifica y
 * dispara la descarga con un Blob.
 */

import ExcelJS from 'exceljs'
import { getWeekTimesheet } from './time-entries'

const DAY_LABELS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

function fmtDateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-MX', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('es-MX', {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

export async function exportWeekTimesheet(input: {
  userId: string
  userName: string
  weekStart: string
}): Promise<{ filename: string; base64: string }> {
  const { userId, userName, weekStart } = input
  const data = await getWeekTimesheet(userId, weekStart)

  const wb = new ExcelJS.Workbook()
  wb.creator = 'FollowupGantt'
  wb.created = new Date()
  wb.title = `Timesheet ${userName} ${fmtDateShort(weekStart)}`

  // ── Resumen ──
  const summary = wb.addWorksheet('Resumen')
  summary.columns = [
    { header: 'Día', key: 'day', width: 14 },
    { header: 'Fecha', key: 'date', width: 12 },
    { header: 'Horas', key: 'hours', width: 10, style: { numFmt: '0.00' } },
    { header: 'Costo', key: 'cost', width: 14, style: { numFmt: '#,##0.00' } },
  ]
  summary.getRow(1).eachCell((c) => (c.font = { bold: true }))

  data.perDay.forEach((d, i) => {
    summary.addRow({
      day: DAY_LABELS[i],
      date: fmtDateShort(d.date),
      hours: d.minutes / 60,
      cost: d.cost,
    })
  })
  summary.addRow({})
  const totalRow = summary.addRow({
    day: 'Total semana',
    date: '',
    hours: data.totalMinutes / 60,
    cost: data.totalCost,
  })
  totalRow.eachCell((c) => (c.font = { bold: true }))

  // ── Detalle ──
  const detail = wb.addWorksheet('Detalle')
  detail.columns = [
    { header: 'Inicio', key: 'startedAt', width: 18 },
    { header: 'Fin', key: 'endedAt', width: 18 },
    { header: 'Tarea', key: 'taskId', width: 24 },
    { header: 'Duración (min)', key: 'durationMinutes', width: 14 },
    { header: 'Tarifa', key: 'hourlyRate', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'Costo', key: 'cost', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'Descripción', key: 'description', width: 40 },
  ]
  detail.getRow(1).eachCell((c) => (c.font = { bold: true }))

  for (const e of data.entries) {
    detail.addRow({
      startedAt: fmtDateTime(e.startedAt),
      endedAt: fmtDateTime(e.endedAt),
      taskId: e.taskId,
      durationMinutes: e.durationMinutes,
      hourlyRate: e.hourlyRate,
      cost: e.cost,
      description: e.description ?? '',
    })
  }

  const buffer = await wb.xlsx.writeBuffer()
  // Buffer global (Node) → base64. En edge runtimes habría que usar
  // btoa(); el server action corre en Node-runtime por defecto.
  const base64 = Buffer.from(buffer).toString('base64')
  const filename = `timesheet_${userName.replace(/\s+/g, '_')}_${fmtDateShort(weekStart).replace(/\//g, '-')}.xlsx`
  return { filename, base64 }
}
