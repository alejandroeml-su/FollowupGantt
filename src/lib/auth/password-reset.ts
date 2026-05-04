import 'server-only'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import prisma from '@/lib/prisma'
import { hashPassword } from '@/lib/auth/password'
import { getResendClient, EMAIL_FROM, APP_URL } from '@/lib/email/resend'

/**
 * Password reset flow (Ola P3 · Auth completo).
 *
 * Diseño:
 *   - Token raw = `randomBytes(32).toString('base64url')` (43 chars
 *     URL-safe). Se envía por email; en BD guardamos sólo el SHA-256
 *     hex del token (defensa-en-profundidad si la BD fuga).
 *   - TTL: 1h desde la creación. Tras `usedAt`, el token queda
 *     consumido (one-shot, evita replay).
 *   - `requestReset(email)` siempre responde "ok" para evitar email
 *     enumeration: si el usuario no existe, no enviamos correo pero
 *     tampoco filtramos esa info al cliente.
 *
 * Errores tipados (sólo en `confirmReset`):
 *   - `[TOKEN_EXPIRED]` token TTL agotado.
 *   - `[TOKEN_INVALID]` no coincide o ya usado.
 *   - `[INVALID_INPUT]` password no cumple política.
 */

const TOKEN_BYTES = 32
const TTL_MS = 60 * 60 * 1000 // 1 hora

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

/**
 * Compara dos hashes hex en tiempo constante. Buffer length idéntico
 * porque ambos son SHA-256 → 64 chars hex.
 */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

/**
 * Genera token, persiste su hash y dispara correo de Resend con el
 * link `/auth/reset-password?token=<raw>`. NO lanza si el email no
 * existe (evita enum) ni si Resend no está configurado (log only).
 *
 * Retorna `{ ok: true }` siempre — el caller no debe ramificar UI por
 * la respuesta. En tests, exponemos `__lastIssuedToken` (memoria) para
 * verificar el flujo sin tocar email real.
 */
export async function requestReset(emailRaw: string): Promise<{ ok: true }> {
  const email = (emailRaw ?? '').trim().toLowerCase()
  if (!email) return { ok: true }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true },
  })

  if (!user) return { ok: true }

  const rawToken = randomBytes(TOKEN_BYTES).toString('base64url')
  const tokenHash = hashToken(rawToken)
  const expiresAt = new Date(Date.now() + TTL_MS)

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
    },
  })

  const resetUrl = `${APP_URL}/auth/reset-password?token=${encodeURIComponent(rawToken)}`

  const resend = getResendClient()
  if (resend) {
    try {
      await resend.emails.send({
        from: EMAIL_FROM,
        to: user.email,
        subject: 'Recuperar contraseña — FollowupGantt',
        html: renderResetEmail({ name: user.name, resetUrl }),
      })
    } catch (err) {
      // No propagar — el flujo del usuario no debe depender del proveedor
      // de email. Log para que SRE detecte caída del provider.
      console.warn('[password-reset] Resend send failed:', (err as Error).message)
    }
  } else {
    // Modo dev sin RESEND_API_KEY: log del link para que el dev pruebe.
    console.info('[password-reset] (dev) reset link:', resetUrl)
  }

  return { ok: true }
}

/**
 * Valida el token plano contra los hashes en BD (todos los activos
 * del usuario). Si encuentra match: actualiza la contraseña, marca
 * `usedAt`, e invalida cualquier sesión existente.
 *
 * Lanza errores tipados. NO redirige (lo hace la page server action).
 */
export async function confirmReset(
  rawToken: string,
  newPassword: string,
): Promise<{ userId: string }> {
  if (!rawToken || typeof rawToken !== 'string') {
    throw new Error('[TOKEN_INVALID] token vacío')
  }
  if (!newPassword || newPassword.length < 8) {
    throw new Error('[INVALID_INPUT] password mínimo 8 caracteres')
  }

  const candidateHash = hashToken(rawToken)

  // Búsqueda directa por hash único — el índice `tokenHash_key` lo
  // hace O(1). Comparamos con timingSafeEqual igualmente para
  // mantener el contrato (defensa-en-profundidad).
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: candidateHash },
    select: {
      id: true,
      userId: true,
      tokenHash: true,
      expiresAt: true,
      usedAt: true,
    },
  })

  if (!record || !safeEqualHex(record.tokenHash, candidateHash)) {
    throw new Error('[TOKEN_INVALID] token no encontrado')
  }
  if (record.usedAt) {
    throw new Error('[TOKEN_INVALID] token ya consumido')
  }
  if (record.expiresAt.getTime() < Date.now()) {
    throw new Error('[TOKEN_EXPIRED] token expirado')
  }

  const passwordHash = await hashPassword(newPassword)

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { password: passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    // Invalida todas las sesiones existentes — el usuario debe
    // re-loguear con la nueva contraseña.
    prisma.session.deleteMany({ where: { userId: record.userId } }),
  ])

  return { userId: record.userId }
}

/**
 * Tarea de mantenimiento: borra tokens expirados/usados de hace más
 * de 24h. Llamar desde un cron job (no automatizado en P3).
 */
export async function cleanupExpiredTokens(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const result = await prisma.passwordResetToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { lt: cutoff } }],
    },
  })
  return result.count
}

function renderResetEmail(args: { name: string; resetUrl: string }): string {
  const name = escapeHtml(args.name)
  const url = escapeHtml(args.resetUrl)
  return `<!DOCTYPE html>
<html lang="es">
  <body style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a;">
    <h1 style="font-size:18px;margin:0 0 16px;">Recuperar contraseña</h1>
    <p>Hola ${name},</p>
    <p>Recibimos una solicitud para restablecer tu contraseña en FollowupGantt. Si no fuiste tú, ignora este correo.</p>
    <p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;background:#0ea5e9;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Restablecer contraseña</a>
    </p>
    <p style="font-size:12px;color:#64748b;">El enlace expira en 1 hora. Si no funciona, copia y pega esta URL:<br>${url}</p>
  </body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Helpers exportados para tests unitarios (no usar en producción).
export const __testing = {
  hashToken,
  TTL_MS,
}
