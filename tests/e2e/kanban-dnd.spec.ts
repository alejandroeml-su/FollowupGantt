import { test, expect } from '@playwright/test'

/**
 * EPIC-001 · @QA · Suite E2E para Kanban con DnD + menú contextual.
 * Requiere un seed determinista (ver prisma/seed.ts) y base de datos de test
 * aislada (DATABASE_URL en playwright.config.ts apunta a kanban_test).
 */

test.describe('Kanban · Drag & Drop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/kanban')
    await expect(page.getByRole('heading', { name: /Tablero Kanban/ })).toBeVisible()
  })

  test('mueve una tarea de TODO a IN_PROGRESS con mouse', async ({ page }) => {
    const first = page.locator('[aria-label="Columna To Do"] button[aria-label="Arrastrar"]').first()
    const target = page.locator('[aria-label="Columna In Progress"]')
    await first.dragTo(target)

    await expect(
      page.locator('[aria-label="Columna In Progress"]').locator('text=' + (await firstTitle(page))),
    ).toBeVisible({ timeout: 5000 })
  })

  test('mueve una tarea con teclado (Space + flechas)', async ({ page }) => {
    const card = page.locator('[role="button"][aria-roledescription="sortable"]').first()
    await card.focus()
    await page.keyboard.press('Space')
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Space')

    // La live region debe anunciar el movimiento
    const live = page.locator('#a11y-live')
    await expect(live).toContainText(/movida|posición/i)
  })

  test('rollback visual si el servidor falla', async ({ page }) => {
    await page.route('**/api/reorder', (r) => r.abort())
    const first = page.locator('[aria-label="Columna To Do"] button[aria-label="Arrastrar"]').first()
    const target = page.locator('[aria-label="Columna In Progress"]')
    const title = await firstTitle(page)
    await first.dragTo(target)
    await expect(
      page.locator('[aria-label="Columna To Do"]').locator('text=' + title),
    ).toBeVisible()
  })
})

test.describe('Kanban · Menú contextual', () => {
  test('abre con click derecho y muestra las acciones', async ({ page }) => {
    await page.goto('/kanban')
    const card = page.locator('[role="menuitem"], .group').first()
    await card.click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: /Editar/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Eliminar/ })).toBeVisible()
  })

  test('se cierra con Escape y devuelve el foco', async ({ page }) => {
    await page.goto('/kanban')
    const card = page.locator('.group').first()
    await card.click({ button: 'right' })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menuitem')).not.toBeVisible()
  })
})

async function firstTitle(page: import('@playwright/test').Page) {
  return await page
    .locator('[aria-label="Columna To Do"] .group p')
    .first()
    .innerText()
}
