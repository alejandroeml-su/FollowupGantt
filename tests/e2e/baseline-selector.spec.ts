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
 * HU-3.2 · E2E para listar y seleccionar líneas base (cierre Sprint 6.5).
 *
 * Sembramos DOS proyectos:
 *   - PROJECT_WITH (3 baselines distintas) → cubre orden + persistencia.
 *   - PROJECT_EMPTY (sin baselines)        → cubre estado disabled.
 *
 * Las pruebas validan:
 *   1. Sin baselines → selector disabled, "Sin líneas base".
 *   2. Con baselines → opciones ordenadas version desc.
 *   3. Persistencia: tras reload el id activo se mantiene (zustand
 *      `activeBaselineId` clave por projectId).
 *   4. Cambio a "Ninguna" deja value="" y la pill leyenda desaparece.
 */

const PROJECT_WITH = 'e2e_proj_selector_with'
const PROJECT_EMPTY = 'e2e_proj_selector_empty'

const PROJECT_WITH_FIXTURE: SeedFixture = {
  projectId: PROJECT_WITH,
  projectName: '[E2E] HU-3.2 selector con baselines',
  startBase: '2026-05-04T00:00:00Z',
  tasks: [
    { id: 'e2e_task_sel_w1', title: '[E2E sel] T1', startOffset: 0, durationDays: 3 },
    { id: 'e2e_task_sel_w2', title: '[E2E sel] T2', startOffset: 5, durationDays: 3 },
  ],
  deps: [],
}

const PROJECT_EMPTY_FIXTURE: SeedFixture = {
  projectId: PROJECT_EMPTY,
  projectName: '[E2E] HU-3.2 selector sin baselines',
  startBase: '2026-05-04T00:00:00Z',
  tasks: [
    { id: 'e2e_task_sel_e1', title: '[E2E sel-e] T1', startOffset: 0, durationDays: 3 },
  ],
  deps: [],
}

const BL_TASKS = [
  {
    id: 'e2e_task_sel_w1',
    plannedStart: new Date('2026-05-04T00:00:00Z'),
    plannedEnd: new Date('2026-05-06T00:00:00Z'),
    progress: 100,
  },
  {
    id: 'e2e_task_sel_w2',
    plannedStart: new Date('2026-05-09T00:00:00Z'),
    plannedEnd: new Date('2026-05-11T00:00:00Z'),
    progress: 50,
  },
]

const BASELINE_V1 = makeBaselineFixtureFromProject({
  projectId: PROJECT_WITH,
  suffix: 'sel_v1',
  version: 1,
  label: 'Aprobada Q1',
  daysAgo: 60,
  tasks: BL_TASKS,
})
const BASELINE_V2 = makeBaselineFixtureFromProject({
  projectId: PROJECT_WITH,
  suffix: 'sel_v2',
  version: 2,
  label: 'Reaprob. Q2',
  daysAgo: 30,
  tasks: BL_TASKS,
})
const BASELINE_V3 = makeBaselineFixtureFromProject({
  projectId: PROJECT_WITH,
  suffix: 'sel_v3',
  version: 3,
  label: null,
  daysAgo: 7,
  tasks: BL_TASKS,
})

async function clearBaselinePersistence(page: Page): Promise<void> {
  await page.evaluate(() => {
    try {
      localStorage.removeItem('followup-ui')
    } catch {
      // best-effort
    }
  })
}

