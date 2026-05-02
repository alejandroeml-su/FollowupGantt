import { test } from '@playwright/test'

/**
 * HU-4.1 · E2E para importar desde MS Project XML.
 *
 * TODO(EPIC-P0-4): habilitar cuando:
 *  - El helper de seed (Agente 2 está afinándolo en paralelo) exponga
 *    el flujo de "subir archivo" sin requerir auth real.
 *  - El harness de Playwright tenga un fixture MSP XML válido en
 *    `tests/e2e/_fixtures/msp-real/` (Agente 3 lo está construyendo).
 *  - La UI del modal `<ImportPreviewDialog format="msp-xml" />` esté
 *    estabilizada con los `data-testid` definidos.
 *
 * Cuando se habilite, cubrir:
 *  - Botón "Importar de MS Project" disabled sin proyecto activo.
 *  - Subir XML válido → modal muestra conteos (tareas, dependencias,
 *    recursos) y sample con OutlineNumber.
 *  - Confirmar → toast verde + tareas visibles en el Gantt con la
 *    jerarquía correcta (parent/child por OutlineNumber).
 *  - Subir XML pre-2003 (sin xmlns MSP) → modal muestra
 *    `[INVALID_FILE]` en banner rojo y el botón confirmar queda
 *    deshabilitado.
 *  - Subir XML > 5 MB → respuesta `[FILE_TOO_LARGE]` con status 413.
 *  - Subir XML con ConstraintType → warning amarillo
 *    `[CONSTRAINT_IGNORED]` en el modal.
 *  - Subir XML con Resource sin email match → warning
 *    `[RESOURCE_NO_MATCH]` y la tarea queda sin assignee tras commit.
 *  - Round-trip: exportar (HU-4.3) un proyecto → importar el XML
 *    resultante en otro proyecto vacío y verificar que las tareas y
 *    dependencias se reconstruyen.
 *  - Accesibilidad: aria-label "Importar de MS Project", operable con
 *    teclado (Tab + Enter), warnings/errors leídos por screenreader
 *    vía `aria-live` region.
 */

test.describe.skip('HU-4.1 · importar desde MS Project XML', () => {
  test('subir XML válido y confirmar → tareas creadas', async () => {
    // Pendiente — ver TODO(EPIC-P0-4) arriba.
  })

  test('XML pre-2003 (sin xmlns MSP) → INVALID_FILE en modal', async () => {
    // Pendiente — ver TODO(EPIC-P0-4) arriba.
  })

  test('archivo > 5MB → FILE_TOO_LARGE', async () => {
    // Pendiente — ver TODO(EPIC-P0-4) arriba.
  })

  test('botón deshabilitado sin proyecto seleccionado', async () => {
    // Pendiente — ver TODO(EPIC-P0-4) arriba.
  })
})
