import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import {
  cellToString,
  cellToDate,
  cellToNumber,
  cellToBoolean,
  parseExcelBuffer,
} from '@/lib/import-export/excel-parser'
import { buildExcelWorkbook, type ExportTasksRow } from '@/lib/import-export/excel-writer'

/**
 * HU-4.2 · Tests del parser Excel.
 *
 * Cubre:
 *  - Helpers cellTo* para todos los CellValue (null, string, number,
 *    Date, boolean, formula).
 *  - parseExcelBuffer: archivo válido OK, archivo vacío error, mnemonic
 *    duplicado error, parent_mnemonic inexistente warning + promoción
 *    a raíz, predecessor inexistente error, ciclo detectado error,
 *    lag fuera de rango clamped, end_date < start_date error, hoja
 *    Recursos sin emails OK.
 */

const TASK_BASE: ExportTasksRow = {
  mnemonic: 'A-1',
  title: 'Tarea uno',
  parent_mnemonic: null,
  start_date: new Date('2026-05-04T00:00:00.000Z'),
  end_date: new Date('2026-05-08T00:00:00.000Z'),
  duration_days: 5,
  is_milestone: false,
  progress: 0,
  priority: 'MEDIUM',
  assignee_email: 'a@x.com',
  tags: '',
  description: null,
}

async function buildBuffer(input: {
  tasks: ExportTasksRow[]
  deps?: Array<{
    predecessor_mnemonic: string
    successor_mnemonic: string
    type: 'FS' | 'SS' | 'FF' | 'SF'
    lag_days: number
  }>
  resources?: Array<{ email: string; name: string; role: string }>
}): Promise<Buffer> {
  const buf = await buildExcelWorkbook({
    tasks: input.tasks,
    deps: input.deps ?? [],
    resources: input.resources ?? [],
    projectName: 'Test',
  })
  return Buffer.from(buf)
}

// ───────────────────────── cellTo* ─────────────────────────

function makeCell(value: ExcelJS.CellValue) {
  return { value }
}

describe('excel-parser · cellToString', () => {
  it('null/undefined → null', () => {
    expect(cellToString(makeCell(null))).toBeNull()
    expect(cellToString(makeCell(undefined))).toBeNull()
  })
  it('string vacío → null, no vacío → trimmed', () => {
    expect(cellToString(makeCell('   '))).toBeNull()
    expect(cellToString(makeCell('  hola  '))).toBe('hola')
  })
  it('number → string', () => {
    expect(cellToString(makeCell(42))).toBe('42')
  })
  it('boolean → "TRUE"/"FALSE"', () => {
    expect(cellToString(makeCell(true))).toBe('TRUE')
    expect(cellToString(makeCell(false))).toBe('FALSE')
  })
  it('Date → YYYY-MM-DD', () => {
    expect(cellToString(makeCell(new Date('2026-05-01T12:34:56Z')))).toBe('2026-05-01')
  })
  it('formula → string del result', () => {
    expect(
      cellToString(
        makeCell({ formula: 'SUM(A1:A2)', result: 7 } as ExcelJS.CellFormulaValue),
      ),
    ).toBe('7')
  })
  it('rich text → join', () => {
    expect(
      cellToString(
        makeCell({
          richText: [{ text: 'foo' }, { text: 'bar' }],
        } as ExcelJS.CellRichTextValue),
      ),
    ).toBe('foobar')
  })
})

