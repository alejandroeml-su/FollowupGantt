/**
 * HU-4.4 · Helper puro para escribir el workbook de exportación.
 *
 * Genera un Excel con tres hojas (Tareas, Dependencias, Recursos) que
 * funciona como contraparte canónica del importador (HU-4.2 futura). El
 * round-trip debe mantener fidelidad 100% en los campos listados — los
 * tests unitarios bloquean cualquier regresión sobre tipos numéricos,
 * fechas y booleans.
 *
 * D6 · `exceljs` se importa como módulo Node (`'exceljs'`, no
 * `'exceljs/dist/...'`) para mantener el bundle del lado servidor en
 * ~1MB. Este helper es server-side: lo invoca la server action; los
 * clientes solo reciben el `Uint8Array` ya serializado.
 */

import ExcelJS from 'exceljs'

// ───────────────────────── Tipos del input ─────────────────────────

export interface ExportTasksRow {
  mnemonic: string
  title: string
  parent_mnemonic: string | null
  start_date: Date | null
  end_date: Date | null
  duration_days: number | null
  is_milestone: boolean
  progress: number
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  assignee_email: string | null
  tags: string
  description: string | null
}

export interface ExportDepsRow {
  predecessor_mnemonic: string
  successor_mnemonic: string
  type: 'FS' | 'SS' | 'FF' | 'SF'
  lag_days: number
}

export interface ExportResourcesRow {
  email: string
  name: string
  role: string
}

export interface BuildExcelInput {
  tasks: ExportTasksRow[]
  deps: ExportDepsRow[]
  resources: ExportResourcesRow[]
  projectName: string
}

// ───────────────────────── Constantes de columnas ─────────────────────────
//
// Orden y `key` deben mantenerse alineados con el spec del spike: el
// importador (HU-4.2) lee por header, no por índice, pero emparejar el
// orden facilita la inspección humana del archivo generado.

interface ColumnDef {
  header: string
  key: string
  width: number
  numFmt?: string
}

const TASKS_COLUMNS: ColumnDef[] = [
  { header: 'mnemonic', key: 'mnemonic', width: 16 },
  { header: 'title', key: 'title', width: 32 },
  { header: 'parent_mnemonic', key: 'parent_mnemonic', width: 18 },
  { header: 'start_date', key: 'start_date', width: 14, numFmt: 'yyyy-mm-dd' },
  { header: 'end_date', key: 'end_date', width: 14, numFmt: 'yyyy-mm-dd' },
  { header: 'duration_days', key: 'duration_days', width: 14 },
  { header: 'is_milestone', key: 'is_milestone', width: 14 },
  { header: 'progress', key: 'progress', width: 10 },
  { header: 'priority', key: 'priority', width: 12 },
  { header: 'assignee_email', key: 'assignee_email', width: 28 },
  { header: 'tags', key: 'tags', width: 24 },
  { header: 'description', key: 'description', width: 40 },
]

const DEPS_COLUMNS: ColumnDef[] = [
  { header: 'predecessor_mnemonic', key: 'predecessor_mnemonic', width: 22 },
  { header: 'successor_mnemonic', key: 'successor_mnemonic', width: 22 },
  { header: 'type', key: 'type', width: 8 },
  { header: 'lag_days', key: 'lag_days', width: 10 },
]

const RESOURCES_COLUMNS: ColumnDef[] = [
  { header: 'email', key: 'email', width: 30 },
  { header: 'name', key: 'name', width: 24 },
  { header: 'role', key: 'role', width: 16 },
]

// Listas para data validation inline en el archivo. Las comillas dobles
// dentro de la fórmula son requisito de exceljs cuando la lista es literal.
const PRIORITY_LIST_FORMULA = '"LOW,MEDIUM,HIGH,CRITICAL"'
const DEP_TYPE_LIST_FORMULA = '"FS,SS,FF,SF"'

// ───────────────────────── Helpers internos ─────────────────────────

function applyHeaderStyle(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.font = { bold: true }
  })
}

