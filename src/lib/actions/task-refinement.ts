'use server'

/**
 * Wave P7 · Equipo P7-5 · Refinamiento IA — Server Actions.
 *
 * Cinco actions que ejecutan las heurísticas/LLM de
 * `src/lib/ai/refinement/*` y devuelven previews al cliente. Las
 * mutaciones reales (aplicar la sugerencia) viven en su propia
 * action `applyRefinement` para mantener un único punto de control
 * de auditoría y revalidación.
 *
 * Convenciones del repo aplicadas:
 *   - Errores tipados `[CODE] detalle`.
 *   - `requireProjectAccess` (vía taskId → projectId) en todas las
 *     actions.
 *   - `revalidatePath` después de mutar.
 *   - Cache delegado al LLM adapter (en `prompts.ts`).
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requireProjectAccess } from '@/lib/auth/check-project-access'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { applyAIChecklistSuggestion } from '@/lib/actions/checklist'
import {
  improveDescription,
  type ImproveDescriptionInput,
} from '@/lib/ai/refinement/improve-description'
import { suggestChecklist } from '@/lib/ai/refinement/suggest-checklist'
import { suggestTags } from '@/lib/ai/refinement/suggest-tags'
import { detectDuplicates } from '@/lib/ai/refinement/detect-duplicates'
import { refineCategorization } from '@/lib/ai/refinement/refine-categorization'
import type {
  ImproveDescriptionResult,
  SuggestChecklistResult,
  SuggestTagsResult,
  DetectDuplicatesResult,
  RefineCategorizationResult,
  RefinementResultEnvelope,
} from '@/lib/ai/refinement/schemas'

// ─── Errores tipados ───────────────────────────────────────────────

export type RefinementErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR'
  | 'UNSUPPORTED_KIND'

function actionError(code: RefinementErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ─── Schemas ───────────────────────────────────────────────────────

const taskIdSchema = z.string().min(1, 'taskId es obligatorio')

// ─── Helper: cargar task + verificar acceso ────────────────────────

async function loadTaskWithAccess(taskId: string) {
  const parsed = taskIdSchema.safeParse(taskId)
  if (!parsed.success) actionError('INVALID_INPUT', parsed.error.message)

  const task = await prisma.task.findUnique({
    where: { id: parsed.data },
    select: {
      id: true,
      title: true,
      description: true,
      type: true,
      priority: true,
      tags: true,
      projectId: true,
      project: { select: { id: true, name: true } },
    },
  })
  if (!task) actionError('NOT_FOUND', `Tarea ${taskId} no encontrada`)
  await requireProjectAccess(task.projectId)
  return task
}

// ─── Action: improve description ───────────────────────────────────

export async function improveDescriptionAction(
  taskId: string,
): Promise<RefinementResultEnvelope<ImproveDescriptionResult>> {
  const task = await loadTaskWithAccess(taskId)
  const input: ImproveDescriptionInput = {
    title: task.title,
    currentDescription: task.description,
    projectContext: task.project?.name ?? null,
  }
  return improveDescription(input)
}

// ─── Action: suggest checklist ─────────────────────────────────────

export async function suggestChecklistAction(
  taskId: string,
): Promise<RefinementResultEnvelope<SuggestChecklistResult>> {
  const task = await loadTaskWithAccess(taskId)
  return suggestChecklist({
    title: task.title,
    description: task.description,
  })
}

// ─── Action: suggest tags ──────────────────────────────────────────

export async function suggestTagsAction(
  taskId: string,
): Promise<RefinementResultEnvelope<SuggestTagsResult>> {
  const task = await loadTaskWithAccess(taskId)

  // Top 30 tags más usados en el proyecto (ordenados por uso desc).
  // Levantamos todas las tareas con tags no-vacíos y agregamos.
  const projectTasks = await prisma.task.findMany({
    where: { projectId: task.projectId, archivedAt: null },
    select: { tags: true },
    take: 500, // límite defensivo
  })
  const tagCount = new Map<string, number>()
  for (const t of projectTasks) {
    for (const tag of t.tags ?? []) {
      const k = tag.toLowerCase()
      tagCount.set(k, (tagCount.get(k) ?? 0) + 1)
    }
  }
  const existingTags = Array.from(tagCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([k]) => k)

  return suggestTags({
    title: task.title,
    description: task.description,
    existingTags,
  })
}

// ─── Action: detect duplicates ─────────────────────────────────────

export async function detectDuplicatesAction(
  taskId: string,
): Promise<RefinementResultEnvelope<DetectDuplicatesResult>> {
  const task = await loadTaskWithAccess(taskId)

  const candidates = await prisma.task.findMany({
    where: {
      projectId: task.projectId,
      archivedAt: null,
      id: { not: task.id },
    },
    select: { id: true, title: true, description: true },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  })

  return detectDuplicates({
    reference: {
      id: task.id,
      title: task.title,
      description: task.description,
    },
    candidates: candidates.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
    })),
  })
}

// ─── Action: refine categorization ─────────────────────────────────

export async function refineCategorizationAction(
  taskId: string,
): Promise<RefinementResultEnvelope<RefineCategorizationResult>> {
  const task = await loadTaskWithAccess(taskId)
  return refineCategorization({
    title: task.title,
    description: task.description,
    currentType: String(task.type),
    currentPriority: String(task.priority),
  })
}

// ─── Apply: aplicar la sugerencia (mutación) ───────────────────────

/**
 * Aplica una sugerencia previamente generada. El cliente envía el
 * `kind` y los campos relevantes; el server valida el shape y escribe
 * en BD con auditoría (`TaskHistory`). Optimistic UI vive en el
 * cliente; aquí garantizamos atomicidad.
 *
 * Diseño:
 *   - `description`: reemplaza `task.description` con `improvedDescription`
 *     y opcionalmente concatena criterios y riesgos como bullets al final.
 *   - `tags`: merge con tags actuales (sin perder los existentes salvo que
 *     `replace=true`).
 *   - `categorization`: actualiza `type` y/o `priority`.
 *   - `checklist`: en MVP guardamos los items concatenados a la descripción
 *     como sección "Checklist (sugerida por IA):" — no hay modelo dedicado.
 *   - `merge_duplicate`: marca la task actual como archivada y deja una
 *     anotación apuntando al canónico. Por seguridad, no borra.
 */

