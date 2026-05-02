'use server'

/**
 * HU-4.4 · Server actions de import/export.
 *
 * Por ahora solo expone `exportExcel(projectId)`. La importación
 * (HU-4.2) se sumará en una HU posterior, cuando el mapping doc esté
 * cerrado y haya archivos reales del cliente para validar contra.
 *
 * Pipeline de export:
 *   1. Verificar que el proyecto exista.
 *   2. Cargar tareas (no archivadas), dependencias y recursos.
 *   3. Mapear a las filas que consume `buildExcelWorkbook`.
 *   4. Validar tamaño <5MB (D17).
 *   5. Devolver `{ ok, filename, mimeType, payloadBase64 }` para que el
 *      botón cliente arme el download sin más server-roundtrips.
 *
 * Convenciones del repo:
 *   - Errores tipados `[CODE] detalle`.
 *   - No `revalidatePath` (export es read-only).
 *   - Lookups por mnemónico se resuelven en memoria con maps; las
 *     queries son al ras (sin includes anidados pesados) para mantener
 *     la latencia baja.
 */

import { revalidatePath } from 'next/cache'
import { differenceInCalendarDays } from 'date-fns'
import type { DependencyType as PrismaDependencyType, Priority as PrismaPriority } from '@prisma/client'
import prisma from '@/lib/prisma'
import {
  buildExcelWorkbook,
  type ExportDepsRow,
  type ExportResourcesRow,
  type ExportTasksRow,
} from '@/lib/import-export/excel-writer'
import {
  parseExcelBuffer,
  type ExcelTaskRow,
  type ExcelDepRow,
  type ExcelResourceRow,
} from '@/lib/import-export/excel-parser'
import {
  DEP_TYPE_2L_TO_PRISMA,
  FILE_SIZE_LIMIT_BYTES,
  FILE_SIZE_LIMIT_MB,
  type ImportError,
  type ImportWarning,
} from '@/lib/import-export/MAPPING'
import { invalidateCpmCache } from '@/lib/scheduling/invalidate'

// ───────────────────────── Errores tipados ─────────────────────────

export type ExportErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'FILE_TOO_LARGE'
  | 'EXPORT_FAILED'

export interface ExportResult {
  ok: boolean
  filename?: string
  mimeType?: string
  /** Workbook serializado a base64 para que el server action lo cruce a cliente. */
  payloadBase64?: string
  errors?: { code: ExportErrorCode; detail: string }[]
}

// ───────────────────────── Constantes ─────────────────────────

const MAX_BYTES = 5 * 1024 * 1024 // D17 · 5 MB
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const DEP_TYPE_PRISMA_TO_2L: Record<
  PrismaDependencyType,
  'FS' | 'SS' | 'FF' | 'SF'
> = {
  FINISH_TO_START: 'FS',
  START_TO_START: 'SS',
  FINISH_TO_FINISH: 'FF',
  START_TO_FINISH: 'SF',
}

const PRIORITY_PRISMA_TO_STRING: Record<
  PrismaPriority,
  'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
> = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
}

// ───────────────────────── Helpers ─────────────────────────

/**
 * Slug ASCII-safe para nombre de archivo. Normaliza acentos y reemplaza
 * cualquier no-alfanumérico por `-` colapsado. Útil para descargar
 * `mi-proyecto-2026-05-01.xlsx` desde "Mi Proyecto".
 */
