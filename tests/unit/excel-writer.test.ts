import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import {
  buildExcelWorkbook,
  type ExportTasksRow,
  type ExportDepsRow,
  type ExportResourcesRow,
} from '@/lib/import-export/excel-writer'

/**
 * HU-4.4 · Tests del writer de Excel.
 *
 * Cubrimos:
 *  1. Build básico (1+1+1) → buffer no vacío.
 *  2. Round-trip simple: build + load + comparar valores.
 *  3. Headers en bold.
 *  4. Dates preservan tipo Date al releer.
 *  5. Booleans preservan tipo boolean.
 *  6. Nullables (`parent_mnemonic`, `description`) se manejan sin crash.
 *  7. Validación inline de priority y type aplicada.
 *  8. Tags CSV se mantienen como string.
 *  9. Estructura de 3 hojas con nombres exactos del spec.
 *
 * El round-trip se hace con `ExcelJS.Workbook.xlsx.load()` sobre el mismo
 * Uint8Array que devolvemos: si un consumidor real (importer HU-4.2)
 * abre el archivo, ve los mismos valores.
 */

const TASK_BASE: ExportTasksRow = {
  mnemonic: 'PROJ-1',
  title: 'Diseño BD',
  parent_mnemonic: null,
  start_date: new Date('2026-05-02T00:00:00.000Z'),
  end_date: new Date('2026-05-05T00:00:00.000Z'),
  duration_days: 4,
  is_milestone: false,
  progress: 50,
  priority: 'HIGH',
  assignee_email: 'edwin@avante.com',
  tags: 'backend,database',
  description: 'Modelado relacional y migraciones iniciales',
}

const DEP_BASE: ExportDepsRow = {
  predecessor_mnemonic: 'PROJ-1',
  successor_mnemonic: 'PROJ-2',
  type: 'FS',
  lag_days: 2,
}

const RESOURCE_BASE: ExportResourcesRow = {
  email: 'edwin@avante.com',
  name: 'Edwin Martinez',
  role: 'AGENTE',
}

async function loadBack(buffer: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  // exceljs.load admite Buffer, ArrayBuffer y Uint8Array.
  await wb.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer)
  return wb
}

describe('excel-writer · estructura básica', () => {
  it('genera un buffer no vacío con 1 task, 1 dep, 1 resource', async () => {
    const buf = await buildExcelWorkbook({
      tasks: [TASK_BASE],
      deps: [DEP_BASE],
      resources: [RESOURCE_BASE],
      projectName: 'Proyecto Test',
    })
    expect(buf).toBeInstanceOf(Uint8Array)
    expect(buf.byteLength).toBeGreaterThan(1000) // un xlsx "vacío" pesa ~5KB
  })

  it('crea exactamente 3 hojas con los nombres esperados', async () => {
    const buf = await buildExcelWorkbook({
      tasks: [],
      deps: [],
      resources: [],
      projectName: 'P1',
    })
    const wb = await loadBack(buf)
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      'Tareas',
      'Dependencias',
      'Recursos',
    ])
  })

  it('aplica metadata del workbook (creator + title)', async () => {
    const buf = await buildExcelWorkbook({
      tasks: [],
      deps: [],
      resources: [],
      projectName: 'Migración Cloud',
    })
    const wb = await loadBack(buf)
    expect(wb.creator).toBe('FollowupGantt')
    expect(wb.title).toBe('Migración Cloud')
  })
})

describe('excel-writer · headers en bold', () => {
  it('marca las celdas de header en bold en las 3 hojas', async () => {
    const buf = await buildExcelWorkbook({
      tasks: [TASK_BASE],
      deps: [DEP_BASE],
      resources: [RESOURCE_BASE],
      projectName: 'P1',
    })
    const wb = await loadBack(buf)
    for (const sheetName of ['Tareas', 'Dependencias', 'Recursos']) {
      const sheet = wb.getWorksheet(sheetName)!
      const headerRow = sheet.getRow(1)
      const firstCell = headerRow.getCell(1)
      expect(firstCell.font?.bold).toBe(true)
    }
  })
})

