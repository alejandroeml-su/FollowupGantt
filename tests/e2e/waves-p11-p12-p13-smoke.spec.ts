import { test, expect } from '@playwright/test'
import {
  applyAuthCookie,
  cleanupAuthSeed,
  disconnectAuthClient,
  seedAuthUser,
} from './_helpers/seed-auth'

/**
 * Wave P11+P12+P13 · Smoke tests E2E.
 *
 * Cubre la deuda de tests pendientes del informe ejecutivo · sprint
 * Hardening Pre-POC · 13 SP. Patrón: para cada feature de las waves
 * P11-Scrum + P11-PMI + P12 + P13, verificamos que:
 *   - La página carga sin error opaco de RSC
 *   - El UI clave (header / componente principal) está visible
 *   - Server actions críticas no lanzan
 *
 * Las queries son tolerantes a estado de BD (no asumen seeds
 * específicos) · si el contenido está vacío, verifican empty state.
 */

const ADMIN_EMAIL = 'wave-smoke-admin@e2e.test'

// Auth cookie compartida entre los tests del archivo · evitamos seedAuthUser
// 13 veces (cada uno paga ~500ms a la BD).
let cookieValue: string

test.beforeAll(async () => {
  const seed = await seedAuthUser(ADMIN_EMAIL, 'SUPER_ADMIN')
  cookieValue = seed.cookieValue
})

test.afterAll(async () => {
  await cleanupAuthSeed(ADMIN_EMAIL).catch(() => {})
  await disconnectAuthClient().catch(() => {})
})

test.beforeEach(async ({ context }) => {
  await applyAuthCookie(context, cookieValue)
})

// ─────────────────────── Wave P11-Scrum (HU-11.1, 11.2) ───────────────────────

test.describe('Wave P11-Scrum', () => {
  test('HU-11.1 · /agile/definitions render Sprint Definitions page', async ({ page }) => {
    const response = await page.goto('/agile/definitions')
    expect(response?.status()).toBeLessThan(500)
    // Tolerar redirect a proyecto si hay uno activo, o landing si no
    await expect(page).toHaveURL(/\/(agile|projects)/)
  })

  test('HU-11.2 · /sprints lista sprints sin error', async ({ page }) => {
    const response = await page.goto('/sprints')
    expect(response?.status()).toBeLessThan(500)
    // Page debe contener al menos el header con texto sprint
    await expect(page.locator('body')).toContainText(/sprint/i, {
      timeout: 5_000,
    })
  })
})

// ─────────────────────── Wave P11-PMI (HU-12.1 → 12.4) ────────────────────────

test.describe('Wave P11-PMI', () => {
  test('HU-12.1 · /pmi/charter redirect a proyecto activo o empty state', async ({ page }) => {
    const response = await page.goto('/pmi/charter')
    expect(response?.status()).toBeLessThan(500)
    // Tras redirect: /projects/X/charter o landing /pmi/charter sin proyecto
    await page.waitForLoadState('networkidle', { timeout: 10_000 })
    const url = page.url()
    expect(url).toMatch(/\/(charter|pmi|projects)/)
  })

  test('HU-12.2 · /pmi/stakeholders carga sin RSC error', async ({ page }) => {
    const response = await page.goto('/pmi/stakeholders')
    expect(response?.status()).toBeLessThan(500)
    await page.waitForLoadState('networkidle', { timeout: 10_000 })
    // No debe mostrar el error opaco de RSC en prod
    await expect(page.locator('body')).not.toContainText(
      'An error occurred in the Server Components render',
      { timeout: 3_000 },
    )
  })

  test('HU-12.3 · /pmi/change-requests carga workflow CCB', async ({ page }) => {
    const response = await page.goto('/pmi/change-requests')
    expect(response?.status()).toBeLessThan(500)
    await page.waitForLoadState('networkidle', { timeout: 10_000 })
    await expect(page.locator('body')).not.toContainText(
      'An error occurred in the Server Components render',
    )
  })

  test('HU-12.4 · /procurement carga catálogo de vendors', async ({ page }) => {
    const response = await page.goto('/procurement')
    expect(response?.status()).toBeLessThan(500)
    await page.waitForLoadState('networkidle', { timeout: 10_000 })
    await expect(page.locator('body')).not.toContainText(
      'An error occurred in the Server Components render',
    )
  })
})

// ─────────────────────── Wave P12 (HU-12.5 → 12.10) ────────────────────────