const ApplyKindSchema = z.enum([
  'description',
  'checklist',
  'tags',
  'categorization',
  'merge_duplicate',
])

const ApplyPayloadSchema = z.object({
  taskId: z.string().min(1),
  kind: ApplyKindSchema,
  payload: z.record(z.string(), z.unknown()),
})

export type ApplyRefinementResult =
  | { ok: true; taskId: string; applied: string[] }
  | { ok: false; error: string }

export async function applyRefinementAction(
  rawInput: z.infer<typeof ApplyPayloadSchema>,
): Promise<ApplyRefinementResult> {
  const parsed = ApplyPayloadSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: `[INVALID_INPUT] ${parsed.error.message}` }
  const { taskId, kind, payload } = parsed.data

  const task = await loadTaskWithAccess(taskId)
  const user = await getCurrentUser()

  const applied: string[] = []
  const updates: Record<string, unknown> = {}
  const historyEntries: Array<{
    field: string
    oldValue: string
    newValue: string
  }> = []
  // Bug Edwin 2026-05-13 · `Risk` rows acumuladas para crearlas dentro de la
  // transacción final. Cada string se promueve a una fila `Risk` con
  // probability/impact neutros y source=BRAIN_AI.
  const pendingRiskTitles: string[] = []

  if (kind === 'description') {
    const description = String(payload.description ?? '').trim()
    if (description.length === 0) {
      return { ok: false, error: '[INVALID_INPUT] descripción vacía' }
    }
    updates.description = description
    historyEntries.push({
      field: 'description',
      oldValue: task.description ?? '',
      newValue: description,
    })
    applied.push('description')

    // Bug Edwin 2026-05-13 — la IA proponía `acceptanceCriteria` y `risks`
    // junto con la descripción, pero `applyRefinementAction` los descartaba.
    // Ahora:
    //   · `acceptanceCriteria` (string[]) se fusiona con `userStory.criteria`
    //     cuando la tarea es `AGILE_STORY`. Cada nuevo criterio nace con
    //     `done: false` y un uuid propio.
    //   · `risks` (string[]) crea filas en la tabla `Risk` vinculadas a la
    //     tarea + proyecto, con probability/impact neutros (3/3) y
    //     `source: BRAIN_AI`. El usuario puede refinar la matriz desde la
    //     sección de Riesgos del drawer.
    const acceptanceCriteria = Array.isArray(payload.acceptanceCriteria)
      ? (payload.acceptanceCriteria as unknown[])
          .map((v) => String(v ?? '').trim())
          .filter((v) => v.length > 0)
      : []
    const risks = Array.isArray(payload.risks)
      ? (payload.risks as unknown[])
          .map((v) => String(v ?? '').trim())
          .filter((v) => v.length > 0)
      : []

    if (acceptanceCriteria.length > 0) {
      const fullTask = await prisma.task.findUnique({
        where: { id: task.id },
        select: { type: true, userStory: true },
      })
      if (fullTask?.type === 'AGILE_STORY') {
        const us = (fullTask.userStory ?? null) as
          | {
              asA?: string
              iWant?: string
              soThat?: string
              criteria?: Array<{ id: string; text: string; done: boolean }>
            }
          | null
        const existing = Array.isArray(us?.criteria) ? us!.criteria : []
        // Evitamos duplicar criterios con el mismo `text` (case-insensitive).
        const seen = new Set(
          existing.map((c) => String(c.text ?? '').trim().toLowerCase()),
        )
        const additions = acceptanceCriteria
          .filter((t) => !seen.has(t.toLowerCase()))
          .map((text) => ({
            id:
              typeof crypto !== 'undefined' && 'randomUUID' in crypto
                ? crypto.randomUUID()
                : `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            text,
            done: false,
          }))
        if (additions.length > 0) {
          updates.userStory = {
            asA: us?.asA ?? '',
            iWant: us?.iWant ?? '',
            soThat: us?.soThat ?? '',
            criteria: [...existing, ...additions],
          }
          historyEntries.push({
            field: 'userStory.criteria',
            oldValue: String(existing.length),
            newValue: String(existing.length + additions.length),
          })
          applied.push('acceptanceCriteria')
        }
      }
    }

    if (risks.length > 0) {
      // Filas Risk se crean DENTRO de la transacción de abajo via $transaction
      // (ver más adelante). Para eso acumulamos en `risksToCreate` y lo
      // procesamos junto al resto de operaciones.
      pendingRiskTitles.push(...risks)
      applied.push('risks')
      historyEntries.push({
        field: 'risks',
        oldValue: '0',
        newValue: String(risks.length),
      })
    }
  } else if (kind === 'checklist') {
    // Wave C-debt-1 · Equipo C-DEBT-1 — modelo relacional + back-compat.
    //
    // Hasta P7-5 esto anexaba el checklist como markdown a `description`.
    // Ahora el flag `mode` decide:
    //   - 'structured' (DEFAULT): crea filas Checklist + ChecklistItem via
    //     `applyAIChecklistSuggestion`. La descripción no se toca.
    //   - 'markdown': comportamiento anterior — útil para back-compat de
    //     callers existentes que aún esperan ver el checklist en la
    //     descripción.
    const items = Array.isArray(payload.items)
      ? (payload.items as Array<{ text: string; optional?: boolean }>)
      : []
    if (items.length === 0) {
      return { ok: false, error: '[INVALID_INPUT] checklist vacío' }
    }
    const mode = payload.mode === 'markdown' ? 'markdown' : 'structured'

    if (mode === 'structured') {
      // Delegamos en la acción dedicada. Crea Checklist + N items en una
      // transacción atómica y revalida los paths relevantes. Devolvemos
      // applied=['checklist'] sin tocar `updates`/`history` para que la
      // transacción de abajo no incluya ningún update redundante a la task.
      try {
        await applyAIChecklistSuggestion({
          taskId: task.id,
          items: items.map((it) => ({
            text: it.text,
            optional: it.optional,
          })),
        })
        applied.push('checklist')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, error: msg }
      }
    } else {
      // Back-compat: anexa markdown a la descripción.
      const block = [
        '',
        '## Checklist (sugerida por IA)',
        ...items.map(
          (it) => `- [ ] ${it.text}${it.optional ? ' (opcional)' : ''}`,
        ),
      ].join('\n')
      const newDesc = `${task.description ?? ''}${block}`
      updates.description = newDesc
      historyEntries.push({
        field: 'description',
        oldValue: task.description ?? '',
        newValue: newDesc,
      })
      applied.push('checklist')
    }
  } else if (kind === 'tags') {
    const tags = Array.isArray(payload.tags) ? (payload.tags as string[]) : []
    const replace = Boolean(payload.replace)
    const validated = tags
      .map((t) => String(t).toLowerCase().trim())
      .filter((t) => t.length >= 2 && /^[a-z0-9_-]+$/.test(t))
    const current = task.tags ?? []
    const finalTags = replace
      ? Array.from(new Set(validated))
      : Array.from(new Set([...current, ...validated]))
    updates.tags = finalTags
    historyEntries.push({
      field: 'tags',
      oldValue: current.join(','),
      newValue: finalTags.join(','),
    })
    applied.push('tags')
  } else if (kind === 'categorization') {
    const TaskTypeEnum = z.enum(['PHASE', 'AGILE_STORY', 'PMI_TASK', 'ITIL_TICKET'])
    const PriorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
    const typeParsed = TaskTypeEnum.safeParse(payload.type)
    const prioParsed = PriorityEnum.safeParse(payload.priority)
    if (typeParsed.success && String(task.type) !== typeParsed.data) {
      updates.type = typeParsed.data
      historyEntries.push({
        field: 'type',
        oldValue: String(task.type),
        newValue: typeParsed.data,
      })
      applied.push('type')
    }
    if (prioParsed.success && String(task.priority) !== prioParsed.data) {
      updates.priority = prioParsed.data
      historyEntries.push({
        field: 'priority',
        oldValue: String(task.priority),
        newValue: prioParsed.data,
      })
      applied.push('priority')
    }
    if (applied.length === 0) {
      return { ok: false, error: '[INVALID_INPUT] sin cambios efectivos en categorización' }
    }
  } else if (kind === 'merge_duplicate') {
    const canonicalId = String(payload.canonicalId ?? '').trim()
    if (!canonicalId) {
      return { ok: false, error: '[INVALID_INPUT] canonicalId requerido' }
    }
    if (canonicalId === task.id) {
      return { ok: false, error: '[INVALID_INPUT] una task no puede mergear consigo misma' }
    }
    // Verificar que la canónica está en el mismo proyecto.
    const canonical = await prisma.task.findUnique({
      where: { id: canonicalId },
      select: { id: true, projectId: true },
    })
    if (!canonical || canonical.projectId !== task.projectId) {
      return { ok: false, error: '[NOT_FOUND] task canónica no existe en el mismo proyecto' }
    }
    updates.archivedAt = new Date()
    const note = `Marcada como duplicado de ${canonicalId} por IA`
    updates.description = `${task.description ?? ''}\n\n[IA] ${note}`
    historyEntries.push({
      field: 'archivedAt',
      oldValue: '',
      newValue: 'archived',
    })
    historyEntries.push({
      field: 'description',
      oldValue: task.description ?? '',
      newValue: String(updates.description),
    })
    applied.push('merge_duplicate')
  } else {
    actionError('UNSUPPORTED_KIND', `kind no soportado: ${kind as string}`)
  }

  // Mutar BD en transacción con auditoría.
  // Wave C-debt-1: cuando `kind='checklist'` con `mode='structured'` no hay
  // cambios en `Task` (los items viven en su propia tabla via
  // `applyAIChecklistSuggestion`), así que omitimos el update vacío.
  const hasTaskUpdates = Object.keys(updates).length > 0
  const tx = [
    ...(hasTaskUpdates
      ? [
          prisma.task.update({
            where: { id: task.id },
            data: updates,
            select: { id: true },
          }),
        ]
      : []),
    ...historyEntries.map((h) =>
      prisma.taskHistory.create({
        data: {
          taskId: task.id,
          field: h.field,
          oldValue: h.oldValue,
          newValue: h.newValue,
          userId: user?.id ?? null,
        },
      }),
    ),
    // Risks promovidos por la IA (kind='description'). Cada string se
    // convierte en una fila `Risk` con probabilidad/impacto neutros (3/3)
    // y `source: BRAIN_AI` para trazabilidad. El usuario puede luego
    // ajustar la matriz desde la sección de Riesgos del drawer.
    ...pendingRiskTitles.map((text) =>
      prisma.risk.create({
        data: {
          projectId: task.projectId,
          taskId: task.id,
          title: text.slice(0, 200),
          description: text.length > 200 ? text : null,
          probability: 3,
          impact: 3,
          status: 'OPEN',
          source: 'BRAIN_AI',
          ownerId: user?.id ?? null,
        },
        select: { id: true },
      }),
    ),
  ]
  if (tx.length > 0) {
    await prisma.$transaction(tx)
  }

  revalidatePath('/list')
  revalidatePath('/gantt')
  revalidatePath('/kanban')
  revalidatePath(`/tasks/${task.id}`)

  return { ok: true, taskId: task.id, applied }
}