describe('excel-writer · round-trip de tipos', () => {
  it('preserva Date como Date (no como number serial)', async () => {
    const buf = await buildExcelWorkbook({
      tasks: [TASK_BASE],
      deps: [],
      resources: [],
      projectName: 'P1',
    })
    const wb = await loadBack(buf)
    const sheet = wb.getWorksheet('Tareas')!
    // Columnas: mnemonic=A, title=B, parent=C, start_date=D, end_date=E
    const startCell = sheet.getCell('D2').value
    const endCell = sheet.getCell('E2').value
    expect(startCell).toBeInstanceOf(Date)
    expect(endCell).toBeInstanceOf(Date)
    expect((startCell as Date).toISOString().slice(0, 10)).toBe('2026-05-02')
    expect((endCell as Date).toISOString().slice(0, 10)).toBe('2026-05-05')
  })

  it('preserva booleans como boolean', async () => {
    const buf = await buildExcelWorkbook({
      tasks: [
        { ...TASK_BASE, is_milestone: true },
        { ...TASK_BASE, mnemonic: 'PROJ-2', is_milestone: false },
      ],
      deps: [],
      resources: [],
      projectName: 'P1',
    })
    const wb = await loadBack(buf)
    const sheet = wb.getWorksheet('Tareas')!
    // is_milestone es la columna G (mnemonic, title, parent, start, end, duration, is_milestone)
    expect(sheet.getCell('G2').value).toBe(true)
    expect(sheet.getCell('G3').value).toBe(false)
  })

  it('mantiene tags CSV como string sin tocar', async () => {
    const buf = await buildExcelWorkbook({
      tasks: [
        { ...TASK_BASE, tags: 'one,two,three' },
        { ...TASK_BASE, mnemonic: 'PROJ-2', tags: '' },
      ],
      deps: [],
      resources: [],
      projectName: 'P1',
    })
    const wb = await loadBack(buf)
    const sheet = wb.getWorksheet('Tareas')!
    // tags es columna K (1-based: A..L → tags=11)
    expect(sheet.getCell('K2').value).toBe('one,two,three')
    // exceljs lee strings vacíos como null al releer; aceptamos ambos.
    const empty = sheet.getCell('K3').value
    expect(empty === '' || empty === null).toBe(true)
  })
})

describe('excel-writer · nullables', () => {
  it('acepta parent_mnemonic null y description null sin crash', async () => {
    const buf = await buildExcelWorkbook({
      tasks: [
        { ...TASK_BASE, parent_mnemonic: null, description: null },
      ],
      deps: [],
      resources: [],
      projectName: 'P1',
    })
    const wb = await loadBack(buf)
    const sheet = wb.getWorksheet('Tareas')!
    // parent_mnemonic = C, description = L
    const parent = sheet.getCell('C2').value
    const desc = sheet.getCell('L2').value
    expect(parent === null || parent === '').toBe(true)
    expect(desc === null || desc === '').toBe(true)
  })

  it('acepta start_date / end_date null', async () => {
    const buf = await buildExcelWorkbook({
      tasks: [
        { ...TASK_BASE, start_date: null, end_date: null, duration_days: null },
      ],
      deps: [],
      resources: [],
      projectName: 'P1',
    })
    const wb = await loadBack(buf)
    const sheet = wb.getWorksheet('Tareas')!
    expect(sheet.getCell('D2').value === null || sheet.getCell('D2').value === '').toBe(true)
    expect(sheet.getCell('E2').value === null || sheet.getCell('E2').value === '').toBe(true)
  })
})

