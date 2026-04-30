import { test, expect } from '@playwright/test'

/**
 * Sprint 6 · HU-1.3 · drag-handle para crear dependencia FS.
 *
 * Skipped por convención del proyecto (E2E corre a mano hasta que el
 * pipeline tenga el runner de Playwright estable). Documenta el
 * comportamiento esperado para que QA pueda ejecutarlo localmente:
 *
 *   npx playwright test dependency-creation
 *
 * TODO(EPIC-P0-1): habilitar cuando @SRE conecte la suite E2E al CI.
 */
test.describe.skip('TODO(EPIC-P0-1): create dependency by drag', () => {
  test('drag desde handle de tarea A hasta tarea B crea dep FS y muestra toast verde', async ({
    page,
  }) => {
    await page.goto('/gantt')
    await expect(page.getByText('Nombre de la Tarea', { exact: true })).toBeVisible()

    const bars = page.locator('[data-gantt-task-id]')
    const count = await bars.count()
    test.skip(count < 2, 'Necesita ≥ 2 tareas con fechas en el rango visible')

    const a = bars.nth(0)
    const b = bars.nth(1)

    // Hover sobre A → handle visible.
    await a.hover()
    const handle = a.locator('[aria-label^="Crear dependencia"]')
    await expect(handle).toBeVisible()

    // Drag desde el centro del handle hasta el centro de la barra B.
    const handleBox = await handle.boundingBox()
    const bBox = await b.boundingBox()
    if (!handleBox || !bBox) throw new Error('No se pudo calcular bounding boxes')

    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(
      bBox.x + bBox.width / 2,
      bBox.y + bBox.height / 2,
      { steps: 10 },
    )
    await page.mouse.up()

    // Toast verde de éxito.
    await expect(page.getByText(/Dependencia FS creada/i)).toBeVisible()
  })

  test('intento de ciclo muestra toast de error con código CYCLE_DETECTED', async ({
    page,
  }) => {
    // Pre-condición: tarea A → B ya existe en BD.
    // Drag B → A debería responder con [CYCLE_DETECTED].
    await page.goto('/gantt')
    const bars = page.locator('[data-gantt-task-id]')
    test.skip(
      (await bars.count()) < 2,
      'Necesita ≥ 2 tareas con dependencia previa A→B',
    )
    // El test real necesita un seed determinístico; deferred a la fixture.
  })
})
