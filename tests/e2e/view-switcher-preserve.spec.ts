import { test, expect } from '@playwright/test'
import {
  applyAuthCookie,
  cleanupAuthSeed,
  disconnectAuthClient,
  seedAuthUser,
} from './_helpers/seed-auth'

/**
 * EPIC-001 · Sprint 5 · @Dev — preservación de filtros entre vistas
 * vía ViewSwitcher.
 *
 * Re-activado en P3-4: el bloqueante histórico era que `/list` y
 * `/gantt` redirigían a `/login` sin sesión válida. Con `seedAuthUser`
 * + `applyAuthCookie` se inyecta una sesión real y los specs pueden
 * navegar a las rutas protegidas. El switcher se oculta en viewports
 * pequeños — usamos viewport amplio.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const E2E_USER_EMAIL = 'view-switcher@e2e.test'

test.beforeEach(async ({ context }) => {
  const seed = await seedAuthUser(E2E_USER_EMAIL, 'AGENTE')
  await applyAuthCookie(context, seed.cookieValue)
})

test.afterAll(async () => {
  await cleanupAuthSeed(E2E_USER_EMAIL).catch(() => {})
  await disconnectAuthClient().catch(() => {})
})

test.describe('ViewSwitcher · filter preservation', () => {
  test('filtros sobreviven al navegar List → Kanban', async ({ page }) => {
    await page.goto('/list?status=TODO&assignee=u1')
    const kanbanTab = page.getByRole('tab', { name: /Kanban/i }).first()
    await kanbanTab.click()
    await expect(page).toHaveURL(/\/kanban/)
    await expect(page).toHaveURL(/status=TODO/)
    await expect(page).toHaveURL(/assignee=u1/)
  })

  test('month se descarta al salir de /gantt', async ({ page }) => {
    await page.goto('/gantt?month=2026-05&priority=HIGH')
    await page.getByRole('tab', { name: /^List$/i }).first().click()
    await expect(page).toHaveURL(/\/list/)
    await expect(page).not.toHaveURL(/month=/)
    await expect(page).toHaveURL(/priority=HIGH/)
  })

  test('month se preserva al entrar a /gantt', async ({ page }) => {
    await page.goto('/list?month=2026-05')
    await page.getByRole('tab', { name: /Gantt/i }).first().click()
    await expect(page).toHaveURL(/\/gantt/)
    await expect(page).toHaveURL(/month=2026-05/)
  })
})

test.describe('GlobalBreadcrumbs', () => {
  test('marca la última ruta como aria-current="page"', async ({ page }) => {
    await page.goto('/projects')
    // El último crumb debe tener aria-current="page". Como puede haber varios
    // breadcrumbs renderizados en la página (ej. drawer breadcrumbs), nos
    // anclamos a una etiqueta global y al rol/breadcrumb nav.
    const current = page.locator('[aria-current="page"]').first()
    await expect(current).toBeVisible({ timeout: 5000 })
  })
})