function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function todayIsoDate(): string {
  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function durationDays(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null
  // Inclusive: una tarea de 1 día (start === end) reporta duration=1.
  // Coincide con el cálculo del Gantt (rangeDays).
  return differenceInCalendarDays(end, start) + 1
}

// ───────────────────────── Server action ─────────────────────────

export async function exportExcel(projectId: string): Promise<ExportResult> {
  if (!projectId || typeof projectId !== 'string') {
    return {
      ok: false,
      errors: [{ code: 'INVALID_INPUT', detail: 'projectId requerido' }],
    }
  }

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    })
    if (!project) {
      return {
        ok: false,
        errors: [{ code: 'NOT_FOUND', detail: 'El proyecto no existe' }],
      }
    }

    // Tareas no archivadas con assignee y parent. Seleccionamos solo
    // los campos necesarios para el export.
    const dbTasks = await prisma.task.findMany({
      where: { projectId, archivedAt: null },
      select: {
        id: true,
        mnemonic: true,
        title: true,
        description: true,
        parentId: true,
        startDate: true,
        endDate: true,
        progress: true,
        priority: true,
        isMilestone: true,
        tags: true,
        assignee: { select: { email: true, name: true } },
      },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
    })

    // Map id → mnemonic para resolver `parent_mnemonic`. Tareas sin
    // mnemónico (caso legacy) reciben string vacío como fallback estable.
    const idToMnemonic = new Map<string, string>()
    for (const t of dbTasks) {
      idToMnemonic.set(t.id, t.mnemonic ?? '')
    }

    const taskIds = dbTasks.map((t) => t.id)
    const dbDeps =
      taskIds.length === 0
        ? []
        : await prisma.taskDependency.findMany({
            where: {
              AND: [
                { predecessorId: { in: taskIds } },
                { successorId: { in: taskIds } },
              ],
            },
            select: {
              predecessorId: true,
              successorId: true,
              type: true,
              lagDays: true,
            },
          })

    // Recursos = users distintos asignados a alguna tarea del proyecto.
    // Se ordena por email para determinismo en el archivo (ayuda a diff).
    const resourceMap = new Map<string, ExportResourcesRow>()
    for (const t of dbTasks) {
      if (t.assignee?.email) {
        if (!resourceMap.has(t.assignee.email)) {
          resourceMap.set(t.assignee.email, {
            email: t.assignee.email,
            name: t.assignee.name ?? '',
            // Hoja informativa: "role" hoy es siempre 'AGENTE'.
            // Cuando la HU-4.0 traiga roles reales del MSP los mapeamos.
            role: 'AGENTE',
          })
        }
      }
    }

    // ─── Mapeo a filas del writer ───
    const tasks: ExportTasksRow[] = dbTasks.map((t) => ({
      mnemonic: t.mnemonic ?? '',
      title: t.title,
      parent_mnemonic: t.parentId ? (idToMnemonic.get(t.parentId) ?? null) : null,
      start_date: t.startDate,
      end_date: t.endDate,
      duration_days: durationDays(t.startDate, t.endDate),
      is_milestone: t.isMilestone,
      progress: t.progress,
      priority: PRIORITY_PRISMA_TO_STRING[t.priority],
      assignee_email: t.assignee?.email ?? null,
      tags: (t.tags ?? []).join(','),
      description: t.description,
    }))

    const deps: ExportDepsRow[] = dbDeps.map((d) => ({
      predecessor_mnemonic: idToMnemonic.get(d.predecessorId) ?? '',
      successor_mnemonic: idToMnemonic.get(d.successorId) ?? '',
      type: DEP_TYPE_PRISMA_TO_2L[d.type],
      lag_days: d.lagDays ?? 0,
    }))

    const resources: ExportResourcesRow[] = Array.from(resourceMap.values()).sort(
      (a, b) => a.email.localeCompare(b.email),
    )

    // ─── Build workbook ───
    const buffer = await buildExcelWorkbook({
      tasks,
      deps,
      resources,
      projectName: project.name,
    })

    // D17 · 5 MB tope. Hoy un proyecto típico ronda los 20-40 KB; si se
    // dispara, casi seguro hay algo raro (descripciones gigantes, tags
    // explotados). Mejor fallar temprano y que el usuario lo investigue.
    if (buffer.byteLength > MAX_BYTES) {
      return {
        ok: false,
        errors: [
          {
            code: 'FILE_TOO_LARGE',
            detail: `El archivo generado supera el tope de ${MAX_BYTES / (1024 * 1024)} MB`,
          },
        ],
      }
    }

    const filename = `${slug(project.name) || 'proyecto'}-${todayIsoDate()}.xlsx`
    const payloadBase64 = Buffer.from(buffer).toString('base64')

    return {
      ok: true,
      filename,
      mimeType: XLSX_MIME,
      payloadBase64,
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      errors: [{ code: 'EXPORT_FAILED', detail }],
    }
  }
}

// ───────────────────────── Import (HU-4.2) ─────────────────────────

/**
 * Resultado canónico devuelto por el motor de import — usado tanto por
 * el endpoint `/api/import/preview` como por el server action
 * `importExcel`.
 */
export interface ImportPreview {
  ok: true
  counts: {
    tasks: number
    deps: number
    resources: number
    matchedUsers: number
    unmatchedEmails: string[]
  }
  /** Sample 20 filas de tareas para mostrar en el modal preview. */
  sample: Array<
    Pick<
      ExcelTaskRow,
      | 'mnemonic'
      | 'title'
      | 'parent_mnemonic'
      | 'start_date'
      | 'end_date'
      | 'priority'
      | 'is_milestone'
      | 'progress'
    >
  >
  warnings: ImportWarning[]
}

export interface ImportFailure {
  ok: false
  errors: ImportError[]
}

export type ImportResult = ImportPreview | ImportFailure

/**
 * Realiza un pre-flight del archivo Excel: parsea, valida y resuelve
 * referencias contra la BD del proyecto, pero NO escribe nada. Lo
 * usan tanto el endpoint REST como el server action antes de
 * commitear.
 *
 * Reglas:
 *  - Email que no matchea con `User.email` → warning RESOURCE_NO_MATCH
 *    (la tarea se importa sin assignee, no es error).
 *  - Si hay errores duros del parser, los devuelve sin tocar BD.
 */
