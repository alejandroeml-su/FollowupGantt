import { expect, type Page } from '@playwright/test'

/**
 * Helpers compartidos por la suite E2E del Sprint 6 (Gantt + dependencias).
 * Centraliza selectores robustos sobre `data-testid` / ARIA, evitando
 * acoplamiento a clases utilitarias de Tailwind que cambian con frecuencia.
 *
 * Convención: una función por "primitivo" del UI. Los specs componen
 * estos primitivos, no los duplican.
 */

/**
 * Carga `/gantt`, espera al header del board y retorna métricas básicas.
 * Si la página falla por error 5xx o por exceso de errores en consola,
 * retornamos un objeto con `consoleErrors` para que el spec pueda
 * fallar con detalle.
 */
export async function gotoGantt(page: Page): Promise<{
  consoleErrors: string[]
}> {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  await page.goto('/gantt')
  // Header anclado en el componente cliente (cabecera fija de la columna
  // izquierda del Gantt). Se monta tras el RSC; aceptamos hasta 10s en
  // entornos lentos (build prod / cold start).
  await expect(
    page.getByText('Nombre de la Tarea', { exact: true }),
  ).toBeVisible({ timeout: 10_000 })
  return { consoleErrors }
}

/** Locator de la barra de filtros del Gantt (data-testid agregado en HU-1.4 E2E). */
export function filtersBar(page: Page) {
  return page.getByTestId('task-filters-bar')
}

/** Toggle "Solo ruta crítica" (HU-2.3) — botón con aria-pressed. */
export function criticalOnlyToggle(page: Page) {
  return page.getByRole('button', { name: /ruta crítica/i })
}

/** Locator del board del Gantt (contenedor con data-testid). */
export function ganttBoard(page: Page) {
  return page.getByTestId('gantt-board')
}

/** Todas las barras de tareas con dataset data-gantt-task-id. */
export function taskBars(page: Page) {
  return page.locator('[data-gantt-task-id]')
}

/** Todas las flechas SVG de dependencias (path con data-dep-id). */
export function dependencyArrows(page: Page) {
  return page.locator('[data-dep-id]')
}
