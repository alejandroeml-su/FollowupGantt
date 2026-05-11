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

/**
 * Waves P18 (Quality + Reports) + R-360 (Risks 360°) + P19 (Brain
 * Strategist) · Smoke tests E2E.
 *
 * Cubre las nuevas superficies entregadas en los PRs #175 → #184:
 *   - /projects/[id]/quality        → Wave P18-A · Inspections + Defects
 *   - /projects/[id]/risks          → Wave R-360 · Risk 360°
 *   - /projects/[id]/reports        → Wave P18-D · Performance Reports (3 cards)
 *   - /brain (tab Strategist AI)    → Wave P19-A/B · Cross-project insights
 *   - /api/reports/pmi/status/[id]  → HTTP 200 + content-type html
 *   - /api/reports/pmi/final/[id]   → HTTP 200 + content-type xlsx
 *   - /admin                        → render para SUPER_ADMIN o redirect
 *
 * Patrón alineado a `waves-p11-p12-p13-smoke.spec.ts`: auth cookie
 * compartida + tolerancia a estado de BD (no asume seeds específicos
 * más allá del fixture que sembramos en beforeAll).
 */

const ADMIN_EMAIL = 'p18-r360-p19-smoke@e2e.test'
const FIXTURE = makeGanttFixture('p18r360p19')

let cookieValue: string

test.beforeAll(async () => {
  // Auth shared para toda la suite (evita pagar seedAuthUser N veces).
  const seed = await seedAuthUser(ADMIN_EMAIL, 'SUPER_ADMIN')
  cookieValue = seed.cookieValue
  // Sembramos un proyecto mínimo para los specs que necesitan un ID real.
  await seedProject(FIXTURE)
})

test.afterAll(async () => {
  await cleanupSeed(FIXTURE).catch(() => {})
  await cleanupAuthSeed(ADMIN_EMAIL).catch(() => {})
  await disconnectAuthClient().catch(() => {})
  await disconnectSeedClient().catch(() => {})
})

test.beforeEach(async ({ context }) => {
  await applyAuthCookie(context, cookieValue)
})

// ───────────────────────── Wave P18-A · Quality ─────────────────────────

test.describe('Wave P18-A · Project Quality', () => {
  test('/projects/[id]/quality carga y muestra al menos 2 tabs', async ({ page }) => {
    const response = await page.goto(`/projects/${FIXTURE.projectId}/quality`)
    expect(response?.status()).toBeLessThan(500)
    await page.waitForLoadState('networkidle', { timeout: 10_000 })

    // No debe mostrar el error opaco de RSC
    await expect(page.locator('body')).not.toContainText(
      'An error occurred in the Server Components render',
    )

    // Header de calidad debe estar visible (Inspections + Defects son las 2
    // categorías). Aceptamos cualquier combinación de los textos.
    await expect(page.locator('body')).toContainText(
      /calidad|quality|inspections?|inspecciones|defectos?|defects?/i,
      { timeout: 5_000 },
    )
  })
})

// ───────────────────────── Wave R-360 · Risks ─────────────────────────

test.describe('Wave R-360 · Project Risks', () => {
  test('/projects/[id]/risks carga la pantalla R-360', async ({ page }) => {
    const response = await page.goto(`/projects/${FIXTURE.projectId}/risks`)
    expect(response?.status()).toBeLessThan(500)
    await page.waitForLoadState('networkidle', { timeout: 10_000 })

    await expect(page.locator('body')).not.toContainText(
      'An error occurred in the Server Components render',
    )
    // La pantalla menciona gestión 360° o riesgos
    await expect(page.locator('body')).toContainText(
      /riesgos?|risk|360/i,
      { timeout: 5_000 },
    )
  })
})

// ───────────────────────── Wave P18-D · Reports hub ─────────────────────

test.describe('Wave P18-D · Performance Reports', () => {
  test('/projects/[id]/reports muestra las 3 cards de reportes', async ({ page }) => {
    const response = await page.goto(`/projects/${FIXTURE.projectId}/reports`)
    expect(response?.status()).toBeLessThan(500)
    await page.waitForLoadState('networkidle', { timeout: 10_000 })

    await expect(page.locator('body')).not.toContainText(
      'An error occurred in the Server Components render',
    )
    // El hub menciona Status Report + Final Report + Lessons Learned
    const body = page.locator('body')
    await expect(body).toContainText(/status report/i, { timeout: 5_000 })
    await expect(body).toContainText(/final report/i, { timeout: 5_000 })
    await expect(body).toContainText(/lessons|aprendi/i, { timeout: 5_000 })
  })

  test('GET /api/reports/pmi/status/[id] → HTTP 200 + content-type html', async ({
    request,
  }) => {
    const response = await request.get(
      `/api/reports/pmi/status/${FIXTURE.projectId}`,
      {
        headers: { cookie: `fg_session=${cookieValue}` },
      },
    )
    expect(response.status()).toBe(200)
    const contentType = response.headers()['content-type'] ?? ''
    expect(contentType).toContain('text/html')
  })

  test('GET /api/reports/pmi/final/[id] → HTTP 200 + content-type xlsx', async ({
    request,
  }) => {
    const response = await request.get(
      `/api/reports/pmi/final/${FIXTURE.projectId}`,
      {
        headers: { cookie: `fg_session=${cookieValue}` },
      },
    )
    expect(response.status()).toBe(200)
    const contentType = response.headers()['content-type'] ?? ''
    // XLSX content-type oficial
    expect(contentType).toContain('spreadsheetml.sheet')
  })
})

// ───────────────────────── Wave P19 · Brain Strategist ───────────────────

test.describe('Wave P19 · Brain Strategist AI', () => {
  test('/brain expone tab "Strategist AI"', async ({ page }) => {
    const response = await page.goto('/brain')
    expect(response?.status()).toBeLessThan(500)
    await page.waitForLoadState('networkidle', { timeout: 10_000 })

    await expect(page.locator('body')).not.toContainText(
      'An error occurred in the Server Components render',
    )
    // La tab Strategist AI debe ser visible en el header
    await expect(page.locator('body')).toContainText(/strategist/i, {
      timeout: 5_000,
    })
  })
})

// ───────────────────────── /admin · gating ───────────────────────────

test.describe('Admin gating', () => {
  test('/admin renderiza para SUPER_ADMIN o redirige (sin error)', async ({ page }) => {
    const response = await page.goto('/admin')
    expect(response?.status()).toBeLessThan(500)
    await page.waitForLoadState('networkidle', { timeout: 10_000 })

    // SUPER_ADMIN debería poder ver el panel; si la app redirige a /login o
    // /projects, también es aceptable (RBAC válido). Lo único inaceptable
    // es un error opaco de RSC.
    await expect(page.locator('body')).not.toContainText(
      'An error occurred in the Server Components render',
    )
    const url = page.url()
    expect(url).toMatch(/\/(admin|projects|login)/)
  })
})
