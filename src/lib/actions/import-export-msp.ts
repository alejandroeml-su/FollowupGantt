'use server'

/**
 * HU-4.3 · Server action de exportación a MS Project XML 2003+.
 *
 * Archivo separado de `import-export.ts` (Excel) para evitar merge
 * conflicts mientras avanzan en paralelo HU-4.2 (importer Excel) y
 * HU-4.5 (download template). Ambas server actions son independientes y
 * comparten solo conceptos (no código).
 *
 * Pipeline:
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
 * Errores tipados con prefijo `[CODE]`. Códigos:
 *   - INVALID_INPUT, NOT_FOUND, FILE_TOO_LARGE, EXPORT_FAILED.
 *
 * No requiere `revalidatePath` (export es read-only).
 */

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
