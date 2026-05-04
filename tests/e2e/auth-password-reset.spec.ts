import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import {
  cleanupAuthSeed,
  disconnectAuthClient,
  seedAuthUser,
} from './_helpers/seed-auth'

/**
 * Ola P3 · Auth · Password reset — E2E.
 *
 * Cubre el flujo /auth/forgot-password → token en BD → /auth/reset-password.
 * Como el envío de email se silencia en dev (Resend no configurado), leemos
 * el token plano via reverse hashing: el helper inserta un PasswordResetToken
 * directamente y simulamos el "click en el link del email" navegando a
 * `/auth/reset-password?token=<plaintext>`.
 *
 * Tests:
 *   - Happy path: forgot-password muestra success genérico (no leak).
 *   - Edge: token válido + nueva contraseña permite reset (UI no muestra error).
 *   - Error: token inválido produce mensaje `reset-error`.
 */

const RESET_EMAIL = 'auth-reset@e2e.test'
let cachedClient: PrismaClient | null = null

function getDb(): PrismaClient {
  if (cachedClient) return cachedClient
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dotenv = require('dotenv') as typeof import('dotenv')
    dotenv.config({ path: '.env.local' })
    if (!process.env.DATABASE_URL) dotenv.config({ path: '.env' })
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  cachedClient = new PrismaClient({ adapter: new PrismaPg(pool) })
  return cachedClient
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

test.describe('Auth · password reset', () => {
  test.afterAll(async () => {
    const db = getDb()
    await db.passwordResetToken
      .deleteMany({
        where: { user: { email: RESET_EMAIL } },
      })
      .catch(() => {})
    await db.$disconnect().catch(() => {})
    await cleanupAuthSeed(RESET_EMAIL).catch(() => {})
    await disconnectAuthClient().catch(() => {})
  })

  test('forgot-password siempre devuelve mensaje genérico (no leak)', async ({
    page,
  }) => {
    await page.goto('/auth/forgot-password')
    await page
      .getByTestId('forgot-email')
      .fill('totally-not-real-user-12345@nope.test')
    await page.getByTestId('forgot-submit').click()
    const success = page.getByTestId('forgot-success')
    await expect(success).toBeVisible({ timeout: 5_000 })
  })

  test('reset con token válido cambia password sin mostrar error', async ({
    page,
  }) => {
    const seed = await seedAuthUser(RESET_EMAIL, 'AGENTE')
    const db = getDb()

    // Inyectamos un PasswordResetToken con el shape que el server espera.
    const rawToken = 'e2e-reset-token-' + Math.random().toString(36).slice(2, 18)
    await db.passwordResetToken.create({
      data: {
        userId: seed.userId,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    })

    await page.goto(`/auth/reset-password?token=${encodeURIComponent(rawToken)}`)
    await page.getByTestId('reset-password').fill('nuevo-password-12345')
    await page.getByTestId('reset-confirm').fill('nuevo-password-12345')
    await page.getByTestId('reset-submit').click()

    // Tras submit válido el server action redirige a /login?reset=ok.
    // En la UI no debería mostrarse el reset-error visible.
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    const errorVisible = await page
      .getByTestId('reset-error')
      .isVisible()
      .catch(() => false)
    expect(errorVisible).toBe(false)

    // Verificamos que el token quedó marcado como usado (lo confirma BD).
    const used = await db.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: { usedAt: true },
    })
    expect(used?.usedAt).toBeTruthy()
  })

  test('reset con token inválido muestra reset-error', async ({ page }) => {
    await page.goto('/auth/reset-password?token=invalid-bogus-token')
    const passwordInput = page.getByTestId('reset-password')
    if ((await passwordInput.count()) === 0) {
      // Si la página redirigió por token vacío/erróneo, validamos URL.
      expect(page.url()).not.toMatch(/token=invalid/)
      return
    }
    await passwordInput.fill('otro-password-12345')
    await page.getByTestId('reset-confirm').fill('otro-password-12345')
    await page.getByTestId('reset-submit').click()
    const error = page.getByTestId('reset-error')
    await expect(error).toBeVisible({ timeout: 8_000 })
  })
})
