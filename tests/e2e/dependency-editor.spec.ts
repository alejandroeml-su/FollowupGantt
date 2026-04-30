import { test, expect } from '@playwright/test'

/**
 * Sprint 6 · HU-1.4 · Editor de dependencias (context menu + dialog).
 *
 * Skipped por convención: el runner E2E aún no está conectado al CI
 * (deuda registrada en project_followupgantt_tech, ver TODO(EPIC-P0-1)).
 * Documenta el comportamiento esperado para QA manual:
 *
 *   npx playwright test dependency-editor
 */
test.describe.skip('TODO(EPIC-P0-1): edit dependency via context menu', () => {
  test('clic derecho sobre flecha abre menú con Editar/Cambiar tipo/Eliminar', async ({
    page,
  }) => {
    await page.goto('/gantt')
    await expect(
      page.getByText('Nombre de la Tarea', { exact: true }),
    ).toBeVisible()

    const arrows = page.locator('[data-dep-id]')
    test.skip((await arrows.count()) === 0, 'Necesita ≥ 1 dependencia visible')

    const arrow = arrows.first()
    await arrow.click({ button: 'right' })
    await expect(page.getByRole('menu', { name: /Acciones de dependencia/i })).toBeVisible()
    await expect(page.getByText('Editar dependencia…')).toBeVisible()
    await expect(page.getByText('Cambiar tipo')).toBeVisible()
    await expect(page.getByText('Eliminar dependencia')).toBeVisible()
  })

  test('cambiar tipo desde sub-menú dispara toast verde sin abrir dialog', async ({
    page,
  }) => {
    await page.goto('/gantt')
    const arrows = page.locator('[data-dep-id]')
    test.skip((await arrows.count()) === 0, 'Necesita ≥ 1 dependencia visible')

    await arrows.first().click({ button: 'right' })
    await page.getByText('Cambiar tipo').hover()
    await page.getByRole('menuitemradio', { name: 'SS' }).click()

    await expect(page.getByText(/Tipo cambiado a SS/i)).toBeVisible()
  })

  test('Editar… abre dialog con segmented control y stepper de lag', async ({
    page,
  }) => {
    await page.goto('/gantt')
    const arrows = page.locator('[data-dep-id]')
    test.skip((await arrows.count()) === 0, 'Necesita ≥ 1 dependencia visible')

    await arrows.first().click({ button: 'right' })
    await page.getByText('Editar dependencia…').click()

    await expect(page.getByRole('radiogroup', { name: /Tipo/i })).toBeVisible()
    await expect(page.getByLabel('Lag (días)')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Eliminar' })).toBeVisible()
  })

  test('lag fuera de rango bloquea el botón Guardar', async ({ page }) => {
    await page.goto('/gantt')
    const arrows = page.locator('[data-dep-id]')
    test.skip((await arrows.count()) === 0, 'Necesita ≥ 1 dependencia visible')

    await arrows.first().click({ button: 'right' })
    await page.getByText('Editar dependencia…').click()

    const lag = page.getByLabel('Lag (días)')
    await lag.fill('999')
    await expect(page.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })

  test('Eliminar pide confirmación antes de borrar', async ({ page }) => {
    await page.goto('/gantt')
    const arrows = page.locator('[data-dep-id]')
    test.skip((await arrows.count()) === 0, 'Necesita ≥ 1 dependencia visible')

    await arrows.first().click({ button: 'right' })
    await page.getByText('Editar dependencia…').click()
    await page.getByRole('button', { name: 'Eliminar' }).first().click()

    await expect(page.getByText(/¿Eliminar la dependencia/i)).toBeVisible()
    await page.getByRole('button', { name: 'Cancelar' }).click()
    await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible()
  })
})
