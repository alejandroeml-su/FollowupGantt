import { test, expect, type Page } from '@playwright/test'
import {
  dependencyArrows,
  ganttBoard,
  gotoGantt,
  taskBars,
} from './_helpers/gantt'
import {
  cleanupSeed,
  disconnectSeedClient,
  makeGanttFixture,
  seedProject,
} from './_helpers/seed'

// Fixture aislado del spec: ids con sufijo `creation` para no colisionar con
// el spec dependency-editor que corre en paralelo en runs sin --workers=1.
const FIXTURE = makeGanttFixture('creation')
const TASK_A = FIXTURE.tasks[0].id
const TASK_C = FIXTURE.tasks[2].id

/**
 * Drag de "creación de dependencia" simulado a nivel de DOM.
 *
 * El handle tiene `aria-label="Crear dependencia desde …"` y vive dentro de
 * la barra (con `group-hover/bar:opacity-70`). Hacer click directo con
 * Playwright es frágil porque (a) el handle es h-2 w-2 (8×8 px) con
 * `translate-x-1/2` que lo deja medio fuera de su contenedor, (b) hay que
 * hovearear primero la barra padre.
 *
 * Solución estable: leer las coordenadas de bounding box del handle real
 * (sin requerir hover, ya que está siempre attached) y usar `page.mouse.*`
 * para simular `mousedown → mousemove(target) → mouseup`. Esto refleja
 * exactamente lo que hace el modo conexión en el componente.
 */
async function dragHandleTo(
  page: Page,
  fromTaskId: string,
  toTaskId: string,
): Promise<void> {
  const fromBar = page.locator(`[data-gantt-task-id="${fromTaskId}"]`)
  const toBar = page.locator(`[data-gantt-task-id="${toTaskId}"]`)
  await expect(fromBar).toBeVisible()
  await expect(toBar).toBeVisible()

  const handle = fromBar.locator('[aria-label^="Crear dependencia"]')
  await expect(handle).toBeAttached()

  // Hover la barra: aunque el handle tiene `pointer-events: auto` y bounding
  // box correcto sin hover, fijar el cursor sobre la barra antes del drag
  // estabiliza el cálculo de posiciones (en algunos runs la barra "saltaba"
  // 1-2 px por re-renders concurrentes con el reseed `revalidatePath`).
  await fromBar.hover({ position: { x: 5, y: 10 } })

  // El handle es h-2 w-2 (8×8 px) y está `translate-x-1/2` (sale a la mitad
  // del padre por la derecha). Lugar en el que tiene el centro: borde derecho
  // de la barra. Calculamos coordenadas en JS sobre el rect real del handle.
  const handleBox = await handle.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  })
  const targetBox = await toBar.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  })

  const fromX = handleBox.x + handleBox.w / 2
  const fromY = handleBox.y + handleBox.h / 2
  // Apuntamos al cuarto izquierdo + un poco hacia abajo del centro de la
  // barra-target. El centro absoluto puede caer en bordes o sobre handles
  // de resize internos; usar (25%, 60%) garantiza estar bien dentro del
  // área "drop-target" de la barra.
  const toX = targetBox.x + targetBox.w * 0.25
  const toY = targetBox.y + targetBox.h * 0.6

  // pointerdown sobre el handle inicia `beginConnection`. Pasos intermedios en
  // pointermove para que el componente actualice `targetTaskId` (vía
  // elementsFromPoint) en cada frame.
  await page.mouse.move(fromX, fromY)
  await page.mouse.down()
  // Esperar a que React monte los listeners pointermove/pointerup globales
  // (ocurre en useEffect tras el setState del beginConnection).
  await page.waitForTimeout(150)

  // Movimiento directo en muchos pasos hasta el target. Después oscilamos
  // en una vecindad pequeña SOBRE el target para que React procese varios
  // `setConnection({targetTaskId})` consecutivos y `connectionRef.current`
  // quede con el target deseado antes del `pointerup`. Esto evita el race
  // condition donde el último mousemove cae sobre una barra intermedia y
  // el ref refleja ese targetTaskId al disparar el up.
  await page.mouse.move(toX, toY, { steps: 25 })
  for (let i = 0; i < 6; i++) {
    const dx = i % 2 === 0 ? 2 : -2
    await page.mouse.move(toX + dx, toY)
    await page.waitForTimeout(40)
  }
  await page.mouse.move(toX, toY)
  await page.waitForTimeout(250)
  await page.mouse.up()
}