describe('excel-parser · cellToDate / cellToNumber / cellToBoolean', () => {
  it('cellToDate Date pass-through', () => {
    const d = new Date('2026-05-01')
    expect(cellToDate(makeCell(d))).toEqual(d)
  })
  it('cellToDate parsea string ISO', () => {
    expect(cellToDate(makeCell('2026-05-01'))?.toISOString().slice(0, 10)).toBe(
      '2026-05-01',
    )
  })
  it('cellToDate número (serial Excel) → Date razonable', () => {
    // serial 1 = 1900-01-01 (con bug Lotus, exceljs habitualmente entrega Date)
    const d = cellToDate(makeCell(46145)) // ≈ 2026-05-04
    expect(d).toBeInstanceOf(Date)
    expect(d!.getUTCFullYear()).toBeGreaterThanOrEqual(2020)
  })
  it('cellToNumber maneja string numérico, number y boolean', () => {
    expect(cellToNumber(makeCell('42'))).toBe(42)
    expect(cellToNumber(makeCell(3.14))).toBe(3.14)
    expect(cellToNumber(makeCell(true))).toBe(1)
    expect(cellToNumber(makeCell('NaN-foo'))).toBeNull()
  })
  it('cellToBoolean acepta TRUE/FALSE/SI/NO/1/0', () => {
    expect(cellToBoolean(makeCell(true))).toBe(true)
    expect(cellToBoolean(makeCell('TRUE'))).toBe(true)
    expect(cellToBoolean(makeCell('si'))).toBe(true)
    expect(cellToBoolean(makeCell('NO'))).toBe(false)
    expect(cellToBoolean(makeCell(0))).toBe(false)
    expect(cellToBoolean(makeCell(1))).toBe(true)
    expect(cellToBoolean(makeCell('foo'))).toBeNull()
  })
})

// ───────────────────────── parseExcelBuffer ─────────────────────────

describe('parseExcelBuffer · happy path', () => {
  it('parsea archivo válido y devuelve tareas + deps + resources', async () => {
    const buffer = await buildBuffer({
      tasks: [
        TASK_BASE,
        { ...TASK_BASE, mnemonic: 'A-2', title: 'Tarea dos', parent_mnemonic: 'A-1' },
      ],
      deps: [
        {
          predecessor_mnemonic: 'A-1',
          successor_mnemonic: 'A-2',
          type: 'FS',
          lag_days: 0,
        },
      ],
      resources: [{ email: 'a@x.com', name: 'A', role: 'AGENTE' }],
    })

    const result = await parseExcelBuffer(buffer)
    expect('errors' in result).toBe(false)
    if ('errors' in result) return
    expect(result.tasks).toHaveLength(2)
    expect(result.deps).toHaveLength(1)
    expect(result.resources).toHaveLength(1)
    expect(result.warnings).toHaveLength(0)
    expect(result.tasks[0].mnemonic).toBe('A-1')
    expect(result.tasks[1].parent_mnemonic).toBe('A-1')
    expect(result.deps[0].type).toBe('FS')
  })
})

