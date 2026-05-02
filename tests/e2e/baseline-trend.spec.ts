import { test, expect, type Page } from '@playwright/test'
import {
  cleanupSeed,
  disconnectSeedClient,
  seedProject,
  type SeedFixture,
} from './_helpers/seed'
import {
  cleanupBaselinesForProject,
  makeBaselineFixtureFromProject,
  seedBaseline,
} from './_helpers/seed-baselines'

/**
 * HU-3.4 · E2E para el panel SV/SPI (cierre Sprint 6.5).
 *
 * El fixture monta un proyecto con dos tareas y una baseline en el
 * pasado. La baseline incluye plannedValue/earnedValue coherentes para
 * que `computeBaselineTrend` produzca puntos dibujables.
 *
 * El toggle "Ver SV/SPI" (`baseline-trend-toggle`) está disabled hasta
 * que haya una baseline activa para el proyecto seleccionado. Al
 * activarse abre el panel (`baseline-trend-panel`) que renderiza un SVG
 * con `role="img"` y una tabla con los últimos 6 meses.
 */

const PROJECT_ID = 'e2e_proj_trend'
const TASK_1 = 'e2e_task_trend_a'
const TASK_2 = 'e2e_task_trend_b'

const PROJECT_FIXTURE: SeedFixture = {
  projectId: PROJECT_ID,
  projectName: '[E2E] HU-3.4 trend',
  startBase: '2026-05-04T00:00:00Z',
  tasks: [
    { id: TASK_1, title: '[E2E] Trend tarea 1', startOffset: 0, durationDays: 5 },
    { id: TASK_2, title: '[E2E] Trend tarea 2', startOffset: 7, durationDays: 5 },
  ],
  deps: [],
}

const BASELINE_FIXTURE = makeBaselineFixtureFromProject({
  projectId: PROJECT_ID,
  suffix: 'trend',
  version: 1,
  label: 'Trend baseline',
  daysAgo: 30,
  tasks: [
    {
      id: TASK_1,
      // Planeado en marzo: ya completado.
      plannedStart: new Date('2026-03-04T00:00:00Z'),
      plannedEnd: new Date('2026-03-08T00:00:00Z'),
      progress: 100,
      plannedValue: 200,
    },
    {
      id: TASK_2,
      // Planeado en abril: 50 % EV.
      plannedStart: new Date('2026-04-11T00:00:00Z'),
      plannedEnd: new Date('2026-04-15T00:00:00Z'),
      progress: 60,
      plannedValue: 300,
    },
  ],
})