export async function buildImportPreview(args: {
  buffer: Buffer | Uint8Array
  projectId: string
  filename?: string
}): Promise<ImportResult> {
  const { buffer, projectId } = args

  if (!projectId || typeof projectId !== 'string') {
    return {
      ok: false,
      errors: [{ code: 'INVALID_INPUT', detail: 'projectId requerido' }],
    }
  }
  if (buffer.byteLength > FILE_SIZE_LIMIT_BYTES) {
    return {
      ok: false,
      errors: [
        {
          code: 'FILE_TOO_LARGE',
          detail: `el archivo supera ${FILE_SIZE_LIMIT_MB} MB`,
        },
      ],
    }
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  })
  if (!project) {
    return {
      ok: false,
      errors: [{ code: 'NOT_FOUND', detail: 'el proyecto no existe' }],
    }
  }

  const parsed = await parseExcelBuffer(buffer)
  if ('errors' in parsed) {
    return { ok: false, errors: parsed.errors }
  }

  // Resolver assignee_email → User.id (batch).
  const emails = Array.from(
    new Set(
      parsed.tasks
        .map((t) => t.assignee_email)
        .filter((e): e is string => !!e),
    ),
  )

  const dbUsers = emails.length
    ? await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true, email: true },
      })
    : []
  const matchedEmails = new Set(dbUsers.map((u) => u.email))
  const unmatchedEmails = emails.filter((e) => !matchedEmails.has(e))

  const warnings: ImportWarning[] = [...parsed.warnings]
  for (const email of unmatchedEmails) {
    warnings.push({
      code: 'RESOURCE_NO_MATCH',
      detail: `email "${email}" sin User correspondiente; se importará sin assignee`,
      sheet: 'Tareas',
    })
  }

  const sample = parsed.tasks.slice(0, 20).map((t) => ({
    mnemonic: t.mnemonic,
    title: t.title,
    parent_mnemonic: t.parent_mnemonic,
    start_date: t.start_date,
    end_date: t.end_date,
    priority: t.priority,
    is_milestone: t.is_milestone,
    progress: t.progress,
  }))

  return {
    ok: true,
    counts: {
      tasks: parsed.tasks.length,
      deps: parsed.deps.length,
      resources: parsed.resources.length,
      matchedUsers: dbUsers.length,
      unmatchedEmails,
    },
    sample,
    warnings,
  }
}

export interface ImportExecuteInput {
  /** Archivo en base64 — el cliente lo serializa antes de invocar la action. */
  fileBase64: string
  filename: string
  projectId: string
  /** Solo `replace` en P0 (D12). */
  mode?: 'replace'
}

export interface ImportExecuteResult {
  ok: boolean
  counts?: {
    tasksCreated: number
    depsCreated: number
    tasksDeleted: number
    depsDeleted: number
  }
  warnings?: ImportWarning[]
  errors?: ImportError[]
}

/**
 * Ejecuta el import all-or-nothing dentro de `prisma.$transaction` (D5).
 *
 * Pipeline:
 *  1. Decode base64 → Buffer.
 *  2. `buildImportPreview` (re-parsea + valida; descarta archivos
 *     inválidos antes de tocar BD).
 *  3. Resolver mnemónicos a UUIDs nuevos (`crypto.randomUUID`).
 *  4. Resolver `parent_mnemonic` → `parentId` y `assignee_email` →
 *     `assigneeId` con los datos del preview.
 *  5. Resolver dependencias.
 *  6. Transacción:
 *      a. Si `mode='replace'` → delete deps + tasks del proyecto.
 *      b. createMany tasks (skipDuplicates=false).
 *      c. createMany deps con `lagDays` ya validado.
 *  7. `invalidateCpmCache(projectId)` + `revalidatePath('/gantt')`.
 */
