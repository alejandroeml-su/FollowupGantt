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

import { differenceInCalendarDays } from 'date-fns'
import type { DependencyType as PrismaDependencyType, Priority as PrismaPriority } from '@prisma/client'
import prisma from '@/lib/prisma'
import {
  buildExcelWorkbook,
  type ExportDepsRow,
  type ExportResourcesRow,
  type ExportTasksRow,
} from '@/lib/import-export/excel-writer'

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
