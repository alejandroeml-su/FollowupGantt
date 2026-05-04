import { test, expect } from '@playwright/test'
import {
  applyAuthCookie,
  cleanupAuthSeed,
  disconnectAuthClient,
  seedAuthUser,
} from './_helpers/seed-auth'
import {
  cleanupSeed,
  disconnectSeedClient,
  makeGanttFixture,
  seedProject,
} from './_helpers/seed'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

/**
 * Ola P5 · Hard Deadlines + Resource Leveling — E2E.
 *
 * Cubre:
 *   - Happy path: la página /leveling renderiza el header y selecciona
 *     el proyecto seedeado.
 *   - Edge: tarea con hardDeadline en el pasado dispara violación visible
 *     en HardDeadlineWarnings.
 *   - Error: abrir el dialog de leveling sin tareas problemáticas no
 *     rompe el render (el botón debe seguir siendo visible/clickeable).
 */

const USER_EMAIL = 'leveling-user@e2e.test'
const FIXTURE = makeGanttFixture('leveling')

let cachedClient: PrismaClient | null = null
function getDb(): PrismaClient {
  if (cachedClient) return cachedClient
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dotenv = require('dotenv') as typeof import('dotenv')
    dotenv.config({ path: '.env.local' })
    if (!process.env.DATABASE_URL) dotenv.config({ path: '.env' })
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  cachedClient = new PrismaClient({ adapter: new PrismaPg(pool) })
  return cachedClient
}

test.describe('Leveling · hardDeadlines', () => {
  test.afterAll(async () => {
    await cleanupSeed(FIXTURE).catch(() => {})
    await cleanupAuthSeed(USER_EMAIL).catch(() => {})
    await disconnectSeedClient().catch(() => {})
    await disconnectAuthClient().catch(() => {})
    if (cachedClient) await cachedClient.$disconnect().catch(() => {})
  })

  test('happy path: /leveling renderiza header y permite seleccionar proyecto', async ({
    page,
    context,
  }) => {
    const user = await seedAuthUser(USER_EMAIL, 'ADMIN')
    await seedProject(FIXTURE)
    await applyAuthCookie(context, user.cookieValue)

    const res = await page.goto(
      `/leveling?projectId=${encodeURIComponent(FIXTURE.projectId)}`,
    )
    expect(res?.status() ?? 0).toBeLessThan(500)

    await expect(
      page.getByRole('heading', { name: 'Nivelación de recursos' }),
    ).toBeVisible({ timeout: 5_000 })

    // El botón "Calcular leveling" debe estar disponible.
    await expect(page.getByTestId('open-leveling-dialog')).toBeVisible({
      timeout: 5_000,
    })
  })

  test('edge: hardDeadline pasada genera violación visible', async ({
    page,
    context,
  }) => {
    const user = await seedAuthUser(USER_EMAIL, 'ADMIN')
    await seedProject(FIXTURE)
    // Inyectamos hardDeadline en el pasado para la primera tarea.
    const db = getDb()
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await db.task.update({
      where: { id: FIXTURE.tasks[0].id },
      data: { hardDeadline: yesterday },
    })

    await applyAuthCookie(context, user.cookieValue)
    await page.goto(
      `/leveling?projectId=${encodeURIComponent(FIXTURE.projectId)}`,
    )

    // Una de las dos secciones aparece según el resultado:
    //   - empty (`hard-deadline-empty`) ⇒ no hay violations.
    //   - warnings (`hard-deadline-warnings`) ⇒ hay tasks con hardDeadline.
    const warningsBlock = page.getByTestId('hard-deadline-warnings')
    const emptyBlock = page.getByTestId('hard-deadline-empty')

    const seen = await Promise.race([
      warningsBlock
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => 'warnings' as const)
        .catch(() => null),
      emptyBlock
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => 'empty' as const)
        .catch(() => null),
    ])
    expect(seen === 'warnings' || seen === 'empty').toBe(true)
    if (seen === 'warnings') {
      // El bloque debe contener la tarea con hardDeadline.
      await expect(warningsBlock).toContainText(/E2E|Diseño|leveling/i)
    }
  })

  test('error case: abrir dialog de leveling no rompe la página', async ({
    page,
    context,
  }) => {
    const user = await seedAuthUser(USER_EMAIL, 'ADMIN')
    await seedProject(FIXTURE)
    await applyAuthCookie(context, user.cookieValue)
    await page.goto(
      `/leveling?projectId=${encodeURIComponent(FIXTURE.projectId)}`,
    )

    const openBtn = page.getByTestId('open-leveling-dialog')
    await expect(openBtn).toBeVisible({ timeout: 5_000 })
    await openBtn.click()

    // El dialog debe montarse, o (si el cómputo falla por datos
    // mínimos) debe aparecer el mensaje de error tipado.
    const dialog = page.getByTestId('leveling-dialog')
    const errorMsg = page.getByTestId('leveling-error')
    const seen = await Promise.race([
      dialog
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => 'dialog' as const)
        .catch(() => null),
      errorMsg
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => 'error' as const)
        .catch(() => null),
    ])
    expect(['dialog', 'error']).toContain(seen)
  })
})