describe('parseExcelBuffer · validaciones', () => {
  it('archivo vacío → error INVALID_FILE', async () => {
    const empty = Buffer.alloc(0)
    const result = await parseExcelBuffer(empty)
    expect('errors' in result).toBe(true)
    if (!('errors' in result)) return
    expect(result.errors[0].code).toBe('INVALID_FILE')
  })

  it('archivo no-xlsx (basura) → error EXCEL_PARSE', async () => {
    const bad = Buffer.from('not a xlsx')
    const result = await parseExcelBuffer(bad)
    expect('errors' in result).toBe(true)
    if (!('errors' in result)) return
    expect(['EXCEL_PARSE', 'INVALID_FILE']).toContain(result.errors[0].code)
  })

  it('mnemonic duplicado → error DUPLICATE_MNEMONIC', async () => {
    const buffer = await buildBuffer({
      tasks: [TASK_BASE, { ...TASK_BASE, title: 'duplicado' }],
    })
    const result = await parseExcelBuffer(buffer)
    expect('errors' in result).toBe(true)
    if (!('errors' in result)) return
    expect(result.errors.some((e) => e.code === 'DUPLICATE_MNEMONIC')).toBe(true)
  })

  it('parent_mnemonic inexistente → warning INVALID_PARENT_REF y promueve a raíz', async () => {
    const buffer = await buildBuffer({
      tasks: [
        { ...TASK_BASE, mnemonic: 'A-1', parent_mnemonic: 'GHOST' },
      ],
    })
    const result = await parseExcelBuffer(buffer)
    expect('errors' in result).toBe(false)
    if ('errors' in result) return
    expect(result.warnings.some((w) => w.code === 'INVALID_PARENT_REF')).toBe(true)
    expect(result.tasks[0].parent_mnemonic).toBeNull()
  })

  it('predecessor inexistente → error ORPHAN_DEPENDENCY', async () => {
    const buffer = await buildBuffer({
      tasks: [TASK_BASE],
      deps: [
        {
          predecessor_mnemonic: 'GHOST',
          successor_mnemonic: 'A-1',
          type: 'FS',
          lag_days: 0,
        },
      ],
    })
    const result = await parseExcelBuffer(buffer)
    expect('errors' in result).toBe(true)
    if (!('errors' in result)) return
    expect(result.errors.some((e) => e.code === 'ORPHAN_DEPENDENCY')).toBe(true)
  })

  it('ciclo detectado → error CYCLE_DETECTED', async () => {
    const buffer = await buildBuffer({
      tasks: [
        TASK_BASE,
        { ...TASK_BASE, mnemonic: 'A-2' },
        { ...TASK_BASE, mnemonic: 'A-3' },
      ],
      deps: [
        { predecessor_mnemonic: 'A-1', successor_mnemonic: 'A-2', type: 'FS', lag_days: 0 },
        { predecessor_mnemonic: 'A-2', successor_mnemonic: 'A-3', type: 'FS', lag_days: 0 },
        { predecessor_mnemonic: 'A-3', successor_mnemonic: 'A-1', type: 'FS', lag_days: 0 },
      ],
    })
    const result = await parseExcelBuffer(buffer)
    expect('errors' in result).toBe(true)
    if (!('errors' in result)) return
    expect(result.errors.some((e) => e.code === 'CYCLE_DETECTED')).toBe(true)
  })

  it('lag fuera de rango → warning LAG_CLAMPED', async () => {
    const buffer = await buildBuffer({
      tasks: [TASK_BASE, { ...TASK_BASE, mnemonic: 'A-2' }],
      deps: [
        {
          predecessor_mnemonic: 'A-1',
          successor_mnemonic: 'A-2',
          type: 'FS',
          lag_days: 9999,
        },
      ],
    })
    const result = await parseExcelBuffer(buffer)
    expect('errors' in result).toBe(false)
    if ('errors' in result) return
    expect(result.warnings.some((w) => w.code === 'LAG_CLAMPED')).toBe(true)
    expect(result.deps[0].lag_days).toBe(365)
  })

  it('end_date < start_date → error INVALID_ROW', async () => {
    const buffer = await buildBuffer({
      tasks: [
        {
          ...TASK_BASE,
          start_date: new Date('2026-05-10'),
          end_date: new Date('2026-05-05'),
        },
      ],
    })
    const result = await parseExcelBuffer(buffer)
    expect('errors' in result).toBe(true)
    if (!('errors' in result)) return
    expect(result.errors.some((e) => e.code === 'INVALID_ROW')).toBe(true)
  })

  it('hoja Recursos vacía → ParsedExcel sin recursos (no error)', async () => {
    const buffer = await buildBuffer({
      tasks: [TASK_BASE],
      resources: [],
    })
    const result = await parseExcelBuffer(buffer)
    expect('errors' in result).toBe(false)
    if ('errors' in result) return
    expect(result.resources).toHaveLength(0)
  })

  it('mnemonic con formato inválido → error INVALID_ROW', async () => {
    const buffer = await buildBuffer({
      tasks: [{ ...TASK_BASE, mnemonic: 'lower-case' }],
    })
    const result = await parseExcelBuffer(buffer)
    expect('errors' in result).toBe(true)
    if (!('errors' in result)) return
    expect(result.errors.some((e) => e.code === 'INVALID_ROW')).toBe(true)
  })

  it('progress fuera de [0,100] → error INVALID_ROW', async () => {
    // Forzamos via buildExcelWorkbook (que acepta progress numérico libre)
    const buffer = await buildBuffer({
      tasks: [{ ...TASK_BASE, progress: 200 }],
    })
    const result = await parseExcelBuffer(buffer)
    expect('errors' in result).toBe(true)
    if (!('errors' in result)) return
    expect(result.errors.some((e) => e.code === 'INVALID_ROW')).toBe(true)
  })
})
