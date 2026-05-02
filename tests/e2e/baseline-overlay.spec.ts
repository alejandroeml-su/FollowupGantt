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
 * HU-3.3 · E2E para overlay visual de línea base (cierre Sprint 6.5).
 *
 * El fixture monta un proyecto con tres tareas en mayo 2026:
 *   - taskA  on-plan: real == baseline (sin desvío).
 *   - taskB  minor:   real desplazado +3d respecto a baseline (1-5d → ámbar).
 *   - taskC  critical: real desplazado +20d respecto a baseline (>15d → rojo + ⚠).
 *
 * El proyecto se filtra por `select[aria-label="Proyecto"]` para que el
 * board solo muestre estas 3 tareas y los locators sean determinísticos.
 *
 * El selector de baseline persiste el id activo en zustand (key compuesta
 * por projectId), por eso reseteamos la persistencia con `evaluate` antes
 * y después de cada test que lo necesite.
 *
 * Convención: el overlay usa `[data-testid="gantt-baseline-layer"]` y la
 * pill leyenda `[data-testid="gantt-baseline-legend"]`. Las barras
 * fantasma viven dentro del layer como `<div role="img">`.
 */

const PROJECT_ID = 'e2e_proj_overlay'
const TASK_ON_PLAN = 'e2e_task_overlay_a'
const TASK_MINOR = 'e2e_task_overlay_b'
const TASK_CRITICAL = 'e2e_task_overlay_c'

// Fixture del proyecto. Las fechas reales (BD) son las que el board muestra.
const PROJECT_FIXTURE: SeedFixture = {
  projectId: PROJECT_ID,
  projectName: '[E2E] HU-3.3 overlay',
  startBase: '2026-05-04T00:00:00Z',
  tasks: [
    // taskA: real = 4-6 may  ;  baseline = 4-6 may  (delta 0d → on-plan)
    { id: TASK_ON_PLAN, title: '[E2E] Tarea on-plan', startOffset: 0, durationDays: 3 },
    // taskB: real = 11-13 may ;  baseline = 8-10 may (delta +3d → minor amber)
    { id: TASK_MINOR, title: '[E2E] Tarea minor +3d', startOffset: 7, durationDays: 3 },
    // taskC: real = 28-30 may ;  baseline = 8-10 may (delta +20d → critical)
    { id: TASK_CRITICAL, title: '[E2E] Tarea crítica +20d', startOffset: 24, durationDays: 3 },
  ],
  deps: [],
}

const BASELINE_FIXTURE = makeBaselineFixtureFromProject({
  projectId: PROJECT_ID,
  suffix: 'overlay',
  version: 1,
  label: 'Aprobada comité',
  daysAgo: 30,
  tasks: [
    {
      id: TASK_ON_PLAN,
      plannedStart: new Date('2026-05-04T00:00:00Z'),
      plannedEnd: new Date('2026-05-06T00:00:00Z'),
      progress: 100,
    },
    {
      id: TASK_MINOR,
      plannedStart: new Date('2026-05-08T00:00:00Z'),
      plannedEnd: new Date('2026-05-10T00:00:00Z'),
      progress: 50,
    },
    {
      id: TASK_CRITICAL,
      plannedStart: new Date('2026-05-08T00:00:00Z'),
      plannedEnd: new Date('2026-05-10T00:00:00Z'),
      progress: 10,
    },
  ],
})

/**
 * Selecciona el proyecto E2E en la barra de filtros y activa la baseline
 * v.1 desde el selector. Se invoca desde el `beforeEach` o desde tests
 * que necesitan estado limpio del overlay.
 */
async function activateBaseline(page: Page): Promise<void> {
  // 1. Esperar a que el option del proyecto E2E esté atachado.
  await expect(
    page.locator(`select[aria-label="Proyecto"] > option[value="${PROJECT_ID}"]`),
  ).toBeAttached({ timeout: 10_000 })
  // 2. Pausa breve para que React termine la hidratación inicial. Sin
  //    esto, en serial mode con browser context reusado, el `change`
  //    event de `selectOption` puede no propagar al estado del filtro.
  await page.waitForTimeout(500)
  // 3. Filtrar por proyecto E2E.
  await page.locator('select[aria-label="Proyecto"]').selectOption(PROJECT_ID)
  // 4. Esperar a que el toolbar de baselines reaccione.
  const selector = page.getByTestId('baseline-selector')
  await expect(selector).toBeEnabled({ timeout: 5_000 })
  // 5. Esperar a que la option de la baseline esté atachada.
  await expect(
    selector.locator(`option[value="${BASELINE_FIXTURE.baselineId}"]`),
  ).toBeAttached({ timeout: 5_000 })
  // 6. Activar la baseline del fixture por su id estable.
  await selector.selectOption(BASELINE_FIXTURE.baselineId)
  // 7. Esperar la pill leyenda como signal de overlay listo.
  await expect(page.getByTestId('gantt-baseline-legend')).toBeVisible({
    timeout: 8_000,
  })
}

/** Limpia el zustand persistido en localStorage para evitar leaks entre tests. */
async function clearBaselinePersistence(page: Page): Promise<void> {
  await page.evaluate(() => {
    try {
      localStorage.removeItem('followup-ui')
    } catch {
      // best-effort
    }
  })
}

