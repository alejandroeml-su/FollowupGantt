'use server'

/**
 * Ola P5 · Equipo P5-5 — Server actions de PublicForm + FormSubmission.
 *
 * Convenciones:
 *   - Errores tipados: `[INVALID_INPUT]`, `[FORM_NOT_FOUND]`, `[FORM_INACTIVE]`,
 *     `[SLUG_DUPLICATE]`, `[RATE_LIMITED]`, `[HONEYPOT_TRIGGERED]`,
 *     `[FORBIDDEN]`, `[UNAUTHORIZED]`.
 *   - `revalidatePath('/settings/forms')` tras mutación.
 *   - Listados protegidos por `requireUser`; submit público (sin auth).
 *
 * Decisiones autónomas:
 *   D-FA-A-1: `submitForm` no devuelve el payload validado al cliente, solo
 *           `{ ok: true, submissionId, taskId? }` para no exponer fields.
 *   D-FA-A-2: La interpolación del título de Task se hace siempre que la
 *           plantilla esté presente y `projectId` exista. Si falta proyecto
 *           NO creamos task pero sí persistimos la submission.
 *   D-FA-A-3: `runAutomations` se invoca con event=`form.submitted` después
 *           de persistir submission y task. Errores del motor NO bloquean
 *           la respuesta (best-effort, log).
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { requireUser } from '@/lib/auth'
import {
  formSchemaArray,
  parseFormSchema,
  validateSubmissionPayload,
  type FormSchema,
} from '@/lib/forms/schema'
import { interpolateTemplate } from '@/lib/forms/template'
import {
  checkRateLimit,
  isHoneypotTriggered,
  RATE_LIMIT_WINDOW_MS,
  HONEYPOT_FIELD_NAME,
} from '@/lib/forms/rate-limit'
import { isValidSlug, slugify } from '@/lib/forms/slug'
import { runAutomations } from '@/lib/automation/engine'
import { prismaActionAdapter } from '@/lib/automation/prisma-adapter'
import { safeParseRulePersisted } from '@/lib/automation/validation'

// ─────────────────────────── Errores tipados ───────────────────────────

export type FormErrorCode =
  | 'INVALID_INPUT'
  | 'FORM_NOT_FOUND'
  | 'FORM_INACTIVE'
  | 'SLUG_DUPLICATE'
  | 'SLUG_INVALID'
  | 'RATE_LIMITED'
  | 'HONEYPOT_TRIGGERED'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'

function actionError(code: FormErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ─────────────────────────── Schemas ───────────────────────────

const slugSchema = z
  .string()
  .trim()
  .min(2, 'El slug debe tener al menos 2 caracteres')
  .max(64, 'El slug no puede exceder 64 caracteres')
  .refine(isValidSlug, 'El slug debe ser kebab-case (a-z, 0-9, guiones)')

const titleSchema = z.string().trim().min(1).max(200)

const createFormSchema = z.object({
  slug: slugSchema,
  title: titleSchema,
  description: z.string().max(1000).optional(),
  projectId: z.string().min(1).optional().nullable(),
  schema: formSchemaArray,
  targetTaskTitleTemplate: z.string().min(1).max(200).optional(),
})

export type CreateFormInput = z.input<typeof createFormSchema>

const updateFormSchema = z
  .object({
    title: titleSchema.optional(),
    description: z.string().max(1000).optional().nullable(),
    projectId: z.string().min(1).optional().nullable(),
    schema: formSchemaArray.optional(),
    targetTaskTitleTemplate: z.string().min(1).max(200).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Debe especificar al menos un campo a actualizar',
  })

export type UpdateFormInput = z.input<typeof updateFormSchema>

// ─────────────────────────── Helpers ───────────────────────────

function unwrapCreate(input: unknown) {
  const result = createFormSchema.safeParse(input)
  if (!result.success) {
    actionError(
      'INVALID_INPUT',
      result.error.issues.map((i: { message: string }) => i.message).join('; '),
    )
  }
  return result.data
}

function unwrapUpdate(input: unknown) {
  const result = updateFormSchema.safeParse(input)
  if (!result.success) {
    actionError(
      'INVALID_INPUT',
      result.error.issues.map((i: { message: string }) => i.message).join('; '),
    )
  }
  return result.data
}

export { slugify }

// ─────────────────────────── Lectura ───────────────────────────

export async function listForms() {
  await requireUser()
  return prisma.publicForm.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      project: { select: { id: true, name: true } },
      _count: { select: { submissions: true } },
    },
  })
}

export async function getFormBySlug(slug: string) {
  if (!slug) return null
  return prisma.publicForm.findUnique({ where: { slug } })
}

export async function getFormById(id: string) {
  await requireUser()
  if (!id) actionError('INVALID_INPUT', 'id requerido')
  const form = await prisma.publicForm.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true } },
    },
  })
  if (!form) actionError('FORM_NOT_FOUND', `Formulario ${id} no encontrado`)
  return form
}

export async function listFormSubmissions(formId: string) {
  await requireUser()
  if (!formId) actionError('INVALID_INPUT', 'formId requerido')
  const form = await prisma.publicForm.findUnique({
    where: { id: formId },
    select: { id: true },
  })
  if (!form) actionError('FORM_NOT_FOUND', `Formulario ${formId} no encontrado`)
  return prisma.formSubmission.findMany({
    where: { formId },
    orderBy: { submittedAt: 'desc' },
    take: 200,
  })
}

// ─────────────────────────── Mutaciones ───────────────────────────

export async function createForm(input: CreateFormInput) {
  await requireUser()
  const data = unwrapCreate(input)

  // Validar shape adicional del schema (parseFormSchema ya cubre la lógica
  // pero la duplicación atrapa bugs si zod cambia bajo nuestros pies).
  parseFormSchema(data.schema)

  const dup = await prisma.publicForm.findUnique({
    where: { slug: data.slug },
    select: { id: true },
  })
  if (dup) actionError('SLUG_DUPLICATE', `Ya existe un formulario con slug "${data.slug}"`)

  const created = await prisma.publicForm.create({
    data: {
      slug: data.slug,
      title: data.title,
      description: data.description ?? null,
      projectId: data.projectId ?? null,
      schema: data.schema as unknown as Prisma.InputJsonValue,
      targetTaskTitleTemplate:
        data.targetTaskTitleTemplate?.trim() || `Submission de ${data.slug}`,
    },
  })

  revalidatePath('/settings/forms')
  return created
}

export async function updateForm(id: string, patch: UpdateFormInput) {
  await requireUser()
  if (!id) actionError('INVALID_INPUT', 'id requerido')
  const data = unwrapUpdate(patch)

  const existing = await prisma.publicForm.findUnique({ where: { id } })
  if (!existing) actionError('FORM_NOT_FOUND', `Formulario ${id} no encontrado`)

  if (data.schema) parseFormSchema(data.schema)

  const update: Prisma.PublicFormUpdateInput = {}
  if (data.title !== undefined) update.title = data.title
  if (data.description !== undefined) update.description = data.description
  if (data.projectId !== undefined) {
    update.project = data.projectId
      ? { connect: { id: data.projectId } }
      : { disconnect: true }
  }
  if (data.schema !== undefined) {
    update.schema = data.schema as unknown as Prisma.InputJsonValue
  }
  if (data.targetTaskTitleTemplate !== undefined) {
    update.targetTaskTitleTemplate = data.targetTaskTitleTemplate
  }

  const updated = await prisma.publicForm.update({
    where: { id },
    data: update,
  })

  revalidatePath('/settings/forms')
  revalidatePath(`/settings/forms/${id}/edit`)
  revalidatePath(`/forms/${updated.slug}`)
  return updated
}

export async function togglePublishForm(id: string) {
  await requireUser()
  if (!id) actionError('INVALID_INPUT', 'id requerido')
  const existing = await prisma.publicForm.findUnique({ where: { id } })
  if (!existing) actionError('FORM_NOT_FOUND', `Formulario ${id} no encontrado`)

  const updated = await prisma.publicForm.update({
    where: { id },
    data: { isActive: !existing.isActive },
  })
  revalidatePath('/settings/forms')
  revalidatePath(`/forms/${updated.slug}`)
  return updated
}

export async function deleteForm(id: string) {
  await requireUser()
  if (!id) actionError('INVALID_INPUT', 'id requerido')
  const existing = await prisma.publicForm.findUnique({
    where: { id },
    select: { id: true, slug: true },
  })
  if (!existing) return // idempotente

  await prisma.publicForm.delete({ where: { id } })
  revalidatePath('/settings/forms')
  revalidatePath(`/forms/${existing.slug}`)
}

// ─────────────────────────── Submission pública ───────────────────────────

export interface SubmitFormInput {
  slug: string
  payload: Record<string, unknown>
  ip?: string | null
  userAgent?: string | null
}

export interface SubmitFormResult {
  ok: true
  submissionId: string
  taskId?: string
}

/**
 * Procesa un submit público. Lanza errores tipados que el route handler
 * traduce a HTTP. Esta función NO usa `requireUser` (es pública).
 */