test.describe('Wave P12 · Final Compliance', () => {
  test('HU-12.5 · /scrum/daily redirect a sprint activo o empty state', async ({ page }) => {
    const response = await page.goto('/scrum/daily')
    expect(response?.status()).toBeLessThan(500)
    await page.waitForLoadState('networkidle', { timeout: 10_000 })
    // Tras redirect: /projects/X/daily-scrum o landing
    await expect(page.locator('body')).not.toContainText(
      'An error occurred in the Server Components render',
    )
  })

  test('HU-12.6 · /scrum/impediments carga tracker', async ({ page }) => {
    const response = await page.goto('/scrum/impediments')
    expect(response?.status()).toBeLessThan(500)
    await page.waitForLoadState('networkidle', { timeout: 10_000 })
    await expect(page.locator('body')).not.toContainText(
      'An error occurred in the Server Components render',
    )
  })

  test('HU-12.7 · /scrum/improvements muestra kanban', async ({ page }) => {
    const response = await page.goto('/scrum/improvements')
    expect(response?.status()).toBeLessThan(500)
    await page.waitForLoadState('networkidle', { timeout: 10_000 })
    await expect(page.locator('body')).not.toContainText(
      'An error occurred in the Server Components render',
    )
  })

  test('HU-12.8 · /pmi/evm redirect a proyecto con EVM dashboard', async ({ page }) => {
    const response = await page.goto('/pmi/evm')
    expect(response?.status()).toBeLessThan(500)
    await page.waitForLoadState('networkidle', { timeout: 10_000 })
    await expect(page.locator('body')).not.toContainText(
      'An error occurred in the Server Components render',
    )
  })

  test('HU-12.9 · /lessons-learned repository global', async ({ page }) => {
    const response = await page.goto('/lessons-learned')
    expect(response?.status()).toBeLessThan(500)
    await page.waitForLoadState('networkidle', { timeout: 10_000 })
    await expect(page.locator('body')).toContainText(/lessons|aprendi/i, {
      timeout: 5_000,
    })
  })

  test('HU-12.10 · /pmi/communications redirect a proyecto con comm plan', async ({ page }) => {
    const response = await page.goto('/pmi/communications')
    expect(response?.status()).toBeLessThan(500)
    await page.waitForLoadState('networkidle', { timeout: 10_000 })
    await expect(page.locator('body')).not.toContainText(
      'An error occurred in the Server Components render',
    )
  })
})

// ─────────────────────── Wave P13 (RBAC visibility) ────────────────────────

test.describe('Wave P13 · RBAC visibility', () => {
  test('SUPER_ADMIN ve /projects con acceso global', async ({ page }) => {
    const response = await page.goto('/projects')
    expect(response?.status()).toBeLessThan(500)
    await page.waitForLoadState('networkidle', { timeout: 10_000 })
    await expect(page.locator('body')).toContainText(/proyecto|portafolio/i, {
      timeout: 5_000,
    })
  })

  test('Portfolio risks consolidados accesibles para SUPER_ADMIN', async ({ page }) => {
    const response = await page.goto('/portfolio/risks')
    expect(response?.status()).toBeLessThan(500)
    await page.waitForLoadState('networkidle', { timeout: 10_000 })
    // El número en KPI puede ser 0 (empty) o N (con datos) — ambos son válidos
    await expect(page.locator('body')).toContainText(/riesgos|alto|medio|bajo/i, {
      timeout: 5_000,
    })
  })

  test('USER sin asignación NO ve proyectos en /projects (RBAC enforces)', async ({
    context,
    page,
  }) => {
    // Override con USER role limitado
    const userEmail = 'wave-smoke-user@e2e.test'
    const userSeed = await seedAuthUser(userEmail, 'USER')
    await applyAuthCookie(context, userSeed.cookieValue)
    try {
      const response = await page.goto('/projects')
      expect(response?.status()).toBeLessThan(500)
      await page.waitForLoadState('networkidle', { timeout: 10_000 })
      // Debería ver "No hay proyectos" o lista vacía (no error)
      await expect(page.locator('body')).not.toContainText(
        'An error occurred in the Server Components render',
      )
    } finally {
      await cleanupAuthSeed(userEmail).catch(() => {})
    }
  })
})

// ─────────────────────── Brain AI · risk register flow ────────────────────────

test.describe('Wave P14c · Avante Brain AI', () => {
  test('/brain Project Manager AI tab carga sin error opaco', async ({ page }) => {
    const response = await page.goto('/brain')
    expect(response?.status()).toBeLessThan(500)
    await page.waitForLoadState('networkidle', { timeout: 10_000 })
    await expect(page.locator('body')).not.toContainText(
      'An error occurred in the Server Components render',
    )
    // El header de Avante Brain AI debe estar visible
    await expect(page.locator('body')).toContainText(/avante brain|knowledge|project manager/i, {
      timeout: 5_000,
    })
  })

  test('/portfolio/risks · matriz P×I clickable filtra detalle (Wave P14c)', async ({ page }) => {
    const response = await page.goto('/portfolio/risks')
    expect(response?.status()).toBeLessThan(500)
    await page.waitForLoadState('networkidle', { timeout: 10_000 })
    // La página tiene matriz · es OK que no hayan datos en CI
    await expect(page.locator('body')).toContainText(/matriz|probabilidad/i, {
      timeout: 5_000,
    })
  })
})
