'use server'

import { z } from 'zod'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import prisma from '@/lib/prisma'
import { verifyPassword, hashPassword } from '@/lib/auth/password'
import { createSession, destroySession } from '@/lib/auth/session'
import {
  buildKey,
  recordAttempt,
  reset as resetRateLimit,
  assertNotLimited,
} from '@/lib/auth/rate-limiter'

/**
 * Server actions de autenticación (Ola P1 · MVP).
 *
 * Convención de errores:
 *   - `[INVALID_CREDENTIALS]` para login fallido (no diferenciamos email
 *     vs password — ataque enum). Vista mapea a "Credenciales inválidas".
 *   - `[INVALID_INPUT]` para errores de zod (campos vacíos, email mal).
 *
 * Para la fase MVP se expone también `bootstrapAdmin` que crea/actualiza
 * el primer SUPER_ADMIN. Útil para que Edwin pueda iniciar sesión en
 * staging antes de cablear un seeder dedicado. NO se expone en UI.
 */

const loginSchema = z.object({
  email: z.string().email('Email inválido').trim().toLowerCase(),
  password: z.string().min(1, 'Contraseña requerida'),
})

export type LoginActionState =
  | {
      ok: true
    }
  | {
      ok: false
      error: string
    }
  | undefined

/**
 * Action para `useActionState` del login form.
 * Retorna estado en lugar de lanzar para integrarse con `useActionState`.
 * Si las credenciales son válidas, redirige a `/` (NEXT_REDIRECT propaga).
 */
export async function loginAction(
  _prev: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Datos inválidos',
    }
  }

  const { email, password } = parsed.data

  // Rate limiting (P3): max 5 intentos / 15 min por (email, ip).
  const h = await headers()
  const ip =
    (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? '')
      .split(',')[0]
      ?.trim() || 'unknown'
  const rateKey = buildKey(email, ip)

  try {
    assertNotLimited(rateKey)
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('[RATE_LIMITED]')) {
      return {
        ok: false,
        error: 'Demasiados intentos. Intenta más tarde.',
      }
    }
    throw err
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, password: true },
  })

  // Mensaje genérico para evitar enum de emails registrados.
  if (!user || !user.password) {
    recordAttempt(rateKey)
    return {
      ok: false,
      error: 'Credenciales inválidas',
    }
  }

  const ok = await verifyPassword(password, user.password)
  if (!ok) {
    recordAttempt(rateKey)
    return {
      ok: false,
      error: 'Credenciales inválidas',
    }
  }

  resetRateLimit(rateKey)
  await createSession(user.id)
  redirect('/')
}

/**
 * Cierra la sesión del usuario actual y redirige al login.
 * Usable directamente como `<form action={logoutAction}>`.
 */
export async function logoutAction(): Promise<void> {
  await destroySession()
  redirect('/login')
}

// ──────────────────────── Bootstrap ────────────────────────────
//
// `bootstrapAdmin` es un escape-hatch para que un operador (Edwin) pueda
// crear o actualizar el primer SUPER_ADMIN sin necesitar UI ni seeder
// dedicado. Solo se ejecuta si se invoca explícitamente (no se expone
// en ningún form de la UI). Idempotente: si el usuario existe, actualiza
// la contraseña y le asegura el rol SUPER_ADMIN.
//
// Uso pretendido (server-side, p. ej. desde un script puntual):
//   await bootstrapAdmin({ email: 'edwin@avante', password: '...', name: 'Edwin' })

const bootstrapSchema = z.object({
  email: z.string().email().trim().toLowerCase(),
  password: z.string().min(8),
  name: z.string().min(1).default('Admin'),
})

export async function bootstrapAdmin(input: {
  email: string
  password: string
  name?: string
}): Promise<{ id: string }> {
  const parsed = bootstrapSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(
      `[INVALID_INPUT] ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    )
  }
  const { email, password, name } = parsed.data
  const passwordHash = await hashPassword(password)

  // Asegura el rol SUPER_ADMIN.
  const role = await prisma.role.upsert({
    where: { name: 'SUPER_ADMIN' },
    update: {},
    create: { name: 'SUPER_ADMIN', description: 'Acceso total' },
    select: { id: true },
  })

  const user = await prisma.user.upsert({
    where: { email },
    update: { password: passwordHash, name },
    create: { email, password: passwordHash, name },
    select: { id: true },
  })

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  })

  return { id: user.id }
}
