'use server'

/**
 * Wave P16-B · Migration Assistant from CSV.
 *
 * Server action `importTasksFromCsv` que recibe filas YA parseadas en el
 * cliente (con papaparse) y persiste tasks en el proyecto destino. El
 * parsing del CSV vive en el cliente para no transferir el blob completo
 * al servidor; aquí sólo recibimos un array tipado.
 *
 * Convenciones del repo:
 *   - Errores tipados `[CODE] detalle`.
 *   - Validación con zod del shape recibido.
 *   - `requireProjectAccess` antes de escribir.
 *   - Si una row falla, continúa con las demás (acumula warnings).
 *   - Audit log: `import.completed` con count.
 *
 * Mapping del CSV:
 *   - `title` → Task.title (obligatorio)
 *   - `description` → Task.description
 *   - `status` → mapeado a TaskStatus (Backlog/To Do → TODO,
 *     In Progress → IN_PROGRESS, Done/Closed → DONE; default TODO)
 *   - `priority` → mapeado a Priority (Highest/High → HIGH,
 *     Medium → MEDIUM, Low/Lowest → LOW; default MEDIUM)
 *   - `estimate` → Task.storyPoints (snap a Fibonacci si está fuera)
 *   - `assignee_email` → resolver a User.id; null si no existe
 *   - `tags` → comma-separated → string[]
 *
 * Límites:
 *   - Máximo 500 rows por importación (D17-style hard cap).
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requireProjectAccess } from '@/lib/auth/check-project-access'
import { recordAuditEventSafe } from '@/lib/audit/events'
import { invalidateCpmCache } from '@/lib/scheduling/invalidate'
import {
  MAX_CSV_ROWS,
  buildMnemonicPrefix,
  mapEstimateToStoryPoints,
  mapPriority,
  mapStatus,
  parseTags,
} from '@/lib/migrate/csv-mappers'

// ─────────────────── Errores tipados ───────────────────────────────────

export type MigrateCsvErrorCode =
  | 'INVALID_INPUT'
  | 'PROJECT_NOT_FOUND'
  | 'TOO_MANY_ROWS'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'

function actionError(code: MigrateCsvErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ─────────────────── Schema input ──────────────────────────────────────

const csvRowSchema = z.object({
  title: z.string(),
  description: z.string().nullish(),
  status: z.string().nullish(),
  priority: z.string().nullish(),
  estimate: z.union([z.string(), z.number()]).nullish(),
  assignee_email: z.string().nullish(),
  tags: z.string().nullish(),
})

const importInputSchema = z.object({
  projectId: z.string().min(1),
  rows: z.array(csvRowSchema).min(1).max(MAX_CSV_ROWS),
})

export type ImportTasksFromCsvInput = z.input<typeof importInputSchema>
export type ImportCsvRow = z.infer<typeof csvRowSchema>

// ─────────────────── Resultado ─────────────────────────────────────────

export interface ImportTasksFromCsvResult {
  imported: number
  skipped: number
  warnings: string[]
}

// ─────────────────── Action ────────────────────────────────────────────

export async function importTasksFromCsv(
  input: ImportTasksFromCsvInput,
): Promise<ImportTasksFromCsvResult> {
  const parsed = importInputSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    if (issue?.code === 'too_big') {
      actionError(
        'TOO_MANY_ROWS',
        `Máximo ${MAX_CSV_ROWS} filas por importación; recibidas ${
          Array.isArray(input?.rows) ? input.rows.length : 0
        }`,
      )
    }
    actionError('INVALID_INPUT', issue?.message ?? 'Input inválido')
  }
  const { projectId, rows } = parsed.data

  // Acceso al proyecto (RBAC + sesión).
  const user = await requireProjectAccess(projectId)

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  })
  if (!project) actionError('PROJECT_NOT_FOUND', `Proyecto ${projectId} no existe`)

  const prefix = buildMnemonicPrefix(project.name)

  // Pre-resolver assignees por email para no spamear con N round-trips
  // a User.findFirst. Coleccionamos los emails únicos no vacíos.
  const emails = Array.from(
    new Set(
      rows
        .map((r) => (r.assignee_email ?? '').trim().toLowerCase())
        .filter((e) => e.length > 0),
    ),
  )
  const usersByEmail = emails.length
    ? await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true, email: true },
      })
    : []
  const emailToUserId = new Map(
    usersByEmail.map((u) => [u.email.toLowerCase(), u.id]),
  )

  // Counter inicial para mnemónicos. Lo incrementamos local — más eficiente
  // que recomputar `task.count` cada fila.
  let baseCount = await prisma.task.count({ where: { projectId } })

  const warnings: string[] = []
  let imported = 0
  let skipped = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const lineNum = i + 2 // +2 porque la línea 1 es header en el CSV
    const title = (row.title ?? '').trim()
    if (!title) {
      warnings.push(`Línea ${lineNum}: title vacío, fila descartada`)
      skipped++
      continue
    }

    const status = mapStatus(row.status)
    const priority = mapPriority(row.priority)
    const storyPoints = mapEstimateToStoryPoints(row.estimate)
    const tags = parseTags(row.tags)

    let assigneeId: string | null = null
    const emailRaw = (row.assignee_email ?? '').trim().toLowerCase()
    if (emailRaw) {
      const found = emailToUserId.get(emailRaw)
      if (found) {
        assigneeId = found
      } else {
        warnings.push(
          `Línea ${lineNum}: assignee_email "${emailRaw}" no existe en el sistema; tarea quedará sin asignar`,
        )
      }
    }

    try {
      const mnemonic = `${prefix}-${baseCount + 1}`
      await prisma.task.create({
        data: {
          title,
          description: row.description?.trim() || null,
          mnemonic,
          projectId,
          status,
          priority,
          type: 'AGILE_STORY',
          assigneeId,
          storyPoints: storyPoints ?? null,
          tags,
          progress: status === 'DONE' ? 100 : 0,
        },
      })
      imported++
      baseCount++
    } catch (err) {
      warnings.push(
        `Línea ${lineNum}: error al crear tarea — ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
      skipped++
    }
  }

  // Audit log
  await recordAuditEventSafe({
    action: 'import.completed',
    entityType: 'project',
    entityId: projectId,
    actorId: user.id,
    after: { imported, skipped, source: 'csv' },
    metadata: {
      totalRows: rows.length,
      warningsCount: warnings.length,
      projectName: project.name,
    },
  })

  // Invalida cache CPM y revalida vistas que listan tareas.
  invalidateCpmCache(projectId)
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/migrate`)
  revalidatePath('/list')
  revalidatePath('/kanban')
  revalidatePath('/gantt')
  revalidatePath('/table')

  return { imported, skipped, warnings }
}
