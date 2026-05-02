import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import {
  buildTemplateWorkbook,
  TEMPLATE_FILENAME,
} from '@/lib/import-export/template-data'
import {
  MSP_DEPENDENCY_TYPE_MAP,
  PRIORITY_MAP,
  LAG_LIMITS,
  FILE_SIZE_LIMIT_MB,
  mspPriorityToEnum,
  MNEMONIC_REGEX,
} from '@/lib/import-export/MAPPING'

/**
 * HU-4.5 · Tests de plantilla descargable y mapping canónico.
 *
 * Cubrimos:
 *  - buildTemplateWorkbook genera un buffer no vacío parseable.
 *  - Las 3 hojas tienen los conteos esperados (3 tareas, 2 deps, 2 recursos).
 *  - El filename canónico es estable (versionado).
 *  - Los mapas MSP están alineados con el spec.
 *  - mspPriorityToEnum funciona en los bordes de cada bucket.
 */

async function loadBack(buffer: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer,
  )
  return wb
}

describe('template-data · buildTemplateWorkbook', () => {
  it('genera un workbook parseable con 3 tareas, 2 dependencias, 2 recursos', async () => {
    const buffer = await buildTemplateWorkbook()
    expect(buffer).toBeInstanceOf(Uint8Array)
    expect(buffer.byteLength).toBeGreaterThan(2_000)

    const wb = await loadBack(buffer)
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      'Tareas',
      'Dependencias',
      'Recursos',
    ])

    const tasks = wb.getWorksheet('Tareas')!
    const deps = wb.getWorksheet('Dependencias')!
    const resources = wb.getWorksheet('Recursos')!

    // header + 3 tareas
    expect(tasks.actualRowCount).toBe(4)
    // header + 2 deps
    expect(deps.actualRowCount).toBe(3)
    // header + 2 recursos
    expect(resources.actualRowCount).toBe(3)
  })

  it('incluye al menos una tarea raíz y una con parent_mnemonic', async () => {
    const buffer = await buildTemplateWorkbook()
    const wb = await loadBack(buffer)
    const sheet = wb.getWorksheet('Tareas')!

    // parent_mnemonic = columna C (mnemonic, title, parent_mnemonic)
    const parentRow1 = sheet.getCell('C2').value
    const parentRow2 = sheet.getCell('C3').value

    // La fila 1 debe ser raíz (null o vacío)
    expect(parentRow1 === null || parentRow1 === '').toBe(true)
    // La fila 2 debe apuntar a la fila 1 (DEMO-1)
    expect(parentRow2).toBe('DEMO-1')
  })

  it('incluye al menos una dependencia FS y una SS con lag>0', async () => {
    const buffer = await buildTemplateWorkbook()
    const wb = await loadBack(buffer)
    const sheet = wb.getWorksheet('Dependencias')!

    // type = columna C, lag_days = columna D
    const types = [sheet.getCell('C2').value, sheet.getCell('C3').value]
    const lags = [sheet.getCell('D2').value, sheet.getCell('D3').value]

    expect(types).toContain('FS')
    expect(types).toContain('SS')
    // Al menos una dep con lag>0
    expect(lags.some((v) => typeof v === 'number' && v > 0)).toBe(true)
  })

  it('expone TEMPLATE_FILENAME versionado', () => {
    expect(TEMPLATE_FILENAME).toBe('followupgantt-plantilla-v1.xlsx')
  })
})

describe('MAPPING · constantes y helpers', () => {
  it('MSP_DEPENDENCY_TYPE_MAP coincide con el spec MSP', () => {
    expect(MSP_DEPENDENCY_TYPE_MAP[0]).toBe('FF')
    expect(MSP_DEPENDENCY_TYPE_MAP[1]).toBe('FS')
    expect(MSP_DEPENDENCY_TYPE_MAP[2]).toBe('SS')
    expect(MSP_DEPENDENCY_TYPE_MAP[3]).toBe('SF')
  })

  it('PRIORITY_MAP usa centroides correctos para 4 buckets', () => {
    expect(PRIORITY_MAP.LOW).toBeLessThan(PRIORITY_MAP.MEDIUM)
    expect(PRIORITY_MAP.MEDIUM).toBeLessThan(PRIORITY_MAP.HIGH)
    expect(PRIORITY_MAP.HIGH).toBeLessThan(PRIORITY_MAP.CRITICAL)
    expect(PRIORITY_MAP.CRITICAL).toBeLessThanOrEqual(1000)
  })

  it('mspPriorityToEnum mapea los bordes de cada bucket', () => {
    expect(mspPriorityToEnum(0)).toBe('LOW')
    expect(mspPriorityToEnum(249)).toBe('LOW')
    expect(mspPriorityToEnum(250)).toBe('MEDIUM')
    expect(mspPriorityToEnum(499)).toBe('MEDIUM')
    expect(mspPriorityToEnum(500)).toBe('HIGH')
    expect(mspPriorityToEnum(749)).toBe('HIGH')
    expect(mspPriorityToEnum(750)).toBe('CRITICAL')
    expect(mspPriorityToEnum(1000)).toBe('CRITICAL')
  })

  it('LAG_LIMITS y FILE_SIZE_LIMIT_MB respetan D17 y rangos del spec', () => {
    expect(LAG_LIMITS.min).toBe(-30)
    expect(LAG_LIMITS.max).toBe(365)
    expect(FILE_SIZE_LIMIT_MB).toBe(5)
  })

  it('MNEMONIC_REGEX acepta formatos válidos y rechaza inválidos', () => {
    expect(MNEMONIC_REGEX.test('PROJ-1')).toBe(true)
    expect(MNEMONIC_REGEX.test('A')).toBe(true)
    expect(MNEMONIC_REGEX.test('DEMO-DEV-42')).toBe(true)
    expect(MNEMONIC_REGEX.test('proj-1')).toBe(false) // minúscula
    expect(MNEMONIC_REGEX.test('PROJ_1')).toBe(false) // underscore no permitido
    expect(MNEMONIC_REGEX.test('')).toBe(false) // vacío
    expect(MNEMONIC_REGEX.test('A'.repeat(41))).toBe(false) // >40
  })
})
