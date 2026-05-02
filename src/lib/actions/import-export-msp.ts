'use server'

/**
 * HU-4.3 · Server action de exportación a MS Project XML 2003+.
 * HU-4.1 · Extendido con `importMspXml` (server action de import con
 * preview + commit transaccional all-or-nothing — D5).
 *
 * Archivo separado de `import-export.ts` (Excel) para evitar merge
 * conflicts mientras avanzan en paralelo HU-4.2 (importer Excel) y
 * HU-4.5 (download template). Ambas server actions son independientes y
 * comparten solo conceptos (no código).
 *
 * Pipeline export:
 *   1. Validar `projectId`.
 *   2. Cargar proyecto + tareas no archivadas + deps + assignees.
 *   3. Generar UIDs sintéticos secuenciales (no se persisten — MSP los
 *      pide únicos por proyecto, pero al exportar son efímeros).
 *   4. Mapear a estructuras puras (`MspExportTask[]`, etc.).
 *   5. `buildMspXml(...)` → string XML.
 *   6. Validar tamaño <5MB (D17).
 *   7. Devolver `{ ok, filename, mimeType, payloadBase64 }` para que el
 *      botón cliente arme el `Blob` + download.
 *
 * Pipeline import (HU-4.1):
 *   1. Decode base64 → Buffer; validar 5 MB (D17).
 *   2. `parseMspXml(...)` → `ParsedMsp` con errores/warnings tipados.
 *   3. Si parse-errors → return ok=false (no toca BD).
 *   4. Resolver `Resource.EmailAddress` → `User.id` (lookup batch); los
 *      sin match generan warning `[RESOURCE_NO_MATCH]` y se importa la
 *      tarea sin assignee (D13).
 *   5. Construir `Task[]` topo-ordenadas por OutlineNumber + asignar
 *      mnemonic auto (`MSP-${uid}`) y tags.
 *   6. Transacción Prisma `$transaction` (D5): si mode='replace' (D12)
 *      borra deps+tasks existentes y reescribe.
 *   7. `invalidateCpmCache` + `validateScheduledChange` (D15: warning
 *      en caso de slack negativo, no error).
 *   8. `revalidatePath('/gantt')` y devolver counts+warnings.
 *
 * Errores tipados con prefijo `[CODE]`. Códigos export:
 *   - INVALID_INPUT, NOT_FOUND, FILE_TOO_LARGE, EXPORT_FAILED.
 * Códigos import:
 *   - INVALID_INPUT, NOT_FOUND, FILE_TOO_LARGE, INVALID_FILE,
 *     INVALID_ROW, DUPLICATE_MNEMONIC, ORPHAN_DEPENDENCY,
 *     CYCLE_DETECTED, IMPORT_FAILED.
 *
 * Export no requiere `revalidatePath` (read-only); import sí.
 */

import { revalidatePath } from 'next/cache'
import type {
  DependencyType as PrismaDependencyType,
  Priority as PrismaPriority,
} from '@prisma/client'
import prisma from '@/lib/prisma'
import {
  buildMspXml,
  type MspExportDep,
  type MspExportResource,
  type MspExportTask,
} from '@/lib/import-export/msp-writer'
import {
  parseMspXml,
  type MspTaskRow,
} from '@/lib/import-export/msp-parser'
import {
  DEP_TYPE_2L_TO_PRISMA,
  FILE_SIZE_LIMIT_BYTES,
  FILE_SIZE_LIMIT_MB,
  type ImportError,
  type ImportWarning,
} from '@/lib/import-export/MAPPING'
import { invalidateCpmCache } from '@/lib/scheduling/invalidate'
import { validateProjectSchedule } from '@/lib/scheduling/validate'
import { requireProjectAccess } from '@/lib/auth/check-project-access'

// ───────────────────────── Errores tipados ─────────────────────────

export type MspExportErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'FILE_TOO_LARGE'
  | 'EXPORT_FAILED'

export interface MspExportResult {
  ok: boolean
  filename?: string
  mimeType?: string
  /** XML serializado a base64 (UTF-8) para cruzar el server-action boundary. */
  payloadBase64?: string
  errors?: { code: MspExportErrorCode; detail: string }[]
}

