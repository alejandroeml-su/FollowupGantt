/**
 * HU-4.2 · Parser de Excel `.xlsx` para import.
 *
 * Tres responsabilidades:
 *  1. Coerción de tipos de celda (`cellToString`, `cellToDate`,
 *     `cellToNumber`, `cellToBoolean`) — `D20`.
 *  2. Validación zod row-by-row con códigos de error tipados.
 *  3. Resolución de jerarquía y dependencias por mnemónico antes de
 *     que la server action toque BD.
 *
 * Diseño:
 *  - Devuelve `ParsedExcel` con `tasks/deps/resources/warnings` o
 *    un wrapper `{ errors }` cuando los errores impiden continuar.
 *  - Los warnings NO bloquean (parent inválido → raíz, lag fuera
 *    de rango → clamp). Los errores SÍ (mnemonic duplicado, ciclo,
 *    predecesor inexistente, fila inválida).
 *  - El parser es puro: no toca Prisma ni filesystem; recibe un
 *    `Buffer | Uint8Array` y devuelve datos estructurados. Esto
 *    permite que `/api/import/preview` (REST) y `importExcel`
 *    (server action) compartan el mismo motor.
 */

import ExcelJS from 'exceljs'
import { z } from 'zod'
import { wouldCreateCycle, type DependencyEdge } from '@/lib/scheduling/cycle'
import {
  LAG_LIMITS,
  MAX_DEPS_PER_IMPORT,
  MAX_TASKS_PER_IMPORT,
  MNEMONIC_REGEX,
  type ImportError,
  type ImportWarning,
} from './MAPPING'
import type {
  DepType2L,
  ExcelDepRow,
  ExcelResourceRow,
  ExcelTaskRow,
  ParsedExcel,
  Priority,
} from './types'

// ───────────────────────── Tipos públicos ─────────────────────────
//
// Los tipos viven en `./types.ts` (archivo puro, sin runtime ni
// dependencias de servidor) y se re-exportan desde aquí para mantener
// compatibilidad con consumers que hacían
// `import type { ExcelTaskRow } from '@/lib/import-export/excel-parser'`.
// Para imports nuevos, prefiere `'@/lib/import-export/types'` —
// evita arrastrar `exceljs`/`zod` al grafo del cliente.

export type {
  DepType2L,
  ExcelDepRow,
  ExcelResourceRow,
  ExcelTaskRow,
  ParsedExcel,
  Priority,
}

// ───────────────────────── Coerción de celdas (D20) ─────────────────────────

type ExcelCellLike = {
  value: ExcelJS.CellValue
}

/**
 * Convierte una celda exceljs a string canónico o `null` si está vacía.
 * Cubre todos los `CellValue` posibles: null/undef, primitives, Date,
 * formula (con `result`), rich text, hyperlink.
 */
export function cellToString(cell: ExcelCellLike | null | undefined): string | null {
  if (!cell) return null
  const v = cell.value
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (v instanceof Date) return v.toISOString().split('T')[0]
  if (typeof v === 'object') {
    // Formula con result.
    if ('result' in v && v.result !== undefined && v.result !== null) {
      const r = v.result
      if (r instanceof Date) return r.toISOString().split('T')[0]
      if (typeof r === 'object' && 'error' in r) return null
      return String(r).trim() || null
    }
    // Rich text.
    if ('richText' in v && Array.isArray(v.richText)) {
      const text = v.richText.map((rt) => rt.text ?? '').join('')
      return text.trim() || null
    }
    // Hyperlink.
    if ('text' in v && typeof v.text === 'string') {
      return v.text.trim() || null
    }
  }
  return null
}

