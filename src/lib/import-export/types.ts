/**
 * P3-4 · Tipos puros del pipeline de import/export.
 *
 * Este archivo NO importa Prisma, server-only, ni server actions. Su
 * único propósito es ser importable por cualquier capa (route handler,
 * componente cliente, server action, test) sin arrastrar `'use server'`
 * en el grafo de Turbopack.
 *
 * Historia: durante el build con Next 16 + Turbopack, la página-data
 * collection del route handler `/api/import/preview` recolectaba el
 * grafo de imports estáticos transitivos. Como el handler importaba
 * tipos desde `excel-parser.ts` y los consumidores re-exportaban tipos
 * desde `actions/import-export.ts` (`'use server'`), Turbopack intentaba
 * compilar las server actions junto con la ruta y fallaba con
 * "Failed to collect page data for /api/import/preview".
 *
 * El fix definitivo es centralizar los tipos en este archivo y hacer
 * que parser/server-actions re-exporten desde aquí, manteniendo el
 * contrato público estable. El handler `/api/import/preview` puede
 * volver a hacer imports estáticos.
 *
 * REGLAS:
 *  - Solo `type` exports. Nada de runtime (sin funciones, sin clases).
 *  - Cero side-effects. Cero imports de paquetes con `'use server'`,
 *    `'server-only'`, Prisma, Next, exceljs.
 *  - Si necesitas una constante runtime, vive en `MAPPING.ts` (puro)
 *    y se re-exporta desde donde la consuma.
 */

// ───────────────────────── Enumerados ─────────────────────────

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type DepType2L = 'FS' | 'SS' | 'FF' | 'SF'

// ───────────────────────── Filas Excel parseadas ─────────────────────────

/**
 * Una fila de la hoja "Tareas" tras pasar por zod + coerción de celdas.
 * `rowIndex` es la fila Excel 1-based (incluye header) y se usa para
 * ubicar errores en el preview UI.
 */
export interface ExcelTaskRow {
  mnemonic: string
  title: string
  parent_mnemonic: string | null
  start_date: Date
  end_date: Date
  duration_days: number | null
  is_milestone: boolean
  progress: number
  priority: Priority
  assignee_email: string | null
  tags: string
  description: string | null
  /** Fila Excel 1-based (incluye header). Útil para ubicar errores. */
  rowIndex: number
}

/**
 * Una fila de la hoja "Dependencias" tras pasar por zod.
 */
export interface ExcelDepRow {
  predecessor_mnemonic: string
  successor_mnemonic: string
  type: DepType2L
  lag_days: number
  rowIndex: number
}

/**
 * Una fila de la hoja "Recursos" tras pasar por zod.
 */
export interface ExcelResourceRow {
  email: string
  name: string
  role: string
  rowIndex: number
}

// ───────────────────────── Errores / Warnings ─────────────────────────

export type ExcelImportErrorCode =
  | 'INVALID_FILE'
  | 'FILE_TOO_LARGE'
  | 'EXCEL_PARSE'
  | 'INVALID_ROW'
  | 'DUPLICATE_MNEMONIC'
  | 'CYCLE_DETECTED'
  | 'ORPHAN_DEPENDENCY'
  | 'IMPORT_FAILED'
  | 'NOT_FOUND'
  | 'INVALID_INPUT'

export type ExcelImportWarningCode =
  | 'INVALID_PARENT_REF'
  | 'RESOURCE_NO_MATCH'
  | 'LAG_CLAMPED'
  | 'EMPTY_SHEET'
  | 'CONSTRAINT_IGNORED'
  | 'CALENDAR_IGNORED'
  | 'MULTIPLE_ASSIGNMENTS_IGNORED'
  | 'INACTIVE_TASK_SKIPPED'
  | 'MATERIAL_RESOURCE_IGNORED'
  | 'NEGATIVE_FLOAT_POST_IMPORT'

/**
 * Origen extendido del warning/error. Excel usa
 * 'Tareas|Dependencias|Recursos'; MSP XML reporta secciones lógicas
 * equivalentes para reutilizar el render del preview dialog. `MSP` es
 * un fallback para eventos a nivel proyecto (root tag, version, etc.).
 */
export type ImportSource =
  | 'Tareas'
  | 'Dependencias'
  | 'Recursos'
  | 'MSP'

export interface ExcelImportError {
  code: ExcelImportErrorCode
  detail: string
  /** Hoja Excel u origen MSP cuando aplica. */
  sheet?: ImportSource
  /** Fila Excel 1-based (incluye header) o UID MSP cuando aplica. */
  row?: number
}

export interface ExcelImportWarning {
  code: ExcelImportWarningCode
  detail: string
  sheet?: ImportSource
  row?: number
}

// ───────────────────────── Resultado del parser ─────────────────────────

export interface ParsedExcel {
  tasks: ExcelTaskRow[]
  deps: ExcelDepRow[]
  resources: ExcelResourceRow[]
  warnings: ExcelImportWarning[]
}
