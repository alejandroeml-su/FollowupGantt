import { getResendClient, EMAIL_FROM, APP_URL } from './resend'

export type MentionEmailPayload = {
  to: string
  recipientName: string
  authorName: string
  taskTitle: string
  taskMnemonic?: string | null
  commentContent: string
  taskId: string
  parentTaskTitle?: string | null
  isInternal?: boolean
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildSubject(payload: MentionEmailPayload): string {
  const label = payload.parentTaskTitle ? 'subtarea' : 'tarea'
  const prefix = payload.taskMnemonic ? `[${payload.taskMnemonic}] ` : ''
  return `${payload.authorName} te mencionó en la ${label} ${prefix}${payload.taskTitle}`
}

function buildHtml(payload: MentionEmailPayload): string {
  const taskUrl = `${APP_URL}/list?taskId=${encodeURIComponent(payload.taskId)}`
  const safeAuthor = escapeHtml(payload.authorName)
  const safeRecipient = escapeHtml(payload.recipientName)
  const safeTitle = escapeHtml(payload.taskTitle)
  const safeComment = escapeHtml(payload.commentContent).replace(/\n/g, '<br>')
  const entityLabel = payload.parentTaskTitle ? 'subtarea' : 'tarea'
  const mnemonic = payload.taskMnemonic ? `${escapeHtml(payload.taskMnemonic)} · ` : ''
  const parentBlock = payload.parentTaskTitle
    ? `<p style="margin:0 0 8px;color:#6b7280;font-size:13px;">En la tarea principal: <strong>${escapeHtml(payload.parentTaskTitle)}</strong></p>`
    : ''
  const internalBadge = payload.isInternal
    ? '<span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:11px;padding:2px 8px;border-radius:10px;margin-left:8px;">Seguimiento interno</span>'
    : ''

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Mención en FollowupGantt</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <tr><td style="padding:24px 28px;background:#4f46e5;color:#ffffff;">
          <h1 style="margin:0;font-size:18px;font-weight:600;">FollowupGantt · Unidad de Transformación Digital</h1>
        </td></tr>
        <tr><td style="padding:28px;">
          <p style="margin:0 0 16px;font-size:15px;">Hola <strong>${safeRecipient}</strong>,</p>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
            <strong>${safeAuthor}</strong> te mencionó en un comentario de la ${entityLabel}:
          </p>
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px 18px;margin-bottom:20px;background:#f9fafb;">
            ${parentBlock}
            <h2 style="margin:0 0 12px;font-size:16px;color:#111827;">${mnemonic}${safeTitle}${internalBadge}</h2>
            <blockquote style="margin:0;padding:12px 14px;border-left:3px solid #4f46e5;background:#ffffff;color:#374151;font-size:14px;line-height:1.55;border-radius:0 4px 4px 0;">
              ${safeComment}
            </blockquote>
          </div>
          <p style="margin:0 0 24px;text-align:center;">
            <a href="${taskUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:500;">Abrir en FollowupGantt</a>
          </p>
          <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.5;">
            Recibiste este correo porque fuiste mencionado con @ en un comentario. Si no esperabas esta notificación, puedes ignorar este mensaje.
          </p>
        </td></tr>
        <tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;">
          FollowupGantt · Inversiones Avante · Este es un correo automático, no respondas a esta dirección.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function buildText(payload: MentionEmailPayload): string {
  const taskUrl = `${APP_URL}/list?taskId=${encodeURIComponent(payload.taskId)}`
  const entityLabel = payload.parentTaskTitle ? 'subtarea' : 'tarea'
  const mnemonic = payload.taskMnemonic ? `[${payload.taskMnemonic}] ` : ''
  const parentLine = payload.parentTaskTitle ? `Tarea principal: ${payload.parentTaskTitle}\n` : ''
  return `Hola ${payload.recipientName},

${payload.authorName} te mencionó en un comentario de la ${entityLabel}:
${parentLine}${mnemonic}${payload.taskTitle}

"${payload.commentContent}"

Abrir en FollowupGantt: ${taskUrl}

—
FollowupGantt · Inversiones Avante
Este es un correo automático, no respondas a esta dirección.`
}

export async function sendMentionNotification(payload: MentionEmailPayload): Promise<{ sent: boolean; reason?: string }> {
  const resend = getResendClient()
  if (!resend) return { sent: false, reason: 'RESEND_API_KEY_MISSING' }

  try {
    const result = await resend.emails.send({
      from: EMAIL_FROM,
      to: payload.to,
      subject: buildSubject(payload),
      html: buildHtml(payload),
      text: buildText(payload),
      tags: [
        { name: 'type', value: 'mention' },
        { name: 'entity', value: payload.parentTaskTitle ? 'subtask' : 'task' },
      ],
    })
    if (result.error) {
      console.error('[email] Resend rechazó el envío', { to: payload.to, error: result.error })
      return { sent: false, reason: result.error.message }
    }
    return { sent: true }
  } catch (err) {
    console.error('[email] Fallo al enviar mención', { to: payload.to, err })
    return { sent: false, reason: err instanceof Error ? err.message : 'UNKNOWN' }
  }
}