async function activateBaseline(page: Page): Promise<void> {
  await expect(
    page.locator(`select[aria-label="Proyecto"] > option[value="${PROJECT_ID}"]`),
  ).toBeAttached({ timeout: 10_000 })
  // Pausa para hidratación de listeners onChange (ver helper overlay).
  await page.waitForTimeout(500)
  await page.locator('select[aria-label="Proyecto"]').selectOption(PROJECT_ID)
  const selector = page.getByTestId('baseline-selector')
  await expect(selector).toBeEnabled({ timeout: 5_000 })
  await expect(
    selector.locator(`option[value="${BASELINE_FIXTURE.baselineId}"]`),
  ).toBeAttached({ timeout: 5_000 })
  await selector.selectOption(BASELINE_FIXTURE.baselineId)
  // Pill leyenda como signal de overlay listo (también cubre HU-3.3).
  await expect(page.getByTestId('gantt-baseline-legend')).toBeVisible({
    timeout: 8_000,
  })
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

test.describe('HU-3.4 · panel evolución SV/SPI', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async () => {
    await seedProject(PROJECT_FIXTURE)
    await cleanupBaselinesForProject(PROJECT_ID)
    await seedBaseline(BASELINE_FIXTURE)
  })

  test.afterAll(async () => {
    try {
      await cleanupBaselinesForProject(PROJECT_ID)
      await cleanupSeed(PROJECT_FIXTURE)
    } catch (err) {
      console.warn('[E2E] cleanup baseline-trend falló (se ignora):', err)
    }
    await disconnectSeedClient()
  })

  test.beforeEach(async ({ page }) => {
    await page.goto('/gantt?month=2026-05')
    await clearBaselinePersistence(page)
    await page.reload()
    await expect(
      page.getByText('Nombre de la Tarea', { exact: true }),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('toggle SV/SPI está disabled sin baseline activa', async ({ page }) => {
    // Filtramos por el proyecto pero no activamos baseline.
    await expect(
      page.locator(`select[aria-label="Proyecto"] > option[value="${PROJECT_ID}"]`),
    ).toBeAttached({ timeout: 10_000 })
    await page.waitForTimeout(500)
    await page.locator('select[aria-label="Proyecto"]').selectOption(PROJECT_ID)
    const toggle = page.getByTestId('baseline-trend-toggle')
    await expect(toggle).toBeVisible()
    await expect(toggle).toBeDisabled()
  })

  test('al activar baseline el toggle se habilita y abre el panel', async ({
    page,
  }) => {
    await activateBaseline(page)

    const toggle = page.getByTestId('baseline-trend-toggle')
    await expect(toggle).toBeEnabled()
    // Estado inicial: panel cerrado (data-open=false).
    await expect(page.getByTestId('baseline-trend-panel')).toHaveAttribute(
      'data-open',
      'false',
    )

    await toggle.click()
    const panel = page.getByTestId('baseline-trend-panel')
    await expect(panel).toHaveAttribute('data-open', 'true')

    // El header del panel muestra el título (h3, no el SVG title interno).
    await expect(
      panel.getByRole('heading', { name: /Evolución SV\/SPI/i }),
    ).toBeVisible()
  })

  test('SVG del gráfico renderiza con role=img y aria-label', async ({
    page,
  }) => {
    await activateBaseline(page)
    await page.getByTestId('baseline-trend-toggle').click()

    const panel = page.getByTestId('baseline-trend-panel')
    // El gráfico SVG dentro del panel.
    const svg = panel.locator('svg[role="img"]')
    await expect(svg).toBeVisible({ timeout: 5_000 })
    const ariaLabel = await svg.getAttribute('aria-label')
    expect(ariaLabel).toBeTruthy()
    expect(ariaLabel ?? '').toMatch(/SV|SPI|evolución/i)
  })

  test('tabla de últimos meses renderiza dentro del panel', async ({
    page,
  }) => {
    await activateBaseline(page)
    await page.getByTestId('baseline-trend-toggle').click()

    const panel = page.getByTestId('baseline-trend-panel')
    const table = panel.locator('table')
    await expect(table).toBeVisible({ timeout: 5_000 })
    // Headers conocidos: Mes, PV, EV, SV, SPI.
    await expect(table.getByText('PV', { exact: true })).toBeVisible()
    await expect(table.getByText('SPI', { exact: true })).toBeVisible()
  })

  test('Escape cierra el panel', async ({ page }) => {
    await activateBaseline(page)
    await page.getByTestId('baseline-trend-toggle').click()

    const panel = page.getByTestId('baseline-trend-panel')
    await expect(panel).toHaveAttribute('data-open', 'true')

    await page.keyboard.press('Escape')
    // El listener cierra inmediatamente (set state síncrono).
    await expect(panel).toHaveAttribute('data-open', 'false', { timeout: 3_000 })
  })

  test('botón cerrar (×) colapsa el panel', async ({ page }) => {
    await activateBaseline(page)
    await page.getByTestId('baseline-trend-toggle').click()

    const panel = page.getByTestId('baseline-trend-panel')
    await expect(panel).toHaveAttribute('data-open', 'true')

    // El header expone aria-label="Cerrar panel de evolución".
    await panel.getByRole('button', { name: /cerrar panel de evolución/i }).click()
    await expect(panel).toHaveAttribute('data-open', 'false', { timeout: 3_000 })
  })
})
