import { test, expect } from '@playwright/test'

/**
 * EPIC-001 · @QA · Gantt horizontal drag + resize (Sprint 3).
 * Requiere seed con al menos una tarea cuyo rango caiga en el mes actual.
 */

test.describe('Gantt · drag & resize', () => {
  test('arrastrar cuerpo desplaza la tarea en el tiempo', async ({ page }) => {
    await page.goto('/gantt')
    const bar = page
      .locator('[role="slider"][aria-label^="Barra de"]')
      .first()
    await expect(bar).toBeVisible()

    const box = await bar.boundingBox()
    if (!box) throw new Error('no bounding box')

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, {
      steps: 5,
    })
    await page.mouse.up()

    // La live-region anuncia el cambio
    const live = page.locator('#a11y-live')
    await expect(live).toContainText(/desplazada|ajustado/i, { timeout: 5000 })
  })

  test('teclado: ArrowRight desplaza la barra con foco', async ({ page }) => {
    await page.goto('/gantt')
    const bar = page
      .locator('[role="slider"][aria-label^="Barra de"]')
      .first()
    await bar.focus()
    await page.keyboard.press('ArrowRight')
    const live = page.locator('#a11y-live')
    await expect(live).toContainText(/\+1 día|Fechas ajustado/i, {
      timeout: 5000,
    })
  })

  test('navegación prev/next de meses actualiza URL', async ({ page }) => {
    await page.goto('/gantt')
    await page.getByRole('link', { name: /mes siguiente/i }).click()
    await expect(page).toHaveURL(/\?month=\d{4}-\d{2}/)
  })
})