export function cellToDate(cell: ExcelCellLike | null | undefined): Date | null {
  if (!cell) return null
  const v = cell.value
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v
  if (typeof v === 'string') {
    const trimmed = v.trim()
    if (!trimmed) return null
    const parsed = new Date(trimmed)
    return isNaN(parsed.getTime()) ? null : parsed
  }
  if (typeof v === 'number') {
    // Excel serial number (días desde 1900-01-01, con bug Lotus 123)
    // exceljs en general devuelve Date directo; este fallback es defensivo.
    if (!Number.isFinite(v)) return null
    const epoch = Date.UTC(1899, 11, 30) // 1899-12-30
    const ms = epoch + v * 86_400_000
    const d = new Date(ms)
    return isNaN(d.getTime()) ? null : d
  }
  if (typeof v === 'object' && 'result' in v) {
    const r = v.result
    if (r instanceof Date) return r
    if (typeof r === 'string') {
      const parsed = new Date(r)
      return isNaN(parsed.getTime()) ? null : parsed
    }
  }
  return null
}

export function cellToNumber(cell: ExcelCellLike | null | undefined): number | null {
  if (!cell) return null
  const v = cell.value
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const trimmed = v.trim()
    if (!trimmed) return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'object' && 'result' in v) {
    const r = v.result
    if (typeof r === 'number') return Number.isFinite(r) ? r : null
    if (typeof r === 'string') {
      const n = Number(r)
      return Number.isFinite(n) ? n : null
    }
  }
  return null
}

export function cellToBoolean(cell: ExcelCellLike | null | undefined): boolean | null {
  if (!cell) return null
  const v = cell.value
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') {
    const t = v.trim().toUpperCase()
    if (t === 'TRUE' || t === 'SI' || t === 'SÍ' || t === '1' || t === 'YES') return true
    if (t === 'FALSE' || t === 'NO' || t === '0') return false
    return null
  }
  if (typeof v === 'object' && 'result' in v) {
    if (typeof v.result === 'boolean') return v.result
  }
  return null
}

// ───────────────────────── Schemas zod ─────────────────────────

const PriorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
const DepTypeEnum = z.enum(['FS', 'SS', 'FF', 'SF'])

const ExcelTaskRowSchema = z
  .object({
    mnemonic: z
      .string()
      .min(1, 'mnemonic requerido')
      .max(40, 'mnemonic supera 40 caracteres')
      .regex(MNEMONIC_REGEX, 'mnemonic inválido (formato A-Z, 0-9, "-")'),
    title: z.string().min(1, 'title requerido').max(500, 'title supera 500 caracteres'),
    parent_mnemonic: z.string().nullable(),
    start_date: z.date({ message: 'start_date requerido' }),
    end_date: z.date({ message: 'end_date requerido' }),
    duration_days: z.number().int().nullable(),
    is_milestone: z.boolean().default(false),
    progress: z.number().int().min(0).max(100).default(0),
    priority: PriorityEnum.default('MEDIUM'),
    assignee_email: z.string().email('email inválido').nullable(),
    tags: z.string().default(''),
    description: z.string().max(2000, 'description supera 2000 caracteres').nullable(),
  })
  .refine((d) => d.end_date.getTime() >= d.start_date.getTime(), {
    message: 'end_date debe ser >= start_date',
    path: ['end_date'],
  })

const ExcelDepRowSchema = z.object({
  predecessor_mnemonic: z
    .string()
    .min(1, 'predecessor_mnemonic requerido')
    .regex(MNEMONIC_REGEX, 'predecessor_mnemonic inválido'),
  successor_mnemonic: z
    .string()
    .min(1, 'successor_mnemonic requerido')
    .regex(MNEMONIC_REGEX, 'successor_mnemonic inválido'),
  type: DepTypeEnum.default('FS'),
  lag_days: z.number().int().default(0),
})

const ExcelResourceRowSchema = z.object({
  email: z.string().email('email inválido'),
  name: z.string().default(''),
  role: z.string().default('AGENTE'),
})

// ───────────────────────── Helpers internos ─────────────────────────

interface SheetSpec {
  name: 'Tareas' | 'Dependencias' | 'Recursos'
  required: boolean
}

const SHEETS: SheetSpec[] = [
  { name: 'Tareas', required: true },
  { name: 'Dependencias', required: false },
  { name: 'Recursos', required: false },
]

/**
 * Convierte un buffer/Uint8Array a `ArrayBuffer` plano (lo que exceljs
 * `xlsx.load()` consume sin sorpresas).
 */