test.describe('HU-3.3 · overlay de línea base', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async () => {
    await seedProject(PROJECT_FIXTURE)
    // El cap de baselines del proyecto es 20; nos aseguramos de no
    // arrastrar baselines de runs anteriores antes de seedear la nuestra.
    await cleanupBaselinesForProject(PROJECT_ID)
    await seedBaseline(BASELINE_FIXTURE)
  })

  test.afterAll(async () => {
    try {
      await cleanupBaselinesForProject(PROJECT_ID)
      await cleanupSeed(PROJECT_FIXTURE)
    } catch (err) {
      console.warn('[E2E] cleanup baseline-overlay falló (se ignora):', err)
    }
    await disconnectSeedClient()
  })

  test.beforeEach(async ({ page }) => {
    // Forzamos el mes mayo-2026 vía query string para que las tareas del
    // fixture entren al rango visible incluso si el reloj del runner no
    // coincide. La página /gantt acepta `?month=YYYY-MM`.
    await page.goto('/gantt?month=2026-05')
    await clearBaselinePersistence(page)
    // Reload para que la app re-lea el storage limpio.
    await page.reload()
    await expect(
      page.getByText('Nombre de la Tarea', { exact: true }),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('sin baseline activa el overlay no está montado', async ({ page }) => {
    // Filtramos por proyecto pero no activamos baseline → no debe
    // existir la capa fantasma ni la pill de leyenda.
    await expect(
      page.locator(`select[aria-label="Proyecto"] > option[value="${PROJECT_ID}"]`),
    ).toBeAttached({ timeout: 10_000 })
    await page.waitForTimeout(500)
    await page.locator('select[aria-label="Proyecto"]').selectOption(PROJECT_ID)
    // Esperamos a que las barras reales del fixture aparezcan para
    // garantizar que el filtro tomó efecto.
    await expect(
      page.locator(`[data-gantt-task-id="${TASK_ON_PLAN}"]`),
    ).toBeVisible({ timeout: 8_000 })

    expect(await page.getByTestId('gantt-baseline-layer').count()).toBe(0)
    expect(await page.getByTestId('gantt-baseline-legend').count()).toBe(0)
  })

  test('activar la baseline pinta capa fantasma y pill leyenda', async ({
    page,
  }) => {
    await activateBaseline(page)

    const layer = page.getByTestId('gantt-baseline-layer')
    await expect(layer).toBeVisible()

    // Cada barra fantasma es role="img" dentro del layer. Esperamos al
    // menos 1 (las tareas con datos planificados son 3 → idealmente 3).
    const ghostBars = layer.locator('[role="img"]')
    expect(await ghostBars.count()).toBeGreaterThanOrEqual(1)

    // Pill leyenda incluye la versión activa.
    const legend = page.getByTestId('gantt-baseline-legend')
    await expect(legend).toBeVisible()
    await expect(legend).toContainText(`Línea base v.${BASELINE_FIXTURE.version}`)
  })

  test('borde ámbar para retraso minor (3d)', async ({ page }) => {
    await activateBaseline(page)

    const minorBar = page.locator(`[data-gantt-task-id="${TASK_MINOR}"]`)
    await expect(minorBar).toBeVisible()

    // El componente añade `border-amber-500` (moderado) o
    // `border-amber-500/60` (minor). El delta del fixture es +3d → minor.
    const cls = (await minorBar.getAttribute('class')) ?? ''
    expect(cls, `clases de barra minor: ${cls}`).toMatch(/border-amber-500/)
  })

  test('borde rojo + tooltip para retraso crítico (20d)', async ({ page }) => {
    await activateBaseline(page)

    const criticalBar = page.locator(`[data-gantt-task-id="${TASK_CRITICAL}"]`)
    await expect(criticalBar).toBeVisible()

    const cls = (await criticalBar.getAttribute('class')) ?? ''
    expect(cls, `clases de barra crítica: ${cls}`).toMatch(/border-red-500/)

    // El tooltip combinado (CPM + variance) debería incluir el delta.
    // Title-attribute siempre presente (no solo en hover).
    const title = (await criticalBar.getAttribute('title')) ?? ''
    expect(title).toMatch(/línea base|baseline|\+20|20d/i)
  })

  test('barra on-plan (delta 0) NO tiene borde de variance', async ({
    page,
  }) => {
    await activateBaseline(page)

    const onPlanBar = page.locator(`[data-gantt-task-id="${TASK_ON_PLAN}"]`)
    await expect(onPlanBar).toBeVisible()

    const cls = (await onPlanBar.getAttribute('class')) ?? ''
    // No debe llevar border-amber-500 ni border-red-500 derivados de la
    // varianza — la barra usa su tono por tipo (indigo/emerald) o por CPM.
    expect(cls).not.toMatch(/border-amber-500\b/)
    expect(cls).not.toMatch(/border-red-500\b/)
  })

  test('desactivar baseline ("Ninguna") oculta la capa', async ({ page }) => {
    await activateBaseline(page)
    await expect(page.getByTestId('gantt-baseline-layer')).toBeVisible()

    // Ninguna = value vacío en el select.
    await page.waitForTimeout(200)
    await page.getByTestId('baseline-selector').selectOption('')

    // La capa y la pill desaparecen del DOM (componentes condicionales).
    await expect
      .poll(() => page.getByTestId('gantt-baseline-layer').count(), {
        timeout: 5_000,
      })
      .toBe(0)
    expect(await page.getByTestId('gantt-baseline-legend').count()).toBe(0)
  })
})
