import { test } from '@playwright/test'

/**
 * HU-3.2 · E2E para listar y seleccionar líneas base.
 *
 * TODO(EPIC-P0-3): habilitar cuando exista un fixture con un proyecto
 * seed que tenga ≥3 líneas base capturadas. Hoy `makeGanttFixture` solo
 * crea tareas + dependencias; falta extender el helper para precargar
 * baselines deterministas (versión, label, taskCount estable). Se
 * activará en el sprint donde HU-3.3 (overlay visual) tenga seed
 * dedicado, ya que ambas pruebas comparten setup.
 *
 * Cuando se habilite, cubrir:
 *  - Sin baselines → selector deshabilitado con texto "Sin líneas base".
 *  - Con baselines → orden version desc visible en el dropdown nativo.
 *  - Selección persiste en localStorage (recargar página recupera la
 *    versión activa para ese proyecto).
 *  - Cambiar de proyecto NO arrastra la baseline previa (key compuesta).
 *  - Cada proyecto recuerda su propia selección por separado (R2 PO).
 *  - "Ninguna" desactiva la selección y `announce()` lo confirma.
 */

test.describe.skip('HU-3.2 · selector de línea base', () => {
  test('lista versiones en orden desc con label y fecha', async () => {
    // Pendiente — ver TODO(EPIC-P0-3) arriba.
  })

  test('persiste selección por proyecto en localStorage', async () => {
    // Pendiente — ver TODO(EPIC-P0-3) arriba.
  })

  test('cambiar de proyecto no leakea baseline activa entre ellos', async () => {
    // Pendiente — ver TODO(EPIC-P0-3) arriba.
  })

  test('selector deshabilitado cuando no hay baselines en el proyecto', async () => {
    // Pendiente — ver TODO(EPIC-P0-3) arriba.
  })
})
