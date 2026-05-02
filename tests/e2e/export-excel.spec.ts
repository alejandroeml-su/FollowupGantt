import { test } from '@playwright/test'

/**
 * HU-4.4 · E2E para exportar a Excel.
 *
 * TODO(EPIC-P0-4): habilitar cuando el helper de seed exponga proyectos
 * con tareas + dependencias + assignees y el harness de Playwright sepa
 * leer Blob descargados (sin dependencia de filesystem real). Hoy
 * `makeGanttFixture` no garantiza tareas asignadas, y el test
 * necesita validar que el archivo descargado tenga las 3 hojas con
 * datos reales (round-trip vía exceljs en el test runner).
 *
 * Cuando se habilite, cubrir:
 *  - Botón disabled si no hay proyecto seleccionado o sin tareas.
 *  - Click → toast verde + archivo `.xlsx` descargado con filename
 *    correcto (`{slug-proyecto}-YYYY-MM-DD.xlsx`).
 *  - Round-trip: abrir el archivo descargado y verificar que las 3
 *    hojas (Tareas, Dependencias, Recursos) tienen los headers y al
 *    menos una fila con los datos esperados.
 *  - Manejo de error `[FILE_TOO_LARGE]` con un proyecto sintéticamente
 *    grande (mock del writer para forzar `> 5MB`) → toast rojo.
 *  - Accesibilidad: el botón tiene aria-label "Exportar a Excel" y es
 *    operable por teclado (Tab + Enter).
 */

test.describe.skip('HU-4.4 · exportar a Excel', () => {
  test('descarga un xlsx con las 3 hojas y los datos del proyecto', async () => {
    // Pendiente — ver TODO(EPIC-P0-4) arriba.
  })

  test('rechaza la descarga con FILE_TOO_LARGE cuando excede 5MB', async () => {
    // Pendiente — ver TODO(EPIC-P0-4) arriba.
  })

  test('botón deshabilitado sin proyecto seleccionado', async () => {
    // Pendiente — ver TODO(EPIC-P0-4) arriba.
  })
})
