'use server'

/**
 * R4 · US-7.4 · Email ClickApp — Server action `processInboundEmail`.
 *
 * Orquesta el lado server-side de un email recibido por SendGrid:
 *   1. Resuelve el `Project` por `inboundEmailAlias` (extraído del slug
 *      después del `+` del local-part).
 *   2. Aplica gating SPAM (`spamScore > 5` ⇒ persist FAILED y return).
 *   3. Resuelve el remitente:
 *      - Si `User.email` matchea ⇒ usa userId como autor.
 *      - Si no, persiste como "guest commenter" (solo name + email
 *        visibles en el body/audit; NO creamos User real).
 *   4. Decide ruta:
 *      a. Si `mnemonic` extraído ⇒ busca Task; agrega Comment.
 *      b. Si no ⇒ crea Task nueva (type=AGILE_STORY default, status=TODO).
 *   5. Sube attachments al bucket `attachments` y crea filas
 *      `Attachment` linkeadas a la task.
 *   6. Persiste el row `InboundEmail` con `status=PROCESSED` y los IDs
 *      generados; si algo lanzó, queda `FAILED` con `errorMsg`.
 *
 * Errores tipados (`[CODE] msg`) — el webhook handler los captura y
 * los persiste en la fila InboundEmail sin re-lanzar (200 a SendGrid
 * siempre, para evitar redelivery loops).
 */

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'
import { uploadAttachment } from '@/lib/storage/supabase-storage'
import type { ParsedInboundEmail } from '@/lib/email/inbound-parser'

const SPAM_THRESHOLD = 5
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024 // 25 MB SendGrid cap

export type InboundEmailProcessErrorCode =
  | 'INVALID_INPUT'
  | 'PROJECT_NOT_FOUND'
  | 'TASK_NOT_FOUND'
  | 'SPAM_REJECTED'
  | 'ATTACHMENT_TOO_LARGE'
  | 'PERSIST_FAILED'

