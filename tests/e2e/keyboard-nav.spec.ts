import { test, expect } from '@playwright/test'

// TODO(EPIC-001-QA): estabilizar (requieren foco inicial determinista).
test.describe.skip('Navegación por teclado', () => {
  test('Shift+/ abre overlay de atajos', async ({ page }) => {
    await page.goto('/kanban')
    await page.keyboard.press('Shift+Slash')
    await expect(page.getByRole('heading', { name: /Atajos/ })).toBeVisible()
  })

  test('"/" abre la paleta de comandos', async ({ page }) => {
    await page.goto('/kanban')
    await page.keyboard.press('Slash')
    await expect(page.getByPlaceholder(/Buscar tareas/)).toBeVisible()
  })

  test('Escape cierra el overlay', async ({ page }) => {
    await page.goto('/kanban')
    await page.keyboard.press('Shift+Slash')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: /Atajos/ })).not.toBeVisible()
  })

  test('Shortcuts no disparan dentro de un input', async ({ page }) => {
    await page.goto('/kanban')
    await page.keyboard.press('Slash') // abre palette
    // Escribir "/" dentro del input no debe reabrirla ni causar side-effects
    await page.getByPlaceholder(/Buscar tareas/).fill('/hola')
    await expect(page.getByPlaceholder(/Buscar tareas/)).toHaveValue('/hola')
  })
})
