import { test } from '@playwright/test'

/**
 * HU-3.1 · E2E para capturar línea base.
 *
 * TODO(EPIC-P0-3): habilitar cuando el helper de seed exponga proyectos
 * con tareas y limpieza de la tabla `Baseline`. Hoy el helper
 * `makeGanttFixture` no devuelve un proyecto con cap-aware count, y el
 * cleanup post-test no toca `baseline` → riesgo de filtrar versiones
 * entre runs. Diferido al sprint donde se habilite la HU-3.3 (overlay)
 * porque a partir de ahí la captura tiene rendering visible.
 *
 * Cuando se habilite, cubrir:
 *  - Botón disabled si no hay proyecto seleccionado / sin tareas.
 *  - Modal abre con preview de count y nextVersion correcto.
 *  - Captura exitosa → toast verde con "Línea base v.{N} capturada
 *    correctamente" y reaparece el dropdown poblado en HU-3.2.
 *  - Cap-reached: tras 20 capturas el botón confirm se deshabilita.
 *  - Soft cap warning visible a partir de la 15.
 *  - Label opcional persiste y aparece en el selector.
 */

test.describe.skip('HU-3.1 · capturar línea base', () => {
  test('captura una línea base nueva con label opcional', async () => {
    // Pendiente — ver TODO(EPIC-P0-3) arriba.
  })

  test('rechaza captura cuando se alcanzan 20 líneas base', async () => {
    // Pendiente — ver TODO(EPIC-P0-3) arriba.
  })

  test('muestra warning soft cap a partir de 15 versiones', async () => {
    // Pendiente — ver TODO(EPIC-P0-3) arriba.
  })
})
