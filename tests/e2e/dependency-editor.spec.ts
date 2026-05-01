import { test, expect } from '@playwright/test'
import { dependencyArrows, gotoGantt } from './_helpers/gantt'

/**
 * Sprint 6 · HU-1.4 · Editor de dependencias (mini-menú + dialog).
 *
 * Estado: los flujos funcionales (clic derecho sobre flecha, sub-menú
 * "Cambiar tipo", dialog "Editar…", validación de lag, confirmación de
 * eliminado) requieren ≥ 1 dependencia visible en el mes actual. Esa
 * precondición depende de un seed determinístico que aún no existe
 * en local (la BD compartida con master rota datos al re-seedear).
 *
 * Estrategia:
 *   • Un smoke condicional verifica que SI hay flechas, exponen
 *     `data-dep-id`. Si no hay, `test.skip(condition)` lo deja pasar
 *     con razón visible.
 *   • Los flujos completos quedan como `test.skip(reason)` dentro de
 *     un `describe` activo, listados en el reporte con la razón
 *     documentada para QA manual.
 */
test.describe('HU-1.4 · editor de dependencias', () => {
  test('cuando hay dependencias visibles, exponen data-dep-id en el DOM', async ({
    page,
  }) => {
    await gotoGantt(page)
    const arrows = dependencyArrows(page)
    const count = await arrows.count()
    test.skip(
      count < 1,
      'BD del entorno sin dependencias en el mes visible — requiere seed.',
    )
    // El path interactivo (hit-area) de cada flecha tiene data-dep-id
    // y aria-label en su <g> contenedor. Asertamos que el id está
    // presente y es no-vacío.
    const id = await arrows.first().getAttribute('data-dep-id')
    expect(id).toBeTruthy()
  })

  test.skip('clic derecho sobre flecha abre menú con Editar/Cambiar tipo/Eliminar', async () => {
    // SKIP: requiere ≥ 1 dependencia visible. Sin seed determinístico,
    // el clic derecho aterriza en vacío. El menú está validado a nivel
    // unitario por su ARIA: role="menu" con aria-label="Acciones de
    // dependencia" en GanttBoardClient.tsx.
  })

  test.skip('cambiar tipo desde sub-menú dispara toast verde sin abrir dialog', async () => {
    // SKIP: depende del menú anterior. La server action `updateDependency`
    // con cambio de tipo está cubierta en
    // tests/unit/dependencies-update.test.ts (9 tests, incluido CYCLE).
  })

  test.skip('Editar… abre dialog con segmented control y stepper de lag', async () => {
    // SKIP: depende del menú anterior. El dialog (DependencyEditor) tiene
    // tests de componente parciales; el flujo completo se valida en QA
    // manual hasta que exista seed determinístico.
  })

  test.skip('lag fuera de rango bloquea el botón Guardar', async () => {
    // SKIP: idem. Rangos de lag validados en
    // tests/unit/validate.test.ts y a nivel server action.
  })

  test.skip('Eliminar pide confirmación antes de borrar', async () => {
    // SKIP: idem. Confirmación visual; sin seed no hay dep que eliminar.
  })
})
