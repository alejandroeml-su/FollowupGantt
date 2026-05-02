import { test, expect, type Page } from '@playwright/test'
import {
  cleanupSeed,
  disconnectSeedClient,
  seedProject,
  type SeedFixture,
} from './_helpers/seed'
import { cleanupBaselinesForProject } from './_helpers/seed-baselines'

/**
 * HU-3.1 · E2E para capturar línea base (cierre Sprint 6.5).
 *
 * Estrategia: NO sembramos baselines previas — queremos validar el flujo
 * de captura nuevo (botón → modal → confirm → toast). El cleanup
 * `cleanupBaselinesForProject` borra cualquier captura creada por el UI
 * para mantener idempotencia entre runs.
 *
 * Casos cubiertos:
 *   1. Botón disabled si no hay proyecto seleccionado.
 *   2. Botón habilitado al seleccionar proyecto con tareas.
 *   3. Apertura del modal con preview "se capturarán N tareas".
 *   4. Confirm exitoso → toast "Línea base v.1 capturada correctamente".
 */

const PROJECT_ID = 'e2e_proj_capture'

const PROJECT_FIXTURE: SeedFixture = {
  projectId: PROJECT_ID,
  projectName: '[E2E] HU-3.1 capture',
  startBase: '2026-05-04T00:00:00Z',
  tasks: [
    { id: 'e2e_task_cap_1', title: '[E2E cap] T1', startOffset: 0, durationDays: 3 },
    { id: 'e2e_task_cap_2', title: '[E2E cap] T2', startOffset: 5, durationDays: 3 },
  ],
  deps: [],
}

async function clearBaselinePersistence(page: Page): Promise<void> {
  await page.evaluate(() => {
    try {
      localStorage.removeItem('followup-ui')
    } catch {
      // best-effort
    }
  })
}

test.describe('HU-3.1 · capturar línea base', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async () => {
    await seedProject(PROJECT_FIXTURE)
    await cleanupBaselinesForProject(PROJECT_ID)
  })

  test.afterAll(async () => {
    try {
      await cleanupBaselinesForProject(PROJECT_ID)
      await cleanupSeed(PROJECT_FIXTURE)
    } catch (err) {
      console.warn('[E2E] cleanup baseline-capture falló (se ignora):', err)
    }
    await disconnectSeedClient()
  })

  test.beforeEach(async ({ page }) => {
    await cleanupBaselinesForProject(PROJECT_ID)
    await page.goto('/gantt?month=2026-05')
    await expect(
      page.getByText('Nombre de la Tarea', { exact: true }),
    ).toBeVisible({ timeout: 10_000 })
    await clearBaselinePersistence(page)
    // Reload tras limpiar storage para que la hidratación parta limpia.
    // En serial mode el page se reusa entre tests y conservar storage
    // del test anterior puede ocultar el dropdown de proyectos.
    await page.reload()
    await expect(
      page.getByText('Nombre de la Tarea', { exact: true }),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('botón "Capturar línea base" disabled sin proyecto seleccionado', async ({
    page,
  }) => {
    const button = page.getByTestId('capture-baseline-button')
    await expect(button).toBeVisible()
    await expect(button).toBeDisabled()
  })

  test('botón se habilita al seleccionar proyecto con tareas', async ({
    page,
  }) => {
    await expect(
      page.locator(`select[aria-label="Proyecto"] > option[value="${PROJECT_ID}"]`),
    ).toBeAttached({ timeout: 10_000 })
    // Esperar un tick para garantizar que React terminó la hidratación
    // antes del selectOption — sin esta espera, el `change` event llega
    // antes de que los listeners onChange estén montados.
    await page.waitForTimeout(500)
    await page.locator('select[aria-label="Proyecto"]').selectOption(PROJECT_ID)
    const button = page.getByTestId('capture-baseline-button')
    await expect(button).toBeEnabled({ timeout: 5_000 })
  })

  test('click abre modal con preview de N tareas', async ({ page }) => {
    await expect(
      page.locator(`select[aria-label="Proyecto"] > option[value="${PROJECT_ID}"]`),
    ).toBeAttached({ timeout: 10_000 })
    await page.waitForTimeout(500)
    await page.locator('select[aria-label="Proyecto"]').selectOption(PROJECT_ID)
    const button = page.getByTestId('capture-baseline-button')
    await expect(button).toBeEnabled({ timeout: 5_000 })
    await button.click()

    const dialog = page.getByTestId('capture-baseline-dialog')
    await expect(dialog).toBeVisible()
    // El proyecto del fixture tiene 2 tareas no archivadas.
    await expect(dialog).toContainText(/Se capturarán\s*2\s*tarea/i)
    // Header del modal con la próxima versión: v.1 (no hay baselines).
    await expect(dialog).toContainText(/Capturar línea base v\.1/i)
  })

  test('confirmar captura muestra toast de éxito', async ({ page }) => {
    await expect(
      page.locator(`select[aria-label="Proyecto"] > option[value="${PROJECT_ID}"]`),
    ).toBeAttached({ timeout: 10_000 })
    await page.waitForTimeout(500)
    await page.locator('select[aria-label="Proyecto"]').selectOption(PROJECT_ID)
    const button = page.getByTestId('capture-baseline-button')
    await expect(button).toBeEnabled({ timeout: 5_000 })
    await button.click()

    const dialog = page.getByTestId('capture-baseline-dialog')
    await expect(dialog).toBeVisible()

    // Confirmar (sin label) — el botón confirm tiene data-testid.
    await dialog.getByTestId('capture-baseline-confirm').click()

    // Toast verde con copy "Línea base v.1 capturada correctamente".
    await expect(
      page
        .locator('[aria-label="Notificaciones"]')
        .getByText(/línea base v\.1 capturada correctamente/i)
        .first(),
    ).toBeVisible({ timeout: 8_000 })
  })
})
