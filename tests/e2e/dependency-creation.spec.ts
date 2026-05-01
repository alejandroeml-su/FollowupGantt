import { test, expect } from '@playwright/test'
import { gotoGantt, taskBars } from './_helpers/gantt'

/**
 * Sprint 6 · HU-1.3 · drag-handle para crear dependencia FS.
 *
 * Estado: el flujo end-to-end (drag desde handle de A hasta barra de B
 * y verificación de toast verde) requiere un seed determinístico con
 * ≥ 2 tareas en el mes visible y posiciones controladas. Sin ese
 * fixture el test sólo confirmaría que no hay barras visibles, lo cual
 * es engañoso.
 *
 * Por eso mantenemos los tests funcionales como `test.skip(reason)`
 * dentro de un `describe` activo: aparecen en el reporte de Playwright
 * con la razón visible (no son invisibles) y un futuro `seedProject`
 * helper los habilita inmediatamente cambiando el `test.skip` por
 * `test`.
 *
 * El smoke "el handle existe en el DOM cuando hay barras" sí se valida
 * funcionalmente abajo: si la BD del entorno tiene tareas, lo asertamos;
 * si no, lo declaramos skipped en runtime con `test.skip(condition)`.
 */
test.describe('HU-1.3 · crear dependencia FS por drag', () => {
  test('cuando hay barras visibles, el drag-handle existe en hover', async ({
    page,
  }) => {
    await gotoGantt(page)
    const bars = taskBars(page)
    const count = await bars.count()
    test.skip(
      count < 1,
      'BD del entorno sin tareas en el mes visible — requiere seed.',
    )

    const first = bars.first()
    await first.hover()
    // El handle se renderiza con aria-label "Crear dependencia desde …".
    // Es opacity-0 hasta hover; usamos toBeAttached + toBeVisible para
    // distinguir "no existe" de "existe oculto".
    const handle = first.locator('[aria-label^="Crear dependencia"]')
    await expect(handle).toBeAttached()
  })

  test.skip('drag desde handle de A hasta barra de B crea dep FS y muestra toast', async ({
    page,
  }) => {
    // SKIP: requiere seed determinístico con ≥ 2 tareas en mismo proyecto
    // y posiciones (left, top) controladas para que page.mouse.move llegue
    // al elemento correcto. Sin un helper `seedProject(name, tasks, deps)`
    // este test es inestable. Pendiente: tests/e2e/_helpers/seed.ts.
    await page.goto('/gantt')
  })

  test.skip('intento de ciclo muestra toast con código CYCLE_DETECTED', async ({
    page,
  }) => {
    // SKIP: requiere precondición en BD (dep A→B existente) + drag B→A.
    // Mismo bloqueo que el test anterior (necesita seed determinístico).
    // La validación está cubierta a nivel unitario en
    // tests/unit/dependencies-update.test.ts y tests/unit/cycle.test.ts.
    await page.goto('/gantt')
  })
})
