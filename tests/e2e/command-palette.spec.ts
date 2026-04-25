import { test, expect } from '@playwright/test'

/**
 * EPIC-001 · Sprint 5 · @Dev — des-skipeado.
 * Specs del Command Palette: apertura por "/" y cierre por Esc.
 * No depende de seed de DB (la lista de comandos puede estar vacía).
 */
test.describe('Command Palette', () => {
  test('"/" abre el palette y muestra el input', async ({ page }) => {
    await page.goto('/docs')
    await page.locator('body').click()
    await page.keyboard.press('Slash')
    const input = page.getByPlaceholder(/Buscar tareas|Cargando datos/i)
    await expect(input).toBeVisible({ timeout: 5000 })
  })

  test('Esc cierra el palette', async ({ page }) => {
    await page.goto('/docs')
    await page.locator('body').click()
    await page.keyboard.press('Slash')
    const input = page.getByPlaceholder(/Buscar tareas|Cargando datos/i)
    await expect(input).toBeVisible({ timeout: 5000 })
    await page.keyboard.press('Escape')
    await expect(input).toBeHidden({ timeout: 5000 })
  })

  test('escribir filtra resultados o muestra "Sin coincidencias"', async ({ page }) => {
    await page.goto('/docs')
    await page.locator('body').click()
    await page.keyboard.press('Slash')
    const input = page.getByPlaceholder(/Buscar tareas|Cargando datos/i)
    await expect(input).toBeVisible({ timeout: 5000 })
    await input.fill('zzznoexisteseguro')
    // Sin coincidencias = el listbox queda con el mensaje vacío.
    await expect(page.getByText(/Sin coincidencias/i)).toBeVisible({ timeout: 5000 })
  })
})