function toArrayBuffer(input: Buffer | Uint8Array): ArrayBuffer {
  if (input instanceof Uint8Array) {
    return input.buffer.slice(
      input.byteOffset,
      input.byteOffset + input.byteLength,
    ) as ArrayBuffer
  }
  // Node Buffer → ArrayBuffer plano (TS lo trata como Uint8Array).
  const u8 = new Uint8Array(input)
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

function buildHeaderIndex(sheet: ExcelJS.Worksheet): Map<string, number> {
  const idx = new Map<string, number>()
  const header = sheet.getRow(1)
  header.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = cellToString(cell)
    if (text) idx.set(text.trim(), colNumber)
  })
  return idx
}

function getCell(
  sheet: ExcelJS.Worksheet,
  rowIndex: number,
  headerIdx: Map<string, number>,
  header: string,
): ExcelJS.Cell | null {
  const col = headerIdx.get(header)
  if (!col) return null
  return sheet.getRow(rowIndex).getCell(col)
}

// ───────────────────────── Parse principal ─────────────────────────

export async function parseExcelBuffer(
  buffer: Buffer | Uint8Array,
): Promise<ParsedExcel | { errors: ImportError[] }> {
  if (!buffer || buffer.byteLength === 0) {
    return {
      errors: [{ code: 'INVALID_FILE', detail: 'archivo vacío' }],
    }
  }

  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(toArrayBuffer(buffer))
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return {
      errors: [{ code: 'EXCEL_PARSE', detail }],
    }
  }

  // Verificar hojas mínimas.
  const sheetByName = new Map<string, ExcelJS.Worksheet>()
  for (const s of wb.worksheets) sheetByName.set(s.name, s)
  for (const spec of SHEETS) {
    if (spec.required && !sheetByName.get(spec.name)) {
      return {
        errors: [
          {
            code: 'INVALID_FILE',
            detail: `falta la hoja obligatoria "${spec.name}"`,
          },
        ],
      }
    }
  }

  const errors: ImportError[] = []
  const warnings: ImportWarning[] = []

  // ─── Hoja Tareas ───
  const tasksSheet = sheetByName.get('Tareas')!
  const tasksHdr = buildHeaderIndex(tasksSheet)

  const requiredHeaders = [
    'mnemonic',
    'title',
    'start_date',
    'end_date',
  ] as const
  for (const h of requiredHeaders) {
    if (!tasksHdr.has(h)) {
      return {
        errors: [
          {
            code: 'INVALID_FILE',
            detail: `falta columna obligatoria "${h}" en hoja Tareas`,
            sheet: 'Tareas',
          },
        ],
      }
    }
  }

  const parsedTasks: ExcelTaskRow[] = []
  const seenMnemonics = new Set<string>()

  const lastTaskRow = tasksSheet.actualRowCount
  if (lastTaskRow - 1 > MAX_TASKS_PER_IMPORT) {
    return {
      errors: [
        {
          code: 'INVALID_FILE',
          detail: `el archivo supera el tope de ${MAX_TASKS_PER_IMPORT} tareas`,
          sheet: 'Tareas',
        },
      ],
    }
  }

  for (let r = 2; r <= lastTaskRow; r++) {
    // Saltar filas vacías (todas las columnas null).
    const mnemonicCell = getCell(tasksSheet, r, tasksHdr, 'mnemonic')
    if (!cellToString(mnemonicCell)) continue

    const raw = {
      mnemonic: cellToString(getCell(tasksSheet, r, tasksHdr, 'mnemonic')),
      title: cellToString(getCell(tasksSheet, r, tasksHdr, 'title')),
      parent_mnemonic: cellToString(
        getCell(tasksSheet, r, tasksHdr, 'parent_mnemonic'),
      ),
      start_date: cellToDate(getCell(tasksSheet, r, tasksHdr, 'start_date')),
      end_date: cellToDate(getCell(tasksSheet, r, tasksHdr, 'end_date')),
      duration_days: cellToNumber(
        getCell(tasksSheet, r, tasksHdr, 'duration_days'),
      ),
      is_milestone:
        cellToBoolean(getCell(tasksSheet, r, tasksHdr, 'is_milestone')) ?? false,
      progress: cellToNumber(getCell(tasksSheet, r, tasksHdr, 'progress')) ?? 0,
      priority:
        cellToString(getCell(tasksSheet, r, tasksHdr, 'priority'))?.toUpperCase() ??
        'MEDIUM',
      assignee_email: cellToString(
        getCell(tasksSheet, r, tasksHdr, 'assignee_email'),
      ),
      tags: cellToString(getCell(tasksSheet, r, tasksHdr, 'tags')) ?? '',
      description: cellToString(
        getCell(tasksSheet, r, tasksHdr, 'description'),
      ),
    }

    const result = ExcelTaskRowSchema.safeParse(raw)
    if (!result.success) {
      const issue = result.error.issues[0]
      errors.push({
        code: 'INVALID_ROW',
        detail: `${issue.path.join('.') || 'row'}: ${issue.message}`,
        sheet: 'Tareas',
        row: r,
      })
      continue
    }

    if (seenMnemonics.has(result.data.mnemonic)) {
      errors.push({
        code: 'DUPLICATE_MNEMONIC',
        detail: `mnemonic duplicado: ${result.data.mnemonic}`,
        sheet: 'Tareas',
        row: r,
      })
      continue
    }
    seenMnemonics.add(result.data.mnemonic)
    parsedTasks.push({ ...result.data, rowIndex: r })
  }

  if (parsedTasks.length === 0 && errors.length === 0) {
    return {
      errors: [
        {
          code: 'INVALID_FILE',
          detail: 'la hoja Tareas no contiene filas válidas',
          sheet: 'Tareas',
        },
      ],
    }
  }

  // Resolver parent_mnemonic → si no existe, warning + promover a raíz.
  for (const t of parsedTasks) {
    if (t.parent_mnemonic && !seenMnemonics.has(t.parent_mnemonic)) {
      warnings.push({
        code: 'INVALID_PARENT_REF',
        detail: `parent "${t.parent_mnemonic}" inexistente para tarea ${t.mnemonic}; se promueve a raíz`,
        sheet: 'Tareas',
        row: t.rowIndex,
      })
      t.parent_mnemonic = null
    }
  }

  // ─── Hoja Dependencias ───
  const parsedDeps: ExcelDepRow[] = []
  const depsSheet = sheetByName.get('Dependencias')
  if (depsSheet) {
    const depsHdr = buildHeaderIndex(depsSheet)
    const lastDepRow = depsSheet.actualRowCount

    if (lastDepRow - 1 > MAX_DEPS_PER_IMPORT) {
      return {
        errors: [
          {
            code: 'INVALID_FILE',
            detail: `el archivo supera el tope de ${MAX_DEPS_PER_IMPORT} dependencias`,
            sheet: 'Dependencias',
          },
        ],
      }
    }

    for (let r = 2; r <= lastDepRow; r++) {
      const predCell = getCell(depsSheet, r, depsHdr, 'predecessor_mnemonic')
      if (!cellToString(predCell)) continue

      const lagRaw = cellToNumber(getCell(depsSheet, r, depsHdr, 'lag_days')) ?? 0
      const raw = {
        predecessor_mnemonic: cellToString(
          getCell(depsSheet, r, depsHdr, 'predecessor_mnemonic'),
        ),
        successor_mnemonic: cellToString(
          getCell(depsSheet, r, depsHdr, 'successor_mnemonic'),
        ),
        type:
          cellToString(getCell(depsSheet, r, depsHdr, 'type'))?.toUpperCase() ??
          'FS',
        lag_days: lagRaw,
      }

      const result = ExcelDepRowSchema.safeParse(raw)
      if (!result.success) {
        const issue = result.error.issues[0]
        errors.push({
          code: 'INVALID_ROW',
          detail: `${issue.path.join('.') || 'row'}: ${issue.message}`,
          sheet: 'Dependencias',
          row: r,
        })
        continue
      }

      const data = result.data

      // Predecesor / sucesor deben existir.
      if (!seenMnemonics.has(data.predecessor_mnemonic)) {
        errors.push({
          code: 'ORPHAN_DEPENDENCY',
          detail: `predecessor "${data.predecessor_mnemonic}" inexistente`,
          sheet: 'Dependencias',
          row: r,
        })
        continue
      }
      if (!seenMnemonics.has(data.successor_mnemonic)) {
        errors.push({
          code: 'ORPHAN_DEPENDENCY',
          detail: `successor "${data.successor_mnemonic}" inexistente`,
          sheet: 'Dependencias',
          row: r,
        })
        continue
      }

      // Clamp de lag.
      let lag = data.lag_days
      if (lag < LAG_LIMITS.min || lag > LAG_LIMITS.max) {
        const clamped = Math.max(LAG_LIMITS.min, Math.min(LAG_LIMITS.max, lag))
        warnings.push({
          code: 'LAG_CLAMPED',
          detail: `lag_days=${lag} fuera de [${LAG_LIMITS.min}, ${LAG_LIMITS.max}]; ajustado a ${clamped}`,
          sheet: 'Dependencias',
          row: r,
        })
        lag = clamped
      }

      parsedDeps.push({ ...data, lag_days: lag, rowIndex: r })
    }

    // Detección de ciclos: simulamos la inserción acumulativa.
    const accumulated: DependencyEdge[] = []
    for (const d of parsedDeps) {
      if (
        wouldCreateCycle(
          accumulated,
          d.predecessor_mnemonic,
          d.successor_mnemonic,
        )
      ) {
        errors.push({
          code: 'CYCLE_DETECTED',
          detail: `dependencia ${d.predecessor_mnemonic} → ${d.successor_mnemonic} cerraría un ciclo`,
          sheet: 'Dependencias',
          row: d.rowIndex,
        })
        // No la añadimos al acumulador para no propagar el ciclo.
        continue
      }
      accumulated.push({
        predecessorId: d.predecessor_mnemonic,
        successorId: d.successor_mnemonic,
      })
    }

    // Filtrar deps que generaron ciclo (aún están en parsedDeps por orden).
    // Reescribir parsedDeps consultando el acumulador final por par.
    const okPairs = new Set(
      accumulated.map((e) => `${e.predecessorId}|${e.successorId}`),
    )
    for (let i = parsedDeps.length - 1; i >= 0; i--) {
      const key = `${parsedDeps[i].predecessor_mnemonic}|${parsedDeps[i].successor_mnemonic}`
      if (!okPairs.has(key)) parsedDeps.splice(i, 1)
    }
  }

  // ─── Hoja Recursos ───
  const parsedResources: ExcelResourceRow[] = []
  const resourcesSheet = sheetByName.get('Recursos')
  if (resourcesSheet) {
    const resHdr = buildHeaderIndex(resourcesSheet)
    const lastResRow = resourcesSheet.actualRowCount

    if (lastResRow <= 1) {
      warnings.push({
        code: 'EMPTY_SHEET',
        detail: 'la hoja Recursos está vacía',
        sheet: 'Recursos',
      })
    }

    for (let r = 2; r <= lastResRow; r++) {
      const emailCell = getCell(resourcesSheet, r, resHdr, 'email')
      if (!cellToString(emailCell)) continue

      const raw = {
        email: cellToString(getCell(resourcesSheet, r, resHdr, 'email')),
        name: cellToString(getCell(resourcesSheet, r, resHdr, 'name')) ?? '',
        role: cellToString(getCell(resourcesSheet, r, resHdr, 'role')) ?? 'AGENTE',
      }

      const result = ExcelResourceRowSchema.safeParse(raw)
      if (!result.success) {
        const issue = result.error.issues[0]
        errors.push({
          code: 'INVALID_ROW',
          detail: `${issue.path.join('.') || 'row'}: ${issue.message}`,
          sheet: 'Recursos',
          row: r,
        })
        continue
      }
      parsedResources.push({ ...result.data, rowIndex: r })
    }
  }

  if (errors.length > 0) {
    return { errors }
  }

  return {
    tasks: parsedTasks,
    deps: parsedDeps,
    resources: parsedResources,
    warnings,
  }
}