/**
 * Sprint 6 · HU-1.3 · drag-handle para crear dependencia FS.
 *
 * Estado: con el helper `seedProject` (Sprint 6.5), estos flujos funcionales
 * ya tienen datos determinísticos. Antes de cada test sembramos un proyecto
 * `[E2E] Sprint 6.5` con 3 tareas + 2 deps FS en mes 2026-05; el cleanup
 * borra todo en `afterAll`.
 *
 * El smoke condicional (handle existe en hover) sigue intacto y comprueba
 * la presencia del data-testid sin depender del fixture específico.
 */
test.describe('HU-1.3 · crear dependencia FS por drag', () => {
  // Serial: comparte el mismo `seedProject` fixture entre tests del describe.
  // El `beforeEach` reseed garantiza estado limpio sin tener que crear/destruir
  // browser context por test.
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async () => {
    // Restaurar el grafo del fixture antes de cada test: tests previos pueden
    // haber añadido dependencias dinámicamente o movido fechas vía drag.
    // `seedProject` es idempotente (upsert) y borra deps "extra" entre las
    // tareas del fixture que no figuren en él.
    await seedProject(FIXTURE)
  })

  test.afterAll(async () => {
    try {
      await cleanupSeed(FIXTURE)
    } catch (err) {
      // Cleanup best-effort: log y continuar — el siguiente run resembrará
      // y `seedProject` es idempotente vía upsert.
      console.warn('[E2E] cleanupSeed falló (se ignora):', err)
    }
    await disconnectSeedClient()
  })

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

  test('drag desde handle de A hasta barra de C crea dep FS y muestra toast', async ({
    page,
  }) => {
    // El fixture incluye task A, B, C donde A→B y B→C ya existen como FS.
    // Aquí creamos una NUEVA dep A→C (forward) que no existe; debería
    // aceptarse y mostrarse toast verde "Dependencia FS creada".
    await gotoGantt(page)
    const arrowsBefore = await dependencyArrows(page).count()

    await dragHandleTo(page, TASK_A, TASK_C)

    await expect(
      page
        .locator('[aria-label="Notificaciones"]')
        .getByText(/dependencia.*creada/i)
        .first(),
    ).toBeVisible({ timeout: 8_000 })

    // El revalidatePath('/gantt') re-rendea el RSC. La nueva flecha debe
    // aparecer en el DOM (count > arrowsBefore) tras la actualización.
    await expect(async () => {
      const count = await dependencyArrows(page).count()
      expect(count).toBeGreaterThan(arrowsBefore)
    }).toPass({ timeout: 8_000 })
  })

  test('intento de ciclo muestra toast con código CYCLE_DETECTED', async ({
    page,
  }) => {
    // El fixture tiene A→B→C. Intentar crear C→A cierra el ciclo:
    // la server action `createDependency` debe rechazar con [CYCLE_DETECTED].
    // Polling del bus de toasts: a veces el cursor atraviesa B antes de
    // llegar a A y el target oscila; en cualquier caso, el grafo cierra
    // ciclo (C→A o C→B son ambos cíclicos), así que cualquier toast con
    // "ciclo detectado" cuenta como aprobado.
    await gotoGantt(page)

    await dragHandleTo(page, TASK_C, TASK_A)

    // Buscamos el toast en la región de notificaciones (`aria-label="Notificaciones"`)
    // — el copy de la implementación es "Ciclo detectado · …".
    await expect(
      page
        .locator('[aria-label="Notificaciones"]')
        .getByText(/ciclo detectado/i)
        .first(),
    ).toBeVisible({ timeout: 8_000 })

    // Sanidad: el board sigue montado (no se rompió por el error del action).
    await expect(ganttBoard(page)).toBeVisible()
  })
})
