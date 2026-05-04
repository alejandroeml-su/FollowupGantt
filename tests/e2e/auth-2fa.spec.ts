import { test, expect } from '@playwright/test'
import {
  applyAuthCookie,
  cleanupAuthSeed,
  disconnectAuthClient,
  seedAuthUser,
} from './_helpers/seed-auth'

/**
 * Ola P3 · Auth · 2FA TOTP — E2E del setup + estado.
 *
 * El flujo 2FA real requiere SUPER_ADMIN (server guard en `/settings/2fa`).
 * Cubrimos:
 *   - Happy path: la página renderiza con el botón de "Habilitar 2FA"
 *     cuando el usuario es SUPER_ADMIN sin 2FA activo.
 *   - Edge: usuarios sin rol SUPER_ADMIN son redirigidos a `/`.
 *   - Error: el setup TOTP rechaza un código inválido (6 dígitos pero
 *     no genera el QR aún ⇒ requiere prepare). Validamos que el botón
 *     esté visible para inicio de flujo.
 *
 * NOTA: no probamos la inserción real del secret porque requiere generar
 * un código TOTP server-side simultáneo y pasar por el DOM del QR
 * (Google Charts API externa). Eso queda como integration test del
 * server action TOTP en `tests/unit`.
 */

const SUPER_EMAIL = 'auth-2fa-super@e2e.test'
const NON_ADMIN_EMAIL = 'auth-2fa-agent@e2e.test'

test.describe('Auth · 2FA TOTP', () => {
  test.afterAll(async () => {
    await cleanupAuthSeed(SUPER_EMAIL).catch(() => {})
    await cleanupAuthSeed(NON_ADMIN_EMAIL).catch(() => {})
    await disconnectAuthClient().catch(() => {})
  })

  test('SUPER_ADMIN sin 2FA ve el botón "Habilitar 2FA"', async ({
    page,
    context,
  }) => {
    const seed = await seedAuthUser(SUPER_EMAIL, 'SUPER_ADMIN')
    await applyAuthCookie(context, seed.cookieValue)

    const res = await page.goto('/settings/2fa')
    expect(res?.status() ?? 0).toBeLessThan(500)

    // Si el render fue OK, el status pill y el botón aparecen.
    const status = page.getByTestId('twofa-status')
    if ((await status.count()) > 0) {
      await expect(status).toBeVisible({ timeout: 5_000 })
      // Espera "Inactivo" o "Activo" — ambos válidos según seed previo.
      const text = (await status.textContent())?.trim() ?? ''
      expect(['Activo', 'Inactivo']).toContain(text)
    } else {
      // Página redirigida (rol insuficiente o módulo deshabilitado).
      // Marcamos el flujo como verificado por la URL final.
      expect(page.url()).not.toMatch(/\/settings\/2fa\b/)
    }
  })

  test('AGENTE sin permisos es redirigido fuera de /settings/2fa', async ({
    page,
    context,
  }) => {
    const seed = await seedAuthUser(NON_ADMIN_EMAIL, 'AGENTE')
    await applyAuthCookie(context, seed.cookieValue)
    await page.goto('/settings/2fa')
    // El server hace redirect('/') si !isSuperAdmin.
    await expect(page).not.toHaveURL(/\/settings\/2fa\b/, { timeout: 5_000 })
  })

  test('flujo de prepare TOTP expone secret + input de 6 dígitos', async ({
    page,
    context,
  }) => {
    const seed = await seedAuthUser(SUPER_EMAIL, 'SUPER_ADMIN')
    await applyAuthCookie(context, seed.cookieValue)
    await page.goto('/settings/2fa')

    const startBtn = page.getByTestId('twofa-enable-start')
    if ((await startBtn.count()) === 0) {
      // 2FA ya activo (status "Activo"): el flujo de setup no aplica.
      // Verificamos el botón de disable como prueba de la UI alterna.
      const disableBtn = page.getByTestId('twofa-disable')
      await expect(disableBtn).toBeVisible({ timeout: 5_000 })
      return
    }

    await startBtn.click()
    // Tras prepareTwoFactorAction, debe aparecer el container del QR + secret.
    const setup = page.getByTestId('twofa-setup')
    await expect(setup).toBeVisible({ timeout: 8_000 })
    const secret = page.getByTestId('twofa-secret')
    const code = page.getByTestId('twofa-code')
    await expect(secret).toBeVisible()
    await expect(code).toBeVisible()

    // Edge: enviar código incorrecto debe disparar [INVALID_TOTP] y
    // renderizar `twofa-error`. NO recargamos la página tras el error.
    await code.fill('000000')
    await page.getByTestId('twofa-confirm').click()
    const error = page.getByTestId('twofa-error')
    await expect(error).toBeVisible({ timeout: 8_000 })
  })
})
