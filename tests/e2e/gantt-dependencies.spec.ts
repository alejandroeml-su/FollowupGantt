import { test, expect } from '@playwright/test'
import {
  criticalOnlyToggle,
  dependencyArrows,
  filtersBar,
  ganttBoard,
  gotoGantt,
} from './_helpers/gantt'

/**
 * Sprint 6 · Smoke E2E del Gantt con capa de dependencias y CPM.
 *
 * Estos cuatro smokes NO requieren seed determinístico: si la BD está
 * vacía, el board renderiza el mensaje "No hay tareas planificadas" y
 * los smokes siguen pasando. La capa SVG y los selectores ARIA del
 * toggle son la verdadera asersión.
 *
 * Convención: usamos `data-testid` (`task-filters-bar`, `gantt-board`)
 * agregados al UI real para no acoplarnos a clases Tailwind volátiles.
 */
test.describe('Gantt · smoke Sprint 6', () => {
  test('Smoke 1: /gantt carga sin errores rojos en consola', async ({ page }) => {
    const { consoleErrors } = await gotoGantt(page)
    // Filtramos warnings de Next.js dev mode (HMR, fast-refresh) que se
    // cuelan como console.error pero son ruido de devtools, no fallos
    // funcionales del UI. Cualquier otro error sí debe romper el smoke.
    const realErrors = consoleErrors.filter(
      (e) =>
        !/HMR|hot-update|Fast Refresh|webpack-internal|hydration/i.test(e) &&
        !/Failed to load resource.*404/i.test(e),
    )
    expect(realErrors, realErrors.join('\n')).toHaveLength(0)
  })

  test('Smoke 2: existe el contenedor del Gantt y al menos una capa de render', async ({
    page,
  }) => {
    await gotoGantt(page)
    const board = ganttBoard(page)
    await expect(board).toBeVisible()
    // El board renderiza (a) el header con la escala de días siempre, y
    // (b) un <svg> SOLO si hay tareas con dependencias en el rango. Si
    // hay deps, el path debe estar attached. Si no, el smoke aún pasa
    // porque el contenedor existe.
    const arrows = dependencyArrows(page)
    const arrowCount = await arrows.count()
    if (arrowCount > 0) {
      await expect(arrows.first()).toBeAttached()
    }
  })

  test('Smoke 3: existe el toggle "Solo ruta crítica" con aria-pressed', async ({
    page,
  }) => {
    await gotoGantt(page)
    const toggle = criticalOnlyToggle(page)
    await expect(toggle).toBeVisible()
    // aria-pressed siempre es 'true' o 'false' (nunca undefined): el
    // estado está controlado por zustand persistido en localStorage.
    const pressed = await toggle.getAttribute('aria-pressed')
    expect(pressed === 'true' || pressed === 'false').toBe(true)
  })

  test('Smoke 4: TaskFiltersBar renderiza y expone selects de filtros', async ({
    page,
  }) => {
    await gotoGantt(page)
    const bar = filtersBar(page)
    await expect(bar).toBeVisible()
    // Estado, Tipo y Prioridad son selects que NO dependen de catálogos
    // externos (gerencias/áreas/proyectos pueden estar vacíos). Si la
    // BD de test no tiene datos de catálogo, estos siguen ahí.
    await expect(bar.getByLabel('Estado')).toBeVisible()
    await expect(bar.getByLabel('Tipo')).toBeVisible()
    await expect(bar.getByLabel('Prioridad')).toBeVisible()
  })

  test('Smoke 5: toggle ruta crítica alterna aria-pressed al click', async ({
    page,
  }) => {
    await gotoGantt(page)
    const toggle = criticalOnlyToggle(page)
    const before = await toggle.getAttribute('aria-pressed')
    await toggle.click()
    // Esperar al re-render: aria-pressed debe haber cambiado (estado
    // controlado por zustand, sincrónico tras click).
    await expect(toggle).not.toHaveAttribute('aria-pressed', before ?? '')
    // Restauramos el estado para no contaminar otros tests si comparten
    // localStorage en un mismo browser context (en práctica Playwright
    // usa contexts aislados, pero la limpieza es buena disciplina).
    await toggle.click()
  })
})