export async function importExcel(
  input: ImportExecuteInput,
): Promise<ImportExecuteResult> {
  if (!input?.fileBase64 || !input?.projectId) {
    return {
      ok: false,
      errors: [
        { code: 'INVALID_INPUT', detail: 'fileBase64 y projectId requeridos' },
      ],
    }
  }

  let buffer: Buffer
  try {
    buffer = Buffer.from(input.fileBase64, 'base64')
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      errors: [{ code: 'INVALID_FILE', detail: `base64 inválido: ${detail}` }],
    }
  }

  const preview = await buildImportPreview({
    buffer,
    projectId: input.projectId,
    filename: input.filename,
  })
  if (!preview.ok) {
    return { ok: false, errors: preview.errors }
  }

  // Re-parsear (full data, no solo sample) para construir las filas.
  const parsed = await parseExcelBuffer(buffer)
  if ('errors' in parsed) {
    return { ok: false, errors: parsed.errors }
  }

  // Resolver email → assigneeId.
  const emails = Array.from(
    new Set(
      parsed.tasks
        .map((t) => t.assignee_email)
        .filter((e): e is string => !!e),
    ),
  )
  const dbUsers = emails.length
    ? await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true, email: true },
      })
    : []
  const emailToUserId = new Map<string, string>()
  for (const u of dbUsers) emailToUserId.set(u.email, u.id)

  // Asignar UUIDs estables por mnemónico.
  const mnemonicToTaskId = new Map<string, string>()
  for (const t of parsed.tasks) mnemonicToTaskId.set(t.mnemonic, crypto.randomUUID())

  try {
    const result = await prisma.$transaction(async (tx) => {
      let tasksDeleted = 0
      let depsDeleted = 0

      const mode = input.mode ?? 'replace'
      if (mode === 'replace') {
        // Identificar tareas existentes y borrar deps que las referencian
        // antes que las tareas (FK cascada normalmente, pero somos
        // explícitos para no depender del schema).
        const existing = await tx.task.findMany({
          where: { projectId: input.projectId },
          select: { id: true },
        })
        const existingIds = existing.map((t) => t.id)
        if (existingIds.length) {
          const delDeps = await tx.taskDependency.deleteMany({
            where: {
              OR: [
                { predecessorId: { in: existingIds } },
                { successorId: { in: existingIds } },
              ],
            },
          })
          depsDeleted = delDeps.count
          const delTasks = await tx.task.deleteMany({
            where: { projectId: input.projectId },
          })
          tasksDeleted = delTasks.count
        }
      }

      // Insertar tareas (jerarquía: parents primero para evitar FK).
      // Topo sort simple: nodes raíz primero, luego hijos en orden BFS.
      const sorted = topoSortByParent(parsed.tasks)
      for (const t of sorted) {
        const id = mnemonicToTaskId.get(t.mnemonic)!
        const parentId = t.parent_mnemonic
          ? (mnemonicToTaskId.get(t.parent_mnemonic) ?? null)
          : null
        const assigneeId = t.assignee_email
          ? (emailToUserId.get(t.assignee_email) ?? null)
          : null

        await tx.task.create({
          data: {
            id,
            mnemonic: t.mnemonic,
            title: t.title,
            description: t.description,
            projectId: input.projectId,
            parentId,
            assigneeId,
            startDate: t.start_date,
            endDate: t.end_date,
            progress: t.progress,
            priority: t.priority,
            isMilestone: t.is_milestone,
            tags: t.tags
              ? t.tags
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
              : [],
          },
        })
      }

      // Insertar dependencias.
      let depsCreated = 0
      for (const d of parsed.deps) {
        const predId = mnemonicToTaskId.get(d.predecessor_mnemonic)
        const succId = mnemonicToTaskId.get(d.successor_mnemonic)
        if (!predId || !succId) continue
        await tx.taskDependency.create({
          data: {
            predecessorId: predId,
            successorId: succId,
            type: DEP_TYPE_2L_TO_PRISMA[d.type],
            lagDays: d.lag_days,
          },
        })
        depsCreated++
      }

      return {
        tasksCreated: parsed.tasks.length,
        depsCreated,
        tasksDeleted,
        depsDeleted,
      }
    })

    invalidateCpmCache(input.projectId)
    revalidatePath('/gantt')

    return {
      ok: true,
      counts: result,
      warnings: preview.warnings,
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      errors: [{ code: 'IMPORT_FAILED', detail }],
    }
  }
}

/**
 * Orden topológico simple de tareas por parent_mnemonic. Garantiza que
 * cuando `prisma.task.create` referencia `parentId`, ese parent ya
 * existe en BD. El orden dentro de un mismo nivel es estable (mantiene
 * el orden original del archivo).
 */
function topoSortByParent(tasks: ExcelTaskRow[]): ExcelTaskRow[] {
  const mnemonicToTask = new Map<string, ExcelTaskRow>()
  for (const t of tasks) mnemonicToTask.set(t.mnemonic, t)

  const result: ExcelTaskRow[] = []
  const inserted = new Set<string>()

  function visit(t: ExcelTaskRow): void {
    if (inserted.has(t.mnemonic)) return
    if (t.parent_mnemonic) {
      const parent = mnemonicToTask.get(t.parent_mnemonic)
      if (parent) visit(parent)
    }
    inserted.add(t.mnemonic)
    result.push(t)
  }

  for (const t of tasks) visit(t)
  return result
}

// Re-export helper shapes (necesarios para tipar la UI cliente).
export type { ExcelTaskRow, ExcelDepRow, ExcelResourceRow }