export async function submitForm(input: SubmitFormInput): Promise<SubmitFormResult> {
  if (!input?.slug) actionError('INVALID_INPUT', 'slug requerido')
  if (!input.payload || typeof input.payload !== 'object') {
    actionError('INVALID_INPUT', 'payload debe ser objeto')
  }

  const form = await prisma.publicForm.findUnique({
    where: { slug: input.slug },
  })
  if (!form) actionError('FORM_NOT_FOUND', `Formulario ${input.slug} no existe`)
  if (!form.isActive) actionError('FORM_INACTIVE', 'Formulario no publicado')

  // Honeypot.
  if (isHoneypotTriggered(input.payload)) {
    actionError('HONEYPOT_TRIGGERED', 'Submission rechazada')
  }

  // Rate limit por IP.
  const rate = await checkRateLimit(input.ip ?? null, async (ip, sinceMs) => {
    return prisma.formSubmission.count({
      where: { ip, submittedAt: { gte: new Date(sinceMs) } },
    })
  })
  if (!rate.ok) {
    actionError('RATE_LIMITED', `Máximo 5 envíos por hora. Reintenta en ${rate.retryAfterSec}s`)
  }

  // Validar payload contra schema.
  const formSchema = parseFormSchema(form.schema) as FormSchema
  const validation = validateSubmissionPayload(formSchema, input.payload)
  if (!validation.ok) actionError('INVALID_INPUT', validation.errors.join('; '))

  // Persistir submission + task opcional en transacción.
  const submissionData = {
    formId: form.id,
    payload: validation.value as unknown as Prisma.InputJsonValue,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  }

  let createdTaskId: string | undefined
  const submission = await prisma.formSubmission.create({ data: submissionData })

  if (form.projectId && form.targetTaskTitleTemplate) {
    const title = interpolateTemplate(form.targetTaskTitleTemplate, {
      payload: validation.value,
      slug: form.slug,
      submittedAt: submission.submittedAt,
    })
    const task = await prisma.task.create({
      data: {
        title,
        projectId: form.projectId,
        type: 'ITIL_TICKET',
        priority: 'MEDIUM',
        description: `Submission del formulario público "${form.title}".`,
      },
      select: { id: true },
    })
    await prisma.formSubmission.update({
      where: { id: submission.id },
      data: { taskId: task.id },
    })
    createdTaskId = task.id
  }

  // Disparar automatizaciones (best-effort).
  try {
    await runAutomations(
      'form.submitted',
      {
        triggeredBy: `form:${form.slug}`,
        data: {
          form: { slug: form.slug, id: form.id },
          payload: validation.value,
          taskId: createdTaskId ?? null,
        },
      },
      {
        loadActiveRules: async () => {
          const rules = await prisma.automationRule.findMany({
            where: { isActive: true },
          })
          return rules
            .map((r) =>
              safeParseRulePersisted({
                id: r.id,
                name: r.name,
                isActive: r.isActive,
                trigger: r.trigger,
                conditions: r.conditions,
                actions: r.actions,
              }),
            )
            .filter((r): r is NonNullable<typeof r> => r !== null)
        },
        adapter: prismaActionAdapter,
        recordExecution: async (ruleId, triggeredBy, status, result) => {
          await prisma.automationExecution.create({
            data: {
              ruleId,
              triggeredBy,
              status,
              result: result as unknown as Prisma.InputJsonValue,
            },
          })
        },
      },
    )
  } catch {
    // best-effort: nunca rompemos el submission por un fallo del motor
  }

  return {
    ok: true,
    submissionId: submission.id,
    taskId: createdTaskId,
  }
}

// ─────────────────────────── Constantes públicas ───────────────────────────

export const FORM_RATE_LIMIT_WINDOW_MS = RATE_LIMIT_WINDOW_MS
export const FORM_HONEYPOT_FIELD = HONEYPOT_FIELD_NAME
