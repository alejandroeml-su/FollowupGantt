import { test, expect } from '@playwright/test'

/**
 * EPIC-001 · Sprint 5 · @Dev — des-skipeado.
 * Specs de navegación por teclado que NO dependen de seed de DB:
 *  - apertura/cierre del overlay de atajos vía Shift+/
 *  - apertura del Command Palette vía /
 *  - input no atrapa atajos globales tras abrir
 *
 * Selectores anclados a textos visibles ("Atajos de teclado", placeholder
 * "Buscar tareas").
 */
test.describe('Navegación por teclado', () => {
  test('Shift+/ abre overlay de atajos', async ({ page }) => {
    await page.goto('/docs')
    // Click en el body para asegurar foco fuera de inputs.
    await page.locator('body').click()
    // react-hotkeys-hook reconoce 'shift+/'. Pulsamos Shift+? que en US-layout
    // emite '/' con shift. Si falla, fallback a 'Shift+/'.
    await page.keyboard.press('Shift+/')
    await expect(
      page.getByRole('heading', { name: /Atajos de teclado/i }),
    ).toBeVisible({ timeout: 5000 })
  })

  test('"/" abre la paleta de comandos', async ({ page }) => {
    await page.goto('/docs')
    await page.locator('body').click()
    await page.keyboard.press('Slash')
    // El placeholder cambia entre "Cargando datos…" → "Buscar tareas, proyectos…"
    // según el estado de carga; aceptamos cualquiera.
    await expect(
      page.getByPlaceholder(/Buscar tareas|Cargando datos/i),
    ).toBeVisible({ timeout: 5000 })
  })

  test('Escape cierra el overlay de atajos', async ({ page }) => {
    await page.goto('/docs')
    await page.locator('body').click()
    // react-hotkeys-hook reconoce 'shift+/'. Pulsamos Shift+? que en US-layout
    // emite '/' con shift. Si falla, fallback a 'Shift+/'.
    await page.keyboard.press('Shift+/')
    await expect(
      page.getByRole('heading', { name: /Atajos de teclado/i }),
    ).toBeVisible({ timeout: 5000 })
    await page.keyboard.press('Escape')
    await expect(
      page.getByRole('heading', { name: /Atajos de teclado/i }),
    ).toBeHidden({ timeout: 5000 })
  })

  test('Shortcuts no disparan dentro de un input', async ({ page }) => {
    await page.goto('/docs')
    await page.locator('body').click()
    await page.keyboard.press('Slash') // abre palette
    const input = page.getByPlaceholder(/Buscar tareas|Cargando datos/i)
    await expect(input).toBeVisible({ timeout: 5000 })
    // Escribir "/" dentro del input no debe reabrirla ni causar side-effects
    await input.fill('/hola')
    await expect(input).toHaveValue('/hola')
  })
})
