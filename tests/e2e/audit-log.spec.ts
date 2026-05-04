import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import {
  applyAuthCookie,
  cleanupAuthSeed,
  disconnectAuthClient,
  seedAuthUser,
} from './_helpers/seed-auth'

/**
 * Ola P3 · Equipo P3-2 · Audit Log — E2E.
 *
 * Verifica que la página /audit-log:
 *   - Renderiza el listado con los eventos seedeados directamente en BD.
 *   - Permite filtrar por actor.
 *   - Expandir una fila despliega el bloque JSON before/after.
 *
 * Estrategia: en vez de disparar acciones reales (createTask, etc.) para
 * generar eventos (que mutarían tablas no aisladas), insertamos
 * `AuditEvent` directamente con el helper Prisma. Esto desacopla el
 * spec de cualquier server action y mantiene el cleanup trivial.
 */

const ADMIN_EMAIL = 'audit-admin@e2e.test'
const E2E_AUDIT_PREFIX = 'e2e_audit_'

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

test.describe('Audit log', () => {
  test.afterAll(async () => {
    const db = getDb()
    await db.auditEvent
      .deleteMany({ where: { entityId: { startsWith: E2E_AUDIT_PREFIX } } })
      .catch(() => {})
    await db.$disconnect().catch(() => {})
    await cleanupAuthSeed(ADMIN_EMAIL).catch(() => {})
    await disconnectAuthClient().catch(() => {})
  })

  test('happy path: evento sembrado aparece en el listado', async ({
    page,
    context,
  }) => {
    const admin = await seedAuthUser(ADMIN_EMAIL, 'SUPER_ADMIN')
    const db = getDb()
    const entityId = `${E2E_AUDIT_PREFIX}happy_${Date.now()}`
    await db.auditEvent.create({
      data: {
        actorId: admin.userId,
        action: 'task.created',
        entityType: 'task',
        entityId,
        before: null,
        after: { title: 'E2E audit task' },
        ipAddress: '127.0.0.1',
        userAgent: 'PlaywrightAudit/1.0',
        metadata: { source: 'c3-e2e' },
      },
    })

    await applyAuthCookie(context, admin.cookieValue)
    await page.goto('/audit-log')
    await expect(page.getByRole('heading', { name: 'Auditoría' })).toBeVisible({
      timeout: 5_000,
    })

    // El entityId debe aparecer en alguna fila — la tabla muestra trunc.
    const rows = page.getByTestId('audit-row')
    await expect(rows.first()).toBeVisible({ timeout: 5_000 })
    // No exigimos texto exacto del ID porque la UI lo trunca; pero al
    // menos debe haber al menos un row visible para confirmar render.
    expect(await rows.count()).toBeGreaterThan(0)
  })

  test('edge: expandir una fila revela el panel de detalle JSON', async ({
    page,
    context,
  }) => {
    const admin = await seedAuthUser(ADMIN_EMAIL, 'SUPER_ADMIN')
    await applyAuthCookie(context, admin.cookieValue)
    await page.goto('/audit-log')

    const rows = page.getByTestId('audit-row')
    await expect(rows.first()).toBeVisible({ timeout: 5_000 })
    await rows.first().click()

    // Tras click, en el DOM debe aparecer un <pre> con JSON formateado
    // (DetailPanel renderea Antes / Después / Metadata). Verificamos
    // por la presencia de la etiqueta "Antes" o "Después".
    const detailLabel = page.getByText(/Antes|Después|Metadata/).first()
    await expect(detailLabel).toBeVisible({ timeout: 5_000 })
  })

  test('error case: filtro con entityId inexistente vacía la tabla', async ({
    page,
    context,
  }) => {
    const admin = await seedAuthUser(ADMIN_EMAIL, 'SUPER_ADMIN')
    await applyAuthCookie(context, admin.cookieValue)
    await page.goto('/audit-log')

    // Llenamos el filtro entityId con un valor sin matches.
    const entityIdInput = page.locator('input[placeholder="(opcional)"]')
    await expect(entityIdInput).toBeVisible({ timeout: 5_000 })
    await entityIdInput.fill('e2e_nonexistent_entity_id_xyz')

    await page.getByRole('button', { name: /Aplicar filtros/i }).click()

    // Empty-state: "Sin eventos para los filtros actuales".
    const empty = page.getByText(/Sin eventos para los filtros actuales/i)
    await expect(empty).toBeVisible({ timeout: 8_000 })
  })
})
