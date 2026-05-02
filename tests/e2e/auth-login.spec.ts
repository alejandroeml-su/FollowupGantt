import { test, expect } from '@playwright/test'

/**
 * Ola P1 · Auth/RBAC MVP — smoke E2E del flujo login.
 *
 * SKIPEADO POR DEFECTO. Razones:
 *
 *   1. La fixture global E2E no carga DATABASE_URL ni hace bootstrap del
 *      usuario admin. Habilitar el test exige seedear un usuario con
 *      `bootstrapAdmin` antes de cada run (similar al patrón
 *      `seedBaseline` introducido en Sprint 6.5 — ver
 *      `tests/e2e/_helpers/seedBaseline.ts`).
 *
 *   2. Cookies HttpOnly + redirección server-side requieren un proyecto
 *      Playwright con `storageState` por test, lo cual añade ~30s de
 *      setup que aún no está priorizado.
 *
 * TODO (deuda registrada):
 *   - Implementar `tests/e2e/_helpers/seedAuthUser.ts` que use
 *     `bootstrapAdmin` vía importación directa o endpoint POST
 *     temporal `/api/test/seed-user` protegido por NODE_ENV.
 *   - Habilitar test.describe (quitar .skip) cuando el helper esté listo.
 */

test.describe.skip('Auth · login', () => {
  test('redirige a /login al visitar /gantt sin cookie', async ({ page }) => {
    const res = await page.goto('/gantt')
    // El proxy debería redirigir 307 a /login?next=/gantt.
    await expect(page).toHaveURL(/\/login\?next=%2Fgantt/)
    expect(res?.status()).toBeLessThan(400)
  })

  test('login válido permite navegar a /gantt', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('login-email').fill('e2e@test.local')
    await page.getByTestId('login-password').fill('e2e-pass-12345!')
    await page.getByTestId('login-submit').click()
    await page.waitForURL('/')
    await page.goto('/gantt')
    await expect(page).toHaveURL(/\/gantt/)
  })

  test('login inválido muestra mensaje de error', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('login-email').fill('e2e@test.local')
    await page.getByTestId('login-password').fill('wrong-password')
    await page.getByTestId('login-submit').click()
    await expect(page.getByTestId('login-error')).toContainText(
      /Credenciales inválidas/,
    )
  })

  test('logout borra la cookie y redirige a /login', async ({ page }) => {
    // Asume sesión previa. En CI el helper de seed deberá hacer
    // login programático antes y guardar storageState.
    await page.goto('/')
    await page.getByTestId('logout-button').click()
    await expect(page).toHaveURL(/\/login/)
  })
})