test.describe('HU-3.2 · selector de línea base', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async () => {
    await seedProject(PROJECT_WITH_FIXTURE)
    await seedProject(PROJECT_EMPTY_FIXTURE)
    await cleanupBaselinesForProject(PROJECT_WITH)
    await cleanupBaselinesForProject(PROJECT_EMPTY)
    // Sembramos las 3 baselines en orden de versión.
    await seedBaseline(BASELINE_V1)
    await seedBaseline(BASELINE_V2)
    await seedBaseline(BASELINE_V3)
  })

  test.afterAll(async () => {
    try {
      await cleanupBaselinesForProject(PROJECT_WITH)
      await cleanupBaselinesForProject(PROJECT_EMPTY)
      await cleanupSeed(PROJECT_WITH_FIXTURE)
      await cleanupSeed(PROJECT_EMPTY_FIXTURE)
    } catch (err) {
      console.warn('[E2E] cleanup baseline-selector falló (se ignora):', err)
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

  test('proyecto sin baselines: selector disabled con "Sin líneas base"', async ({
    page,
  }) => {
    await expect(
      page.locator(`select[aria-label="Proyecto"] > option[value="${PROJECT_EMPTY}"]`),
    ).toBeAttached({ timeout: 10_000 })
    await page.waitForTimeout(500)
    await page.locator('select[aria-label="Proyecto"]').selectOption(PROJECT_EMPTY)
    const selector = page.getByTestId('baseline-selector')
    await expect(selector).toBeDisabled()
    await expect(selector).toContainText(/sin líneas base/i)
  })

  test('proyecto con baselines: dropdown lista 3 versiones en orden desc', async ({
    page,
  }) => {
    await expect(
      page.locator(`select[aria-label="Proyecto"] > option[value="${PROJECT_WITH}"]`),
    ).toBeAttached({ timeout: 10_000 })
    await page.waitForTimeout(500)
    await page.locator('select[aria-label="Proyecto"]').selectOption(PROJECT_WITH)
    const selector = page.getByTestId('baseline-selector')
    await expect(selector).toBeEnabled({ timeout: 5_000 })

    // Leemos el text de las opciones; la primera real (no-vacía) es v.3,
    // luego v.2, luego v.1.
    const optionLabels = await selector
      .locator('option')
      .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).text))

    // Filtramos la opción "Ninguna" (value="").
    const versioned = optionLabels.filter((t) => /^v\.\d+/.test(t.trim()))
    expect(versioned.length).toBeGreaterThanOrEqual(3)
    // Orden esperado: v.3 → v.2 → v.1.
    expect(versioned[0]).toMatch(/^v\.3\b/)
    expect(versioned[1]).toMatch(/^v\.2\b/)
    expect(versioned[2]).toMatch(/^v\.1\b/)
  })

  test('selección persiste tras recargar la página', async ({ page }) => {
    await expect(
      page.locator(`select[aria-label="Proyecto"] > option[value="${PROJECT_WITH}"]`),
    ).toBeAttached({ timeout: 10_000 })
    await page.waitForTimeout(500)
    await page.locator('select[aria-label="Proyecto"]').selectOption(PROJECT_WITH)
    const selector = page.getByTestId('baseline-selector')
    await expect(selector).toBeEnabled({ timeout: 5_000 })
    await expect(
      selector.locator(`option[value="${BASELINE_V2.baselineId}"]`),
    ).toBeAttached({ timeout: 5_000 })

    await selector.selectOption(BASELINE_V2.baselineId)
    await expect(page.getByTestId('gantt-baseline-legend')).toBeVisible({
      timeout: 8_000,
    })

    // Reload sin tocar el storage.
    await page.reload()
    await expect(
      page.getByText('Nombre de la Tarea', { exact: true }),
    ).toBeVisible({ timeout: 10_000 })
    // Tras hidratación, el filtro de proyecto se pierde (no está en
    // zustand persistido) — re-aplicarlo y comprobar que el value del
    // selector regresa al id persistido.
    await expect(
      page.locator(`select[aria-label="Proyecto"] > option[value="${PROJECT_WITH}"]`),
    ).toBeAttached({ timeout: 10_000 })
    await page.waitForTimeout(500)
    await page.locator('select[aria-label="Proyecto"]').selectOption(PROJECT_WITH)
    const selectorAfter = page.getByTestId('baseline-selector')
    await expect(selectorAfter).toBeEnabled({ timeout: 5_000 })
    await expect(selectorAfter).toHaveValue(BASELINE_V2.baselineId)
  })

  test('cambiar a "Ninguna" desactiva la baseline', async ({ page }) => {
    await expect(
      page.locator(`select[aria-label="Proyecto"] > option[value="${PROJECT_WITH}"]`),
    ).toBeAttached({ timeout: 10_000 })
    await page.waitForTimeout(500)
    await page.locator('select[aria-label="Proyecto"]').selectOption(PROJECT_WITH)
    const selector = page.getByTestId('baseline-selector')
    await expect(selector).toBeEnabled({ timeout: 5_000 })
    await expect(
      selector.locator(`option[value="${BASELINE_V3.baselineId}"]`),
    ).toBeAttached({ timeout: 5_000 })

    await selector.selectOption(BASELINE_V3.baselineId)
    await expect(page.getByTestId('gantt-baseline-legend')).toBeVisible({
      timeout: 8_000,
    })

    // Ninguna = option con value vacío.
    await selector.selectOption('')
    await expect(selector).toHaveValue('')
    // La pill leyenda y la capa fantasma desaparecen.
    await expect
      .poll(() => page.getByTestId('gantt-baseline-legend').count(), {
        timeout: 5_000,
      })
      .toBe(0)
  })
})
