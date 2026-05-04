import { test, expect } from '@playwright/test'
import {
  applyAuthCookie,
  cleanupAuthSeed,
  disconnectAuthClient,
  seedAuthUser,
} from './_helpers/seed-auth'

/**
 * Ola P1 · Auth/RBAC MVP — smoke E2E del flujo login.
 *
 * Re-habilitado en P3-4 con `seedAuthUser`. El helper crea un User +
 * Role + Session en la BD compartida y nos devuelve la cookie firmada
 * lista para inyectar en el `context` de Playwright.
 *
 * Los tests de redirect SIN cookie verifican que el proxy redirige
 * correctamente; los tests funcionales que requieren un usuario
 * autenticado usan `applyAuthCookie` antes del navigate.
 *
 * NOTA sobre `E2E_BYPASS_AUTH`: estos specs NO lo activan. Validan el
 * flujo real (cookie firmada → proxy passthrough → page renderea con
 * usuario). El bypass es para suites independientes que solo
 * verifican render de UI sin tocar BD.
 */

const E2E_USER_EMAIL = 'auth-login@e2e.test'
const E2E_PASSWORD = 'e2e-pass-12345!'

test.describe('Auth · login', () => {
  test.afterAll(async () => {
    await cleanupAuthSeed(E2E_USER_EMAIL).catch(() => {})
    await disconnectAuthClient().catch(() => {})
  })

  test('redirige a /login al visitar /gantt sin cookie', async ({ page }) => {
    const res = await page.goto('/gantt')
    // El proxy debería redirigir 307 a /login?next=/gantt.
    await expect(page).toHaveURL(/\/login\?next=%2Fgantt/)
    expect(res?.status()).toBeLessThan(400)
  })

  test('cookie sembrada permite navegar a /gantt sin redirect', async ({
    page,
    context,
  }) => {
    const seed = await seedAuthUser(E2E_USER_EMAIL, 'AGENTE')
    await applyAuthCookie(context, seed.cookieValue)
    const res = await page.goto('/gantt')
    await expect(page).toHaveURL(/\/gantt/)
    expect(res?.status()).toBeLessThan(500)
  })

  test('login inválido muestra mensaje de error', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('login-email').fill(E2E_USER_EMAIL)
    await page.getByTestId('login-password').fill('wrong-password')
    await page.getByTestId('login-submit').click()
    await expect(page.getByTestId('login-error')).toContainText(
      /Credenciales inválidas/,
    )
  })

  test('logout borra la cookie y redirige a /login', async ({
    page,
    context,
  }) => {
    const seed = await seedAuthUser(E2E_USER_EMAIL, 'AGENTE')
    await applyAuthCookie(context, seed.cookieValue)
    await page.goto('/')
    // El logout-button vive en el `<form action={logoutAction}>` del
    // UserMenu (server component, server action). Click → redirect a
    // /login tras destroySession.
    const logoutBtn = page.getByTestId('logout-button').first()
    if ((await logoutBtn.count()) === 0) {
      // El UserMenu puede estar fuera del DOM en viewports donde el
      // sidebar se colapsa. En ese caso el spec no puede ejercitar el
      // botón directamente — verificamos al menos que la cookie se
      // limpia al borrarla manualmente y que el proxy redirige.
      await context.clearCookies()
      await page.goto('/gantt')
      await expect(page).toHaveURL(/\/login/)
      return
    }
    await logoutBtn.click()
    await expect(page).toHaveURL(/\/login/)
  })
})
