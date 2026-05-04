import { test, expect } from '@playwright/test'
import {
  applyAuthCookie,
  cleanupAuthSeed,
  disconnectAuthClient,
  seedAuthUser,
} from './_helpers/seed-auth'
import {
  cleanupDocSeed,
  disconnectDocClient,
  seedDoc,
} from './_helpers/seed-doc'

/**
 * Ola P2 · Equipo P2-5 · Docs / Wikis — E2E.
 *
 * Cubre:
 *   - Happy path: el doc seedeado aparece en el sidebar tree.
 *   - Edge: navegar a /docs?id=<id> abre el editor con título y textarea.
 *   - Error: el doc archivado NO aparece en el listado por default.
 */

const AUTHOR_EMAIL = 'docs-author@e2e.test'
const DOC_SLUG = 'e2e-c3-docs'
const ARCHIVED_SLUG = 'e2e-c3-docs-archived'

test.describe('Docs / Wikis', () => {
  test.afterAll(async () => {
    await cleanupDocSeed(DOC_SLUG).catch(() => {})
    await cleanupDocSeed(ARCHIVED_SLUG).catch(() => {})
    await cleanupAuthSeed(AUTHOR_EMAIL).catch(() => {})
    await disconnectDocClient().catch(() => {})
    await disconnectAuthClient().catch(() => {})
  })

  test('doc seedeado aparece en el sidebar tree', async ({ page, context }) => {
    const author = await seedAuthUser(AUTHOR_EMAIL, 'AGENTE')
    await seedDoc({ slug: DOC_SLUG, authorId: author.userId })
    await applyAuthCookie(context, author.cookieValue)

    const res = await page.goto('/docs')
    expect(res?.status() ?? 0).toBeLessThan(500)

    // Sidebar debe estar montado.
    const sidebar = page.getByTestId('docs-sidebar')
    await expect(sidebar).toBeVisible({ timeout: 5_000 })

    // El título seedeado aparece en alguna fila del tree.
    await expect(
      page.getByText(`[E2E Doc] ${DOC_SLUG}`).first(),
    ).toBeVisible({ timeout: 5_000 })
  })

  test('navegar a /docs?id=<id> abre el editor', async ({ page, context }) => {
    const author = await seedAuthUser(AUTHOR_EMAIL, 'AGENTE')
    const seeded = await seedDoc({
      slug: DOC_SLUG,
      authorId: author.userId,
      content: '# E2E doc body',
    })
    await applyAuthCookie(context, author.cookieValue)

    await page.goto(`/docs?id=${seeded.docId}`)
    const editor = page.getByTestId('doc-editor')
    await expect(editor).toBeVisible({ timeout: 5_000 })
    const title = page.getByTestId('doc-editor-title')
    await expect(title).toHaveValue(/E2E Doc/, { timeout: 5_000 })
    const textarea = page.getByTestId('doc-editor-textarea')
    await expect(textarea).toBeVisible()
    await expect(textarea).toContainText('E2E doc body')
  })

  test('doc archivado no aparece en el listado por default', async ({
    page,
    context,
  }) => {
    const author = await seedAuthUser(AUTHOR_EMAIL, 'AGENTE')
    // Seed un doc y luego lo marcamos como archivado vía Prisma directo.
    const archived = await seedDoc({
      slug: ARCHIVED_SLUG,
      authorId: author.userId,
      title: '[E2E Doc] archivado-x',
    })
    // Archivar manualmente.
    const { PrismaClient } = await import('@prisma/client')
    const { PrismaPg } = await import('@prisma/adapter-pg')
    const { Pool } = await import('pg')
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
    await prisma.doc.update({
      where: { id: archived.docId },
      data: { isArchived: true },
    })
    await prisma.$disconnect().catch(() => {})

    await applyAuthCookie(context, author.cookieValue)
    await page.goto('/docs')

    // Esperamos render del sidebar.
    await expect(page.getByTestId('docs-sidebar')).toBeVisible({
      timeout: 5_000,
    })

    // El título del doc archivado NO debe aparecer en el tree visible.
    const archivedTitle = page.getByText('[E2E Doc] archivado-x')
    expect(await archivedTitle.count()).toBe(0)
  })
})