describe('excel-writer · data validation inline', () => {
  it('aplica validación de lista en la columna priority de Tareas', async () => {
    const buf = await buildExcelWorkbook({
      tasks: [TASK_BASE],
      deps: [],
      resources: [],
      projectName: 'P1',
    })
    const wb = await loadBack(buf)
    const sheet = wb.getWorksheet('Tareas')!
    // priority = columna I (mnemonic..priority = 9 → I)
    const validation = sheet.getCell('I2').dataValidation
    expect(validation).toBeDefined()
    expect(validation?.type).toBe('list')
    expect(validation?.formulae?.[0]).toContain('LOW')
    expect(validation?.formulae?.[0]).toContain('CRITICAL')
  })

  it('aplica validación de lista en la columna type de Dependencias', async () => {
    const buf = await buildExcelWorkbook({
      tasks: [],
      deps: [DEP_BASE],
      resources: [],
      projectName: 'P1',
    })
    const wb = await loadBack(buf)
    const sheet = wb.getWorksheet('Dependencias')!
    // type = columna C (predecessor, successor, type)
    const validation = sheet.getCell('C2').dataValidation
    expect(validation).toBeDefined()
    expect(validation?.type).toBe('list')
    expect(validation?.formulae?.[0]).toContain('FS')
    expect(validation?.formulae?.[0]).toContain('SF')
  })
})

describe('excel-writer · contenido de filas', () => {
  it('escribe N tareas en N filas (más header)', async () => {
    const tasks: ExportTasksRow[] = Array.from({ length: 5 }, (_, i) => ({
      ...TASK_BASE,
      mnemonic: `PROJ-${i + 1}`,
      title: `Tarea ${i + 1}`,
    }))
    const buf = await buildExcelWorkbook({
      tasks,
      deps: [],
      resources: [],
      projectName: 'P1',
    })
    const wb = await loadBack(buf)
    const sheet = wb.getWorksheet('Tareas')!
    // header + 5 rows = actualRowCount 6
    expect(sheet.actualRowCount).toBe(6)
    for (let i = 0; i < 5; i++) {
      expect(sheet.getCell(`A${i + 2}`).value).toBe(`PROJ-${i + 1}`)
      expect(sheet.getCell(`B${i + 2}`).value).toBe(`Tarea ${i + 1}`)
    }
  })

  it('escribe deps con lag_days correctamente como número entero', async () => {
    const buf = await buildExcelWorkbook({
      tasks: [],
      deps: [
        { predecessor_mnemonic: 'A', successor_mnemonic: 'B', type: 'FS', lag_days: 0 },
        { predecessor_mnemonic: 'B', successor_mnemonic: 'C', type: 'SS', lag_days: 3 },
        { predecessor_mnemonic: 'C', successor_mnemonic: 'D', type: 'FF', lag_days: -1 },
      ],
      resources: [],
      projectName: 'P1',
    })
    const wb = await loadBack(buf)
    const sheet = wb.getWorksheet('Dependencias')!
    expect(sheet.getCell('D2').value).toBe(0)
    expect(sheet.getCell('D3').value).toBe(3)
    expect(sheet.getCell('D4').value).toBe(-1)
    expect(sheet.getCell('C2').value).toBe('FS')
    expect(sheet.getCell('C3').value).toBe('SS')
    expect(sheet.getCell('C4').value).toBe('FF')
  })

  it('escribe recursos en la hoja informativa', async () => {
    const buf = await buildExcelWorkbook({
      tasks: [],
      deps: [],
      resources: [
        { email: 'a@x.com', name: 'A', role: 'AGENTE' },
        { email: 'b@x.com', name: 'B', role: 'AGENTE' },
      ],
      projectName: 'P1',
    })
    const wb = await loadBack(buf)
    const sheet = wb.getWorksheet('Recursos')!
    expect(sheet.actualRowCount).toBe(3) // header + 2
    expect(sheet.getCell('A2').value).toBe('a@x.com')
    expect(sheet.getCell('A3').value).toBe('b@x.com')
  })
})