function actionError(code: InboundEmailProcessErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

export type ProcessResult = {
  inboundEmailId: string
  status: 'PROCESSED' | 'FAILED'
  taskId: string | null
  commentId: string | null
  errorCode: InboundEmailProcessErrorCode | null
}

/**
 * Variante "all-in-one" para uso del webhook: hace try/catch dentro y
 * persiste el resultado en `InboundEmail`. Siempre devuelve un
 * `ProcessResult` (nunca throws hacia el caller del API route).
 */
export async function processInboundEmail(
  parsed: ParsedInboundEmail,
): Promise<ProcessResult> {
  // Pre-validación mínima — sin esto ni siquiera podemos persistir el row.
  if (!parsed.toAlias || !parsed.from.email) {
    return {
      inboundEmailId: '',
      status: 'FAILED',
      taskId: null,
      commentId: null,
      errorCode: 'INVALID_INPUT',
    }
  }

  // Localiza el proyecto por alias completo (más estricto que sólo slug).
  // Nota: `inboundEmailAlias` es @unique; si null devuelve undefined.
  const project = await prisma.project.findUnique({
    where: { inboundEmailAlias: parsed.toAlias.toLowerCase() },
    select: { id: true, name: true, workspaceId: true },
  })

  if (!project) {
    // Sin proyecto, no podemos crear `InboundEmail` (FK obligatorio). Sólo
    // emitimos un audit best-effort para visibilidad en /audit-log.
    await recordAuditEventSafe({
      action: 'access.denied',
      entityType: 'inbound_email',
      metadata: {
        reason: 'PROJECT_NOT_FOUND',
        toAlias: parsed.toAlias,
        fromEmail: parsed.from.email,
        subject: parsed.subject,
      },
    })
    return {
      inboundEmailId: '',
      status: 'FAILED',
      taskId: null,
      commentId: null,
      errorCode: 'PROJECT_NOT_FOUND',
    }
  }

  // Crea SIEMPRE el row InboundEmail primero, en estado PENDING, para
  // tener trazabilidad incluso si lo subsecuente falla. Si algo lanza,
  // lo transicionamos a FAILED en el catch.
  const inboundRow = await prisma.inboundEmail.create({
    data: {
      projectId: project.id,
      fromEmail: parsed.from.email,
      fromName: parsed.from.name ?? null,
      subject: parsed.subject.slice(0, 500),
      bodyText: parsed.bodyText.slice(0, 100000), // hard cap 100KB plain text
      bodyHtml: parsed.bodyHtml,
      spamScore: parsed.spamScore,
      headers: parsed.rawHeaders ? { raw: parsed.rawHeaders } : undefined,
      status: 'PENDING',
    },
    select: { id: true },
  })

  // Spam gate.
  if (parsed.spamScore !== null && parsed.spamScore > SPAM_THRESHOLD) {
    await prisma.inboundEmail.update({
      where: { id: inboundRow.id },
      data: {
        status: 'FAILED',
        errorMsg: `SPAM_REJECTED: score=${parsed.spamScore}`,
        processedAt: new Date(),
      },
    })
    return {
      inboundEmailId: inboundRow.id,
      status: 'FAILED',
      taskId: null,
      commentId: null,
      errorCode: 'SPAM_REJECTED',
    }
  }

  try {
    const result = await dispatchInboundEmail({ parsed, project })
    await prisma.inboundEmail.update({
      where: { id: inboundRow.id },
      data: {
        status: 'PROCESSED',
        processedAt: new Date(),
        taskId: result.taskId,
        commentId: result.commentId,
      },
    })

    // Revalida las rutas que el usuario verá después.
    revalidatePath('/list')
    revalidatePath('/kanban')
    revalidatePath('/gantt')

    await recordAuditEventSafe({
      action: result.commentId ? 'task.updated' : 'task.created',
      entityType: 'task',
      entityId: result.taskId,
      metadata: {
        source: 'inbound_email',
        inboundEmailId: inboundRow.id,
        fromEmail: parsed.from.email,
        projectId: project.id,
      },
    })

    return {
      inboundEmailId: inboundRow.id,
      status: 'PROCESSED',
      taskId: result.taskId,
      commentId: result.commentId,
      errorCode: null,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'UNKNOWN_ERROR'
    const codeMatch = msg.match(/^\[([A-Z_]+)\]/)
    const code = (codeMatch?.[1] as InboundEmailProcessErrorCode | undefined) ?? 'PERSIST_FAILED'

    await prisma.inboundEmail.update({
      where: { id: inboundRow.id },
      data: {
        status: 'FAILED',
        errorMsg: msg.slice(0, 1000),
        processedAt: new Date(),
      },
    })

    return {
      inboundEmailId: inboundRow.id,
      status: 'FAILED',
      taskId: null,
      commentId: null,
      errorCode: code,
    }
  }
}

// ───────────────────────── Internals ─────────────────────────

type DispatchInput = {
  parsed: ParsedInboundEmail
  project: { id: string; name: string; workspaceId: string | null }
}

type DispatchResult = {
  taskId: string
  commentId: string | null
}

async function dispatchInboundEmail({
  parsed,
  project,
}: DispatchInput): Promise<DispatchResult> {
  // Matchear remitente con un User existente (case-insensitive).
  const matchedUser = await prisma.user.findUnique({
    where: { email: parsed.from.email },
    select: { id: true, name: true },
  })
  const guestPrefix = matchedUser
    ? ''
    : `(De: ${parsed.from.name ?? parsed.from.email} <${parsed.from.email}>)\n\n`

  // Branch A — comentario sobre task existente.
  if (parsed.mnemonic) {
    const task = await prisma.task.findFirst({
      where: { mnemonic: parsed.mnemonic, projectId: project.id },
      select: { id: true },
    })
    if (!task) {
      actionError(
        'TASK_NOT_FOUND',
        `No existe task con mnemonic ${parsed.mnemonic} en proyecto ${project.id}`,
      )
    }

    const comment = await prisma.comment.create({
      data: {
        taskId: task.id,
        authorId: matchedUser?.id ?? null,
        content: `${guestPrefix}${parsed.bodyText}`.slice(0, 50000),
        isInternal: false,
      },
      select: { id: true },
    })

    await persistAttachments({
      taskId: task.id,
      uploaderUserId: matchedUser?.id ?? null,
      attachments: parsed.attachments,
    })

    return { taskId: task.id, commentId: comment.id }
  }

  // Branch B — crear task nueva.
  const taskTitle = parsed.cleanSubject.slice(0, 200) || '(Email sin asunto)'
  const description = `${guestPrefix}${parsed.bodyText}`.slice(0, 50000)

  // Genera mnemónico (mismo algoritmo que createTask legacy en actions.ts).
  const prefix =
    project.name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .substring(0, 4)
      .toUpperCase() || 'TASK'
  const count = await prisma.task.count({ where: { projectId: project.id } })
  const mnemonic = `${prefix}-${count + 1}`

  const created = await prisma.task.create({
    data: {
      title: taskTitle,
      description,
      mnemonic,
      projectId: project.id,
      type: 'AGILE_STORY',
      status: 'TODO',
      priority: 'MEDIUM',
      assigneeId: matchedUser?.id ?? null,
      tags: ['email-inbound'],
    },
    select: { id: true },
  })

  await persistAttachments({
    taskId: created.id,
    uploaderUserId: matchedUser?.id ?? null,
    attachments: parsed.attachments,
  })

  return { taskId: created.id, commentId: null }
}

async function persistAttachments(params: {
  taskId: string
  uploaderUserId: string | null
  attachments: File[]
}): Promise<void> {
  const { taskId, uploaderUserId, attachments } = params
  if (!attachments.length) return

  for (const file of attachments) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      // Continúa con los demás — no abortar todo el procesamiento por uno
      // grande. Lo registramos como descartado vía console; no creamos
      // Attachment row para no inducir confusión en la UI.
      console.warn(
        `[inbound-email] Attachment ${file.name} excede 25MB, ignorado`,
      )
      continue
    }

    // Path en el bucket: `inbound/<taskId>/<uuid>-<filename>`. Reusa el
    // bucket `attachments` que ya tiene RLS configurada (Wave P8-4).
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)
    const path = `inbound/${taskId}/${crypto.randomUUID()}-${safeName}`

    try {
      const buf = Buffer.from(await file.arrayBuffer())
      await uploadAttachment(buf, path, file.type || 'application/octet-stream')

      await prisma.attachment.create({
        data: {
          taskId,
          filename: file.name.slice(0, 200),
          storagePath: path,
          mimeType: file.type || null,
          mimetype: file.type || null, // duplicar en columna legacy
          sizeBytes: file.size,
          size: file.size, // duplicar en columna legacy
          uploadedById: uploaderUserId,
          userId: uploaderUserId,
        },
      })
    } catch (err) {
      // No abortamos la transacción de la task por un attachment fallido.
      // Lo logueamos para investigación posterior.
      console.error(
        `[inbound-email] Falló subida de attachment ${file.name}`,
        err,
      )
    }
  }
}
