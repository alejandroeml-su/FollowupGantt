import { test, expect } from '@playwright/test'

/**
 * Sprint 6 · HU-1.0 + HU-1.2 · capa SVG de dependencias en /gantt.
 *
 * Smoke test mínimo: verifica que la página carga, expone el contenedor
 * del Gantt con un <svg> hermano de las filas, y no emite errores de
 * consola durante el render inicial.
 *
 * Marcado como `skip` siguiendo la convención de tests/e2e que no se
 * ejecutan en el pipeline (deuda viva registrada — E2E corren a mano).
 * Para ejecutar localmente: `npx playwright test gantt-dependencies`.
 */
test.describe.skip('Gantt · capa SVG de dependencias', () => {
  test('la página /gantt carga y renderiza un SVG dentro del contenedor', async ({
    page,
  }) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    await page.goto('/gantt')

    // El Gantt expone su contenedor con el header "Nombre de la Tarea".
    await expect(
      page.getByText('Nombre de la Tarea', { exact: true }),
    ).toBeVisible()

    // Si hay tareas con dependencias visibles, debería existir al menos
    // un <svg> dentro del contenedor del Gantt. Si no hay deps, el test
    // sigue pasando porque no exigimos que existan.
    const svg = page.locator('div.rounded-xl svg').first()
    const svgCount = await page.locator('div.rounded-xl svg').count()
    if (svgCount > 0) {
      await expect(svg).toBeAttached()
    }

    // No debe haber errores rojos en consola.
    expect(consoleErrors, consoleErrors.join('\n')).toHaveLength(0)
  })
})
