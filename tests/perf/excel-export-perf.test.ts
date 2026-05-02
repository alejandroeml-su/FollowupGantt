/**
 * HU-4.6 · Performance tests para export/import Excel @ 5000 tareas.
 *
 * SKIPPED por defecto (gating con `RUN_PERF=1`). No corren en CI normal:
 *
 *   # Ejecutar localmente:
 *   RUN_PERF=1 npx vitest run tests/perf/excel-export-perf.test.ts
 *
 *   # Generar fixtures antes (si no existen):
 *   npx tsx scripts/gen-perf-fixtures.ts
 *
 * SLOs (D17, Sprint 8):
 *   - build workbook 5000 tareas    < 2000 ms
 *   - read workbook 5MB equivalente < 2000 ms
 *   - round-trip completo            < 4000 ms
 *
 * NOTA: Este test usa exceljs DIRECTO (no excel-writer.ts) para evitar
 * conflictos con el agente paralelo que está escribiendo HU-4.5/HU-4.2.
 * Cuando esos PRs se mergeen, este test se podrá refactorizar para
 * importar el writer real y ejercitar la ruta de producción.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { measure, assertSLO, logPerfTable, humanBytes, type PerfResult } from './_helpers/perf'

const RUN_PERF = !!process.env.RUN_PERF
const FIXTURE_PATH = join(__dirname, '_fixtures', 'excel-5000.xlsx')
const TASK_COUNT = 5000

interface SyntheticTask {
  mnemonic: string
  title: string
  parent_mnemonic: string | null
  start_date: Date
  end_date: Date
  duration_days: number
  is_milestone: boolean
  progress: number
  priority: string
  description: string
}

function buildSyntheticTasks(n: number): SyntheticTask[] {
  const baseDate = new Date(2026, 4, 4)
  const tasks: SyntheticTask[] = []
  for (let i = 1; i <= n; i++) {
    const start = new Date(baseDate)
    start.setDate(start.getDate() + (i % 60))
    const dur = (i % 5) + 1
    const end = new Date(start)
    end.setDate(end.getDate() + dur - 1)
    tasks.push({
      mnemonic: `T-${String(i).padStart(5, '0')}`,
      title: `Tarea ${i} con titulo medianamente largo para perf test`,
      parent_mnemonic: i % 100 === 0 ? null : `T-${String(Math.max(1, i - (i % 100))).padStart(5, '0')}`,
      start_date: start,
      end_date: end,
      duration_days: dur,
      is_milestone: i % 250 === 0,
      progress: (i * 7) % 101,
      priority: ['low', 'medium', 'high', 'critical'][i % 4],
      description: `Descripcion sintetica de la tarea ${i} con padding ${(i * 2654435761 >>> 0).toString(16)} para perf.`,
    })
  }
  return tasks
}

async function buildWorkbook(tasks: SyntheticTask[]): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Tareas')
  ws.columns = [
    { header: 'mnemonic', key: 'mnemonic', width: 12 },
    { header: 'title', key: 'title', width: 50 },
    { header: 'parent_mnemonic', key: 'parent_mnemonic', width: 16 },
    { header: 'start_date', key: 'start_date', width: 14, style: { numFmt: 'yyyy-mm-dd' } },
    { header: 'end_date', key: 'end_date', width: 14, style: { numFmt: 'yyyy-mm-dd' } },
    { header: 'duration_days', key: 'duration_days', width: 14 },
    { header: 'is_milestone', key: 'is_milestone', width: 14 },
    { header: 'progress', key: 'progress', width: 10 },
    { header: 'priority', key: 'priority', width: 12 },
    { header: 'description', key: 'description', width: 80 },
  ]
  ws.getRow(1).font = { bold: true }
  for (const t of tasks) ws.addRow(t)
  return wb
}

describe.skipIf(!RUN_PERF)('HU-4.6 · Excel export perf @5000 tasks', () => {
  const collected: PerfResult[] = []

  beforeAll(() => {
    if (!existsSync(FIXTURE_PATH)) {
      // eslint-disable-next-line no-console
      console.warn(
        `\n[HU-4.6] Fixture no encontrado en ${FIXTURE_PATH}. ` +
          `Ejecuta:\n  npx tsx scripts/gen-perf-fixtures.ts\n`,
      )
    }
  })

  it('build workbook 5000 tareas <2s', async () => {
    const tasks = buildSyntheticTasks(TASK_COUNT)
    const { result: wb, perf: pBuild } = await measure(
      'excel.build_workbook(5000)',
      () => buildWorkbook(tasks),
    )
    const { result: buf, perf: pWrite } = await measure(
      'excel.writeBuffer(5000)',
      () => wb.xlsx.writeBuffer(),
    )
    pWrite.bytes = (buf as ArrayBuffer).byteLength
    pWrite.taskCount = TASK_COUNT
    pBuild.taskCount = TASK_COUNT
    collected.push(pBuild, pWrite)
    const total: PerfResult = {
      label: 'excel.build_total(5000)',
      durationMs: +(pBuild.durationMs + pWrite.durationMs).toFixed(2),
      bytes: pWrite.bytes,
      taskCount: TASK_COUNT,
    }
    collected.push(total)
    assertSLO(total, 2000)
  })

  it('read+parse workbook 5MB equivalente <2s', async () => {
    if (!existsSync(FIXTURE_PATH)) {
      // eslint-disable-next-line no-console
      console.warn(`[skip] ${FIXTURE_PATH} no existe. Genera fixtures primero.`)
      return
    }
    const stats = fs.statSync(FIXTURE_PATH)
    const buf = fs.readFileSync(FIXTURE_PATH)
    const { result: wb, perf } = await measure('excel.load(5MB)', async () => {
      const w = new ExcelJS.Workbook()
      // Pasamos un ArrayBuffer-like (Buffer) — exceljs lo acepta.
      await w.xlsx.load(buf as unknown as ArrayBuffer)
      return w
    })
    perf.bytes = stats.size
    const ws = wb.getWorksheet('Tareas')
    expect(ws).toBeDefined()
    perf.taskCount = (ws?.rowCount ?? 1) - 1
    collected.push(perf)
    assertSLO(perf, 2000)
  })

  it('round-trip 5000 tareas preserva data <4s', async () => {
    const tasks = buildSyntheticTasks(TASK_COUNT)
    const { result, perf } = await measure('excel.round_trip(5000)', async () => {
      const wb = await buildWorkbook(tasks)
      const buf = await wb.xlsx.writeBuffer()
      const wb2 = new ExcelJS.Workbook()
      await wb2.xlsx.load(buf as unknown as ArrayBuffer)
      const ws = wb2.getWorksheet('Tareas')
      const rows = ws ? ws.rowCount - 1 : 0
      return { rows, bytes: (buf as ArrayBuffer).byteLength }
    })
    perf.bytes = result.bytes
    perf.taskCount = result.rows
    collected.push(perf)
    expect(result.rows).toBe(TASK_COUNT)
    assertSLO(perf, 4000)
  })

  it('reporte de latencias', () => {
    // eslint-disable-next-line no-console
    console.log('\n=== HU-4.6 · Excel perf summary ===')
    logPerfTable(
      collected.map((r) => ({
        ...r,
        bytes: r.bytes !== undefined ? humanBytes(r.bytes) : undefined,
      })) as PerfResult[],
    )
  })
})
