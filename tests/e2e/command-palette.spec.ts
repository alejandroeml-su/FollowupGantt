import { test, expect } from '@playwright/test'

// TODO(EPIC-001-QA): estabilizar (depende de atajos globales y data seed).
test.describe.skip('Command Palette · datos reales', () => {
  test('"/" abre palette y carga datos', async ({ page }) => {
    await page.goto('/list')
    await page.keyboard.press('Slash')
    const input = page.getByRole('textbox')
    await expect(input).toBeVisible()
    // Primer placeholder o final tras carga
    await expect(input).toHaveAttribute(
      'placeholder',
      /Buscar tareas|Cargando/,
    )
  })

  test('buscar proyecto y Enter navega', async ({ page }) => {
    await page.goto('/list')
    await page.keyboard.press('Slash')
    await page.getByRole('textbox').fill('proyecto')
    // Esperar resultados cargados
    const first = page.getByRole('listbox').getByRole('button').first()
    await first.click()
    // No assertion fuerte de URL porque depende del seed; verificamos cierre
    await expect(page.getByRole('textbox')).toBeHidden({ timeout: 5000 })
  })

  test('Esc cierra la palette', async ({ page }) => {
    await page.goto('/list')
    await page.keyboard.press('Slash')
    await expect(page.getByRole('textbox')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('textbox')).toBeHidden()
  })
})
