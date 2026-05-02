import { test } from '@playwright/test'

/**
 * HU-3.3 · E2E para overlay visual de línea base.
 *
 * TODO(EPIC-P0-3): habilitar cuando el helper de seed (`seedBaselines`)
 * permita preparar un proyecto con baseline + tareas movidas. Hoy
 * `makeGanttFixture` no expone una utilidad de seed para `Baseline`, y
 * forzar la captura desde el botón antes de cada test acopla
 * artificialmente HU-3.1 a este suite.
 *
 * Cuando se habilite, cubrir:
 *  - Activar baseline en el selector → aparece la pill "Línea base v.{N}"
 *    y barras fantasma con borde dashed.
 *  - Mover una tarea +3 días → la barra real adquiere borde ámbar y
 *    aria-label de la fantasma incluye "(3d retraso)".
 *  - Mover una tarea +20 días → borde rojo + icono AlertTriangle visible.
 *  - Tarea creada DESPUÉS de la captura: sin barra fantasma asociada.
 *  - Desactivar la baseline → desaparece la pill y todas las fantasmas.
 *  - Filtrar por proyecto distinto: la baseline se "olvida" para el
 *    nuevo proyecto (key compuesta cross-project).
 */

test.describe.skip('HU-3.3 · overlay de línea base', () => {
  test('renderiza barras fantasma cuando hay baseline activa', async () => {
    // Pendiente — ver TODO(EPIC-P0-3) arriba.
  })

  test('aplica borde ámbar para retraso minor (1-5d)', async () => {
    // Pendiente — ver TODO(EPIC-P0-3) arriba.
  })

  test('aplica borde rojo + icono para retraso crítico (>15d)', async () => {
    // Pendiente — ver TODO(EPIC-P0-3) arriba.
  })

  test('omite barra fantasma para tareas creadas tras la captura', async () => {
    // Pendiente — ver TODO(EPIC-P0-3) arriba.
  })

  test('cambiar de proyecto limpia la pill de leyenda', async () => {
    // Pendiente — ver TODO(EPIC-P0-3) arriba.
  })
})
