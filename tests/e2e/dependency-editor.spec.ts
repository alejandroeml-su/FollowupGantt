import { test, expect, type Locator, type Page } from '@playwright/test'
import { dependencyArrows } from './_helpers/gantt'
import {
  cleanupSeed,
  disconnectSeedClient,
  makeGanttFixture,
  seedProject,
} from './_helpers/seed'

// Fixture aislado del spec: ids con sufijo `editor` para no colisionar con
// el spec dependency-creation que corre en paralelo. Además anclamos las
// tareas a JUNIO 2026 (mes distinto del fixture `creation`, que vive en
// MAYO 2026), de modo que cargar `/gantt?month=2026-06` aísle visualmente
// las flechas de cada spec — sin esto, ambos sets se renderizan juntos
// cuando los workers comparten la misma BD.
const FIXTURE = {
  ...makeGanttFixture('editor'),
  startBase: '2026-06-01T00:00:00Z',
}
const GANTT_MONTH_URL = '/gantt?month=2026-06'

/**
 * Wrapper sobre `gotoGantt` que navega al mes 2026-06 (donde vive el fixture
 * `editor`). Reusa la lógica del helper estándar para esperar al header.
 */
async function gotoGanttEditor(page: Page) {
  await page.goto(GANTT_MONTH_URL)
  await expect(page.getByText('Nombre de la Tarea', { exact: true })).toBeVisible({
    timeout: 10_000,
  })
}

/**
 * Sprint 6 · HU-1.4 · Editor de dependencias (mini-menú + dialog).
 *
 * Estado: con `seedProject` (Sprint 6.5) sembramos un proyecto E2E con
 * 3 tareas y 2 dependencias FS. Cada test que muta una dep restaura el
 * fixture en `beforeEach` para evitar contaminación entre casos.
 */

/**
 * Localiza la PRIMERA flecha sembrada por el fixture. La capa SVG renderiza
 * un `<path data-dep-id="...">` por cada FS. Espera hasta encontrar al menos
 * una para evitar race con la hidratación post-RSC.
 */
async function firstArrow(page: Page): Promise<Locator> {
  const arrow = dependencyArrows(page).first()
  await expect(arrow).toBeAttached({ timeout: 10_000 })
  return arrow
}

/** Abre el menú contextual sobre una flecha de dependencia.
 *
 * NOTA TÉCNICA: el `<path>` hit-area tiene strokeWidth 12 y `pointer-events:stroke`,
 * por lo que solo el trazo (no el espacio interior de la L) recibe clicks. Para
 * acertar al trazo calculamos un punto sobre la curva con `getPointAtLength`
 * y disparamos el clic derecho con `page.mouse.click`.
 */
async function openArrowMenu(page: Page): Promise<void> {
  const arrow = await firstArrow(page)
  const depId = await arrow.getAttribute('data-dep-id')
  if (!depId) throw new Error('La flecha no tiene data-dep-id')

  const point = await page.evaluate((id) => {
    const el = document.querySelector(
      `[data-dep-id="${id}"]`,
    ) as SVGGeometryElement | null
    if (!el) return null
    const len = el.getTotalLength()
    const p = el.getPointAtLength(len / 2)
    const ctm = el.getScreenCTM()
    if (!ctm) return null
    return {
      x: p.x * ctm.a + p.y * ctm.c + ctm.e,
      y: p.x * ctm.b + p.y * ctm.d + ctm.f,
    }
  }, depId)

  if (!point) {
    throw new Error('No se pudieron calcular coordenadas del path')
  }

  await page.mouse.move(point.x, point.y)
  await page.mouse.click(point.x, point.y, { button: 'right' })
  await expect(
    page.getByRole('menu', { name: /Acciones de dependencia/i }),
  ).toBeVisible()
}