function applyColumns(sheet: ExcelJS.Worksheet, defs: ColumnDef[]): void {
  sheet.columns = defs.map((d) => ({
    header: d.header,
    key: d.key,
    width: d.width,
    style: d.numFmt ? { numFmt: d.numFmt } : undefined,
  }))
}

// ───────────────────────── Build principal ─────────────────────────

/**
 * Construye el workbook completo y lo serializa a `Uint8Array`. El
 * resultado puede mandarse al cliente como base64 (ver
 * `actions/import-export.ts`) o escribirse a disco en flujos server.
 *
 * Notas:
 *  - El nombre del workbook (metadata) se setea con `projectName` para
 *    que herramientas como Power Query muestren el origen.
 *  - Las celdas de fecha se escriben como `Date` real, no string. exceljs
 *    aplica el `numFmt: yyyy-mm-dd` desde el column.style.
 *  - Las validaciones inline se aplican por rango fijo (filas 2..10001)
 *    porque exceljs no soporta "columna entera" sin nombre. 10k filas
 *    cubre cualquier proyecto razonable; si se excede, el archivo seguirá
 *    válido pero las celdas extra no tendrán dropdown.
 */
export async function buildExcelWorkbook(
  input: BuildExcelInput,
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'FollowupGantt'
  wb.created = new Date()
  wb.title = input.projectName

  // ─── Hoja 1: Tareas ───
  const tasksSheet = wb.addWorksheet('Tareas')
  applyColumns(tasksSheet, TASKS_COLUMNS)
  applyHeaderStyle(tasksSheet.getRow(1))

  for (const t of input.tasks) {
    tasksSheet.addRow({
      mnemonic: t.mnemonic,
      title: t.title,
      parent_mnemonic: t.parent_mnemonic,
      start_date: t.start_date,
      end_date: t.end_date,
      duration_days: t.duration_days,
      is_milestone: t.is_milestone,
      progress: t.progress,
      priority: t.priority,
      assignee_email: t.assignee_email,
      tags: t.tags,
      description: t.description,
    })
  }

  // Validación inline: priority (col I) sólo acepta enum.
  const priorityColLetter = tasksSheet.getColumn('priority').letter
  for (let r = 2; r <= 10_001; r++) {
    tasksSheet.getCell(`${priorityColLetter}${r}`).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: [PRIORITY_LIST_FORMULA],
      showErrorMessage: true,
      errorStyle: 'error',
      errorTitle: 'Prioridad inválida',
      error: 'Use LOW, MEDIUM, HIGH o CRITICAL',
    }
  }

  // ─── Hoja 2: Dependencias ───
  const depsSheet = wb.addWorksheet('Dependencias')
  applyColumns(depsSheet, DEPS_COLUMNS)
  applyHeaderStyle(depsSheet.getRow(1))

  for (const d of input.deps) {
    depsSheet.addRow({
      predecessor_mnemonic: d.predecessor_mnemonic,
      successor_mnemonic: d.successor_mnemonic,
      type: d.type,
      lag_days: d.lag_days,
    })
  }

  // Validación inline: type (col C) sólo acepta enum 2-letter.
  const depTypeColLetter = depsSheet.getColumn('type').letter
  for (let r = 2; r <= 10_001; r++) {
    depsSheet.getCell(`${depTypeColLetter}${r}`).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: [DEP_TYPE_LIST_FORMULA],
      showErrorMessage: true,
      errorStyle: 'error',
      errorTitle: 'Tipo inválido',
      error: 'Use FS, SS, FF o SF',
    }
  }

  // ─── Hoja 3: Recursos ───
  const resourcesSheet = wb.addWorksheet('Recursos')
  applyColumns(resourcesSheet, RESOURCES_COLUMNS)
  applyHeaderStyle(resourcesSheet.getRow(1))

  for (const r of input.resources) {
    resourcesSheet.addRow({
      email: r.email,
      name: r.name,
      role: r.role,
    })
  }

  // exceljs.writeBuffer retorna un ArrayBuffer (en Node es un Buffer).
  // Normalizamos a Uint8Array para que el caller no dependa del runtime.
  const buf = await wb.xlsx.writeBuffer()
  return new Uint8Array(buf as ArrayBuffer)
}
