import { test } from '@playwright/test'

/**
 * HU-4.3 · E2E para exportar a MS Project XML.
 *
 * TODO(EPIC-P0-4): habilitar cuando:
 *  - El botón `<ExportMspButton />` esté integrado al toolbar de
 *    `GanttBoardClient` (lo hará @Orq al consolidar Sprint 8).
 *  - El helper de seed exponga proyectos con tareas + dependencias +
 *    assignees representativos (mismo gap que `export-excel.spec.ts`).
 *  - El harness de Playwright pueda capturar el `download` del Blob y
 *    parsearlo con `fast-xml-parser` en el test runner para validar
 *    estructura (xmlns, OutlineNumber, PredecessorLink).
 *
 * Cuando se habilite, cubrir:
 *  - Botón disabled si no hay proyecto seleccionado o sin tareas.
 *  - Click → toast verde + archivo `.xml` descargado con filename
 *    `{slug-proyecto}-YYYY-MM-DD.xml`.
 *  - Round-trip: abrir el archivo descargado, parsearlo y verificar que:
 *      · El root tag `Project` declara `xmlns="http://schemas.microsoft.com/project"`.
 *      · Cada `Task` tiene UID, ID, Name, Start, Finish, OutlineNumber.
 *      · Las dependencias aparecen como `<PredecessorLink>` dentro del
 *        Task sucesor (no como elementos top-level).
 *      · `LinkLag` está expresado en décimas de minuto.
 *  - Manejo de error `[FILE_TOO_LARGE]` (mock del writer para forzar
 *    >5MB) → toast rojo.
 *  - Accesibilidad: el botón tiene aria-label "Exportar a MS Project" y
 *    es operable por teclado (Tab + Enter).
 */

test.describe.skip('HU-4.3 · exportar a MS Project XML', () => {
  test('descarga un XML válido con xmlns MSP y las tareas del proyecto', async () => {
    // Pendiente — ver TODO(EPIC-P0-4) arriba.
  })

  test('rechaza la descarga con FILE_TOO_LARGE cuando excede 5MB', async () => {
    // Pendiente — ver TODO(EPIC-P0-4) arriba.
  })

  test('botón deshabilitado sin proyecto seleccionado', async () => {
    // Pendiente — ver TODO(EPIC-P0-4) arriba.
  })
})