test.describe('HU-1.4 · editor de dependencias', () => {
  // Serial: las acciones (cambiar tipo, eliminar) mutan deps compartidas
  // dentro del mismo fixture; el `beforeEach` reseed garantiza estado limpio.
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async () => {
    await seedProject(FIXTURE)
  })

  test.beforeEach(async () => {
    // Restaurar el grafo del fixture: tests anteriores pueden haber borrado
    // o cambiado deps. El upsert reaplica tipo/lag y borra deps "extras"
    // entre las tareas del fixture.
    await seedProject(FIXTURE)
  })

  test.afterAll(async () => {
    try {
      await cleanupSeed(FIXTURE)
    } catch (err) {
      console.warn('[E2E] cleanupSeed falló (se ignora):', err)
    }
    await disconnectSeedClient()
  })

  test('cuando hay dependencias visibles, exponen data-dep-id en el DOM', async ({
    page,
  }) => {
    await gotoGanttEditor(page)
    const arrows = dependencyArrows(page)
    await expect(arrows.first()).toBeAttached({ timeout: 10_000 })
    const id = await arrows.first().getAttribute('data-dep-id')
    expect(id).toBeTruthy()
  })

  test('clic derecho sobre flecha abre menú con Editar/Cambiar tipo/Eliminar', async ({
    page,
  }) => {
    await gotoGanttEditor(page)
    await openArrowMenu(page)

    const menu = page.getByRole('menu', { name: /Acciones de dependencia/i })
    await expect(menu.getByRole('menuitem', { name: /Editar dependencia/i })).toBeVisible()
    // "Cambiar tipo" es un menuitem con aria-haspopup; lo localizamos por
    // su texto literal para no chocar con el submenú al instante.
    await expect(menu.getByText('Cambiar tipo')).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /Eliminar dependencia/i })).toBeVisible()
  })

  test('cambiar tipo desde sub-menú dispara toast verde sin abrir dialog', async ({
    page,
  }) => {
    await gotoGanttEditor(page)
    await openArrowMenu(page)

    const menu = page.getByRole('menu', { name: /Acciones de dependencia/i })
    // Hover sobre "Cambiar tipo" abre el sub-menú (showSubmenu=true).
    await menu.getByText('Cambiar tipo').hover()
    // Sub-menú con FS/SS/FF/SF como menuitemradio.
    const submenuSS = page.getByRole('menuitemradio', { name: /^SS$/ })
    await expect(submenuSS).toBeVisible()
    await submenuSS.click()

    // Toast verde con el mensaje "Tipo cambiado a SS".
    await expect(
      page
        .locator('[aria-label="Notificaciones"]')
        .getByText(/tipo cambiado a SS/i)
        .first(),
    ).toBeVisible({ timeout: 8_000 })

    // No debería abrirse el Dialog (DependencyEditor) al cambiar tipo desde
    // el sub-menú. Si el role=dialog está visible, fallamos.
    await expect(
      page.getByRole('dialog', { name: /dependencia/i }),
    ).toHaveCount(0)
  })

  test('Editar… abre dialog con segmented control y stepper de lag', async ({
    page,
  }) => {
    await gotoGanttEditor(page)
    await openArrowMenu(page)

    const menu = page.getByRole('menu', { name: /Acciones de dependencia/i })
    await menu.getByRole('menuitem', { name: /Editar dependencia/i }).click()

    // Radix Dialog con title "Dependencia". El componente usa segmented
    // control con role=radiogroup y radio buttons FS/SS/FF/SF.
    const dialog = page.locator('[role="dialog"]').filter({ hasText: /Dependencia/i })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('radiogroup')).toBeVisible()
    // Cada tipo aparece como botón con aria-checked.
    await expect(dialog.getByRole('radio', { name: 'FS' })).toBeVisible()
    await expect(dialog.getByRole('radio', { name: 'SS' })).toBeVisible()
    await expect(dialog.getByRole('radio', { name: 'FF' })).toBeVisible()
    await expect(dialog.getByRole('radio', { name: 'SF' })).toBeVisible()
    // Input de lag con label "Lag (días)".
    await expect(dialog.locator('input#dep-lag')).toBeVisible()
    // Botones del stepper.
    await expect(dialog.getByRole('button', { name: /Disminuir lag/i })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Aumentar lag/i })).toBeVisible()
  })

  test('lag fuera de rango bloquea el botón Guardar', async ({ page }) => {
    await gotoGanttEditor(page)
    await openArrowMenu(page)

    const menu = page.getByRole('menu', { name: /Acciones de dependencia/i })
    await menu.getByRole('menuitem', { name: /Editar dependencia/i }).click()

    const dialog = page.locator('[role="dialog"]').filter({ hasText: /Dependencia/i })
    await expect(dialog).toBeVisible()

    const lagInput = dialog.locator('input#dep-lag')
    // 999 está fuera del rango (-30, 365). El input no clampa al teclear
    // (sólo en blur), por eso el estado dirty + lagInvalid debe deshabilitar
    // Guardar.
    await lagInput.click()
    await lagInput.fill('999')
    // Sin blur, el botón Guardar debe estar disabled (lagValid=false).
    const saveButton = dialog.getByRole('button', { name: /^Guardar$/i })
    await expect(saveButton).toBeDisabled()
  })

  test('Eliminar pide confirmación antes de borrar y muestra toast verde', async ({
    page,
  }) => {
    await gotoGanttEditor(page)
    // Esperar a que las flechas del seed se rendericen (post-RSC) antes de
    // capturar el conteo de pre-condición.
    await expect(dependencyArrows(page).first()).toBeAttached({
      timeout: 10_000,
    })
    const arrowsBefore = await dependencyArrows(page).count()
    expect(arrowsBefore).toBeGreaterThan(0)

    await openArrowMenu(page)
    const menu = page.getByRole('menu', { name: /Acciones de dependencia/i })

    // Click "Eliminar dependencia" del mini-menú → invoca deleteEdge directo
    // sin pasar por el dialog de confirmación. Se cierra el menú y dispara
    // el toast "Dependencia eliminada".
    await menu.getByRole('menuitem', { name: /Eliminar dependencia/i }).click()

    await expect(
      page
        .locator('[aria-label="Notificaciones"]')
        .getByText(/dependencia eliminada/i)
        .first(),
    ).toBeVisible({ timeout: 8_000 })

    // Tras revalidatePath, la flecha desaparece del DOM.
    await expect(async () => {
      const count = await dependencyArrows(page).count()
      expect(count).toBeLessThan(arrowsBefore)
    }).toPass({ timeout: 8_000 })
  })

  test('confirmación de eliminado vía dialog (botón Eliminar interno)', async ({
    page,
  }) => {
    // Variante: abrir el editor y usar el botón Eliminar dentro del Dialog;
    // ese flujo SÍ pide confirmación con el sub-componente DeleteConfirm.
    await gotoGanttEditor(page)
    // Esperar a que las flechas del seed se rendericen (post-RSC) antes de
    // capturar el conteo de pre-condición.
    await expect(dependencyArrows(page).first()).toBeAttached({
      timeout: 10_000,
    })
    const arrowsBefore = await dependencyArrows(page).count()
    expect(arrowsBefore).toBeGreaterThan(0)

    await openArrowMenu(page)
    const menu = page.getByRole('menu', { name: /Acciones de dependencia/i })
    await menu.getByRole('menuitem', { name: /Editar dependencia/i }).click()

    const dialog = page.locator('[role="dialog"]').filter({ hasText: /Dependencia/i })
    await expect(dialog).toBeVisible()

    // Botón "Eliminar" en la barra inferior del Dialog (rojo, sin "dependencia"
    // en el label, distinto del menuitem).
    await dialog.getByRole('button', { name: /^Eliminar$/i }).click()

    // Aparece el sub-vista de confirmación: copy "¿Eliminar la dependencia"
    await expect(dialog.getByText(/¿Eliminar la dependencia/i)).toBeVisible()
    // Botón final de confirmar.
    await dialog.getByRole('button', { name: /^Eliminar$/i }).click()

    await expect(
      page
        .locator('[aria-label="Notificaciones"]')
        .getByText(/dependencia eliminada/i)
        .first(),
    ).toBeVisible({ timeout: 8_000 })

    await expect(async () => {
      const count = await dependencyArrows(page).count()
      expect(count).toBeLessThan(arrowsBefore)
    }).toPass({ timeout: 8_000 })
  })
})