// ───────────────────────── Constantes ─────────────────────────

const MAX_BYTES = 5 * 1024 * 1024 // D17 · 5 MB
const XML_MIME = 'application/xml'

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

/** Slug ASCII-safe para nombre de archivo (mismo que excel exporter). */
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

// ───────────────────────── Server action ─────────────────────────

export async function exportMspXml(
  projectId: string,
): Promise<MspExportResult> {
  if (!projectId || typeof projectId !== 'string') {
    return {
      ok: false,
      errors: [{ code: 'INVALID_INPUT', detail: 'projectId requerido' }],
    }
  }

  // Auth (Ola P1): solo miembros del proyecto o admins. Lanza error
  // tipado [UNAUTHORIZED]/[FORBIDDEN] consistente con baselines/deps.
  await requireProjectAccess(projectId)

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

    // Tareas no archivadas. Solo seleccionamos lo que el writer necesita;
    // las que no tienen fechas se descartan porque MSP exige Start/Finish
    // para representar la barra (sin fechas, no hay nada que graficar).
    const dbTasks = await prisma.task.findMany({
      where: {
        projectId,
        archivedAt: null,
        startDate: { not: null },
        endDate: { not: null },
      },
      select: {
        id: true,
        title: true,
        parentId: true,
        startDate: true,
        endDate: true,
        progress: true,
        priority: true,
        isMilestone: true,
        position: true,
        assignee: { select: { id: true, email: true, name: true } },
      },
      // Orden estable: por position dentro de cada parent (mismo criterio
      // que la vista Gantt) y luego por createdAt como tiebreaker. El
      // writer respeta este orden para calcular OutlineNumber.
      orderBy: [{ parentId: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
    })

    if (dbTasks.length === 0) {
      // Permitido: proyecto vacío genera XML mínimo válido. No es error.
    }

    // ─── UIDs sintéticos: 1-based, asignados en orden de carga ───
    const uidByTaskId = new Map<string, number>()
    dbTasks.forEach((t, idx) => uidByTaskId.set(t.id, idx + 1))

    // Recursos = users distintos asignados a tasks del proyecto. Determinismo
    // por email para diff-friendly.
    const resourceMap = new Map<string, { email: string; name: string }>()
    for (const t of dbTasks) {
      if (t.assignee?.email && !resourceMap.has(t.assignee.email)) {
        resourceMap.set(t.assignee.email, {
          email: t.assignee.email,
          name: t.assignee.name ?? t.assignee.email,
        })
      }
    }
    const resources: MspExportResource[] = Array.from(resourceMap.values())
      .sort((a, b) => a.email.localeCompare(b.email))
      .map((r, idx) => ({ uid: idx + 1, email: r.email, name: r.name }))

    // ─── Dependencias entre tasks no archivadas ───
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

    // ─── Mapeo a estructuras del writer ───
    const tasks: MspExportTask[] = dbTasks.map((t) => ({
      id: t.id,
      uid: uidByTaskId.get(t.id) ?? 0,
      title: t.title,
      // El filtro `not: null` arriba garantiza que startDate/endDate no son
      // null aquí, pero TypeScript no lo puede deducir.
      startDate: t.startDate as Date,
      endDate: t.endDate as Date,
      isMilestone: t.isMilestone,
      parentId: t.parentId,
      progress: t.progress,
      priority: PRIORITY_PRISMA_TO_STRING[t.priority],
      position: t.position,
    }))

    const deps: MspExportDep[] = dbDeps
      // Filtro defensivo: si por alguna race condition la dep apunta a una
      // task que ya no está en el set (archivada después del findMany),
      // simplemente se ignora.
      .filter(
        (d) => uidByTaskId.has(d.predecessorId) && uidByTaskId.has(d.successorId),
      )
      .map((d) => ({
        predecessorId: d.predecessorId,
        successorId: d.successorId,
        type: DEP_TYPE_PRISMA_TO_2L[d.type],
        lagDays: d.lagDays ?? 0,
      }))

    // ─── Build XML ───
    const xmlString = buildMspXml({
      projectName: project.name,
      tasks,
      deps,
      resources,
    })

    const xmlBuffer = Buffer.from(xmlString, 'utf-8')

    if (xmlBuffer.byteLength > MAX_BYTES) {
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

    const filename = `${slug(project.name) || 'proyecto'}-${todayIsoDate()}.xml`
    const payloadBase64 = xmlBuffer.toString('base64')

    return {
      ok: true,
      filename,
      mimeType: XML_MIME,
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

// ───────────────────────── Import MSP XML (HU-4.1) ─────────────────────────

const DEP_TYPE_2L_TO_PRISMA_MAP = DEP_TYPE_2L_TO_PRISMA satisfies Record<
  'FS' | 'SS' | 'FF' | 'SF',
  PrismaDependencyType
>

const PRIORITY_KEY_TO_PRISMA: Record<
  'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
  PrismaPriority
> = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
}

export interface MspImportInput {
  /** XML serializado a base64 desde el cliente. */
  fileBase64: string
  filename: string
  projectId: string
  /** D12 · Solo `replace` en P0. Default: 'replace'. */
  mode?: 'replace'
}

export interface MspImportResult {
  ok: boolean
  counts?: {
    tasksCreated: number
    depsCreated: number
    tasksDeleted: number
    depsDeleted: number
    resourcesMatched: number
    resourcesUnmatched: number
  }
  warnings?: ImportWarning[]
  errors?: ImportError[]
}

/**
 * Topo sort de `MspTaskRow[]` por jerarquía: parents primero. Replica el
 * patrón de `topoSortByParent` del importer Excel pero usando
 * `parentExternalId`. Mantiene el orden de aparición original entre
 * hermanos para que `position` (asignada después como `idx*1000`) sea
 * estable y diff-friendly.
 */
function topoSortMspTasks(tasks: MspTaskRow[]): MspTaskRow[] {
  const byExternalId = new Map<string, MspTaskRow>()
  for (const t of tasks) byExternalId.set(t.externalId, t)

  const result: MspTaskRow[] = []
  const inserted = new Set<string>()
  function visit(t: MspTaskRow): void {
    if (inserted.has(t.externalId)) return
    if (t.parentExternalId) {
      const parent = byExternalId.get(t.parentExternalId)
      if (parent) visit(parent)
    }
    inserted.add(t.externalId)
    result.push(t)
  }
  for (const t of tasks) visit(t)
  return result
}

export async function importMspXml(
  input: MspImportInput,
): Promise<MspImportResult> {
  if (!input?.fileBase64 || !input?.projectId) {
    return {
      ok: false,
      errors: [
        { code: 'INVALID_INPUT', detail: 'fileBase64 y projectId requeridos' },
      ],
    }
  }

  // Auth (Ola P1): defensa explícita antes de tocar BD.
  await requireProjectAccess(input.projectId)

  // ─── Decode base64 + validar tamaño (D17) ───
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

  // ─── Verificar proyecto ───
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true },
  })
  if (!project) {
    return {
      ok: false,
      errors: [{ code: 'NOT_FOUND', detail: 'el proyecto no existe' }],
    }
  }

  // ─── Parse XML ───
  const xmlString = buffer.toString('utf-8')
  const parsed = parseMspXml(xmlString)
  if (parsed.errors.length > 0) {
    return { ok: false, errors: parsed.errors }
  }

  const warnings: ImportWarning[] = [...parsed.warnings]

  // ─── Resolver Resources → User.id (D13: NO crear users) ───
  const emails = parsed.resources
    .map((r) => r.email)
    .filter((e): e is string => !!e)
  const dbUsers = emails.length
    ? await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true, email: true },
      })
    : []
  const emailToUserId = new Map<string, string>()
  for (const u of dbUsers) emailToUserId.set(u.email, u.id)

  // ResourceUID → assigneeId (User.id) o null cuando no matchea / sin email.
  const resourceUidToUserId = new Map<number, string | null>()
  let resourcesMatched = 0
  let resourcesUnmatched = 0
  for (const r of parsed.resources) {
    if (!r.email) {
      resourceUidToUserId.set(r.uid, null)
      resourcesUnmatched++
      warnings.push({
        code: 'RESOURCE_NO_MATCH',
        detail: `Resource UID=${r.uid} (${r.name}) sin email — se importará sin assignee`,
        sheet: 'Recursos',
        row: r.uid,
      })
      continue
    }
    const userId = emailToUserId.get(r.email) ?? null
    resourceUidToUserId.set(r.uid, userId)
    if (userId) {
      resourcesMatched++
    } else {
      resourcesUnmatched++
      warnings.push({
        code: 'RESOURCE_NO_MATCH',
        detail: `email "${r.email}" sin User correspondiente — Task se importará sin assignee`,
        sheet: 'Recursos',
        row: r.uid,
      })
    }
  }

  // taskExternalId → assigneeId (resuelto vía Resource.assignedTaskExternalIds)
  const taskExtIdToAssigneeId = new Map<string, string | null>()
  for (const r of parsed.resources) {
    const userId = resourceUidToUserId.get(r.uid) ?? null
    for (const taskExtId of r.assignedTaskExternalIds) {
      // Si ya hay uno, MULTIPLE_ASSIGNMENTS_IGNORED ya se reportó arriba.
      if (!taskExtIdToAssigneeId.has(taskExtId)) {
        taskExtIdToAssigneeId.set(taskExtId, userId)
      }
    }
  }

  // ─── Asignar UUIDs estables por externalId ───
  const externalIdToTaskId = new Map<string, string>()
  for (const t of parsed.tasks) {
    externalIdToTaskId.set(t.externalId, crypto.randomUUID())
  }

  // ─── Transacción all-or-nothing (D5) ───
  try {
    const result = await prisma.$transaction(async (tx) => {
      let tasksDeleted = 0
      let depsDeleted = 0

      const mode = input.mode ?? 'replace'
      if (mode === 'replace') {
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

      // Crear tasks topo-ordenadas (parents primero para satisfacer FK).
      const sorted = topoSortMspTasks(parsed.tasks)
      for (let idx = 0; idx < sorted.length; idx++) {
        const t = sorted[idx]
        const id = externalIdToTaskId.get(t.externalId)!
        const parentId = t.parentExternalId
          ? externalIdToTaskId.get(t.parentExternalId) ?? null
          : null
        const assigneeId = taskExtIdToAssigneeId.get(t.externalId) ?? null

        await tx.task.create({
          data: {
            id,
            // Mnemonic auto-generado para que round-trip identifique
            // origen MSP. Único por (projectId, mnemonic) gracias al UID.
            mnemonic: `MSP-${t.uid}`,
            title: t.title,
            description: t.description,
            projectId: input.projectId,
            parentId,
            assigneeId,
            startDate: t.startDate,
            endDate: t.endDate,
            progress: t.progress,
            priority: PRIORITY_KEY_TO_PRISMA[t.priority],
            isMilestone: t.isMilestone,
            position: idx * 1000,
            tags: ['imported-msp'],
            referenceUrl: t.referenceUrl,
          },
        })
      }

      // Crear dependencias.
      let depsCreated = 0
      for (const d of parsed.deps) {
        const predId = externalIdToTaskId.get(d.predecessorExternalId)
        const succId = externalIdToTaskId.get(d.successorExternalId)
        if (!predId || !succId) continue
        await tx.taskDependency.create({
          data: {
            predecessorId: predId,
            successorId: succId,
            type: DEP_TYPE_2L_TO_PRISMA_MAP[d.type],
            lagDays: d.lagDays,
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

    // D15 · Validar slack negativo POST-commit. NO bloquea el import:
    // si quedó un float negativo solo emitimos warning informativo.
    try {
      const validation = await validateProjectSchedule(input.projectId)
      if (validation.negativeFloatTasks.length > 0) {
        warnings.push({
          code: 'NEGATIVE_FLOAT_POST_IMPORT',
          detail: `${validation.negativeFloatTasks.length} tarea(s) con holgura negativa tras el import`,
          sheet: 'MSP',
        })
      }
    } catch {
      // Validación post-import es best-effort; un fallo aquí no debe
      // romper el flujo. Los datos ya están commiteados.
    }

    revalidatePath('/gantt')

    return {
      ok: true,
      counts: {
        ...result,
        resourcesMatched,
        resourcesUnmatched,
      },
      warnings,
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
 * Pre-flight de import MSP usado por el endpoint REST `/api/import/preview`.
 * No toca BD: solo parsea, valida tamaño y resuelve emails contra `User`
 * para que el cliente vea cuántos resources tienen match.
 */
export interface MspImportPreviewInput {
  buffer: Buffer | Uint8Array
  projectId: string
}

export interface MspImportPreviewSuccess {
  ok: true
  counts: {
    tasks: number
    deps: number
    resources: number
    matchedUsers: number
    unmatchedEmails: string[]
    rootCount: number
    maxDepth: number
  }
  /** 20 primeras tasks para sample en el dialog. */
  sample: Array<{
    title: string
    start_date: Date
    end_date: Date
    parent_outline: string
    outline: string
    is_milestone: boolean
    progress: number
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  }>
  warnings: ImportWarning[]
  projectName: string | null
}

export interface MspImportPreviewFailure {
  ok: false
  errors: ImportError[]
}

export type MspImportPreviewResult =
  | MspImportPreviewSuccess
  | MspImportPreviewFailure

export async function buildMspImportPreview(
  args: MspImportPreviewInput,
): Promise<MspImportPreviewResult> {
  const { buffer, projectId } = args
  if (!projectId || typeof projectId !== 'string') {
    return {
      ok: false,
      errors: [{ code: 'INVALID_INPUT', detail: 'projectId requerido' }],
    }
  }

  // Auth (Ola P1): preview también requiere acceso (lee tareas/usuarios
  // del proyecto para resolver matches). Lanza error tipado.
  await requireProjectAccess(projectId)

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

  const xmlString = Buffer.from(buffer).toString('utf-8')
  const parsed = parseMspXml(xmlString)
  if (parsed.errors.length > 0) {
    return { ok: false, errors: parsed.errors }
  }

  // Resolver emails contra User.email (batch).
  const emails = Array.from(
    new Set(
      parsed.resources
        .map((r) => r.email)
        .filter((e): e is string => !!e),
    ),
  )
  const dbUsers = emails.length
    ? await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true, email: true },
      })
    : []
  const matchedSet = new Set(dbUsers.map((u) => u.email))
  const unmatchedEmails = emails.filter((e) => !matchedSet.has(e))

  const warnings: ImportWarning[] = [...parsed.warnings]
  for (const email of unmatchedEmails) {
    warnings.push({
      code: 'RESOURCE_NO_MATCH',
      detail: `email "${email}" sin User correspondiente; se importará sin assignee`,
      sheet: 'Recursos',
    })
  }

  // Index outline → padre outline para sample preview legible.
  const outlineByExtId = new Map<string, string>()
  for (const t of parsed.tasks) outlineByExtId.set(t.externalId, t.outlineNumber)

  const sample = parsed.tasks.slice(0, 20).map((t) => ({
    title: t.title,
    start_date: t.startDate,
    end_date: t.endDate,
    parent_outline: t.parentExternalId
      ? outlineByExtId.get(t.parentExternalId) ?? ''
      : '',
    outline: t.outlineNumber,
    is_milestone: t.isMilestone,
    progress: t.progress,
    priority: t.priority,
  }))

  const rootCount = parsed.tasks.filter(
    (t) => t.parentExternalId === null,
  ).length
  const maxDepth = parsed.tasks.reduce(
    (acc, t) => Math.max(acc, t.outlineLevel),
    0,
  )

  return {
    ok: true,
    counts: {
      tasks: parsed.tasks.length,
      deps: parsed.deps.length,
      resources: parsed.resources.length,
      matchedUsers: dbUsers.length,
      unmatchedEmails,
      rootCount,
      maxDepth,
    },
    sample,
    warnings,
    projectName: parsed.projectName,
  }
}
