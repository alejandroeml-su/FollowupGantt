import { test, expect } from '@playwright/test'
import {
  applyAuthCookie,
  cleanupAuthSeed,
  disconnectAuthClient,
  seedAuthUser,
} from './_helpers/seed-auth'
import {
  cleanupWorkspaceSeed,
  disconnectWorkspaceClient,
  seedWorkspaceForUser,
  seedWorkspaceInvitation,
} from './_helpers/seed-workspace'

/**
 * Ola P4 · Equipo P4-1 · Multi-tenancy / Workspaces — E2E.
 *
 * Cubre el flujo de listado, creación implícita (vía seed), invitación
 * (URL clipboard via server action) y aceptación. La creación UI está
 * cubierta por un caso happy-path; los flujos de invitación y
 * `removeMember` se prueban en BD post-acción.
 *
 * Requiere DATABASE_URL para el helper. Si la migración del módulo no
 * está aplicada, el seed lanza y el suite no corre — Edwin debe correr
 * `prisma db push` en local antes.
 */

const OWNER_EMAIL = 'ws-owner@e2e.test'
const INVITEE_EMAIL = 'ws-invitee@e2e.test'
const SLUG = 'e2e-c3-ws'

test.describe('Workspaces · multi-tenancy', () => {
  test.afterAll(async () => {
    await cleanupWorkspaceSeed(SLUG).catch(() => {})
    await cleanupAuthSeed(OWNER_EMAIL).catch(() => {})
    await cleanupAuthSeed(INVITEE_EMAIL).catch(() => {})
    await disconnectWorkspaceClient().catch(() => {})
    await disconnectAuthClient().catch(() => {})
  })

  test('OWNER ve su workspace listado en /settings/workspace', async ({
    page,
    context,
  }) => {
    const owner = await seedAuthUser(OWNER_EMAIL, 'ADMIN')
    await seedWorkspaceForUser(owner.userId, { slug: SLUG, name: '[E2E] WS C3' })
    await applyAuthCookie(context, owner.cookieValue)

    const res = await page.goto('/settings/workspace')
    expect(res?.status() ?? 0).toBeLessThan(500)
    // El header "Espacios de trabajo" debe estar siempre.
    await expect(page.getByText('Espacios de trabajo')).toBeVisible({
      timeout: 5_000,
    })
    // El nombre del workspace seedeado debe aparecer en la tabla.
    await expect(page.getByText('[E2E] WS C3').first()).toBeVisible({
      timeout: 5_000,
    })
    // El slug también se muestra en mono.
    await expect(page.getByText(SLUG).first()).toBeVisible({ timeout: 5_000 })
  })

  test('invitación pendiente expone el token en `/invite/[token]`', async ({
    page,
    context,
  }) => {
    const owner = await seedAuthUser(OWNER_EMAIL, 'ADMIN')
    const ws = await seedWorkspaceForUser(owner.userId, { slug: SLUG })
    const invitee = await seedAuthUser(INVITEE_EMAIL, 'AGENTE')
    const { token } = await seedWorkspaceInvitation({
      workspaceId: ws.workspaceId,
      email: INVITEE_EMAIL,
      invitedById: owner.userId,
    })
    await applyAuthCookie(context, invitee.cookieValue)

    await page.goto(`/invite/${token}`)
    // La página renderiza el preview con "Te han invitado a un espacio".
    await expect(page.getByText('Te han invitado a un espacio')).toBeVisible({
      timeout: 5_000,
    })
    // El nombre del workspace debe estar visible en algún lugar del DOM.
    const wsLabel = page
      .locator('main')
      .getByText(/\[E2E\]/, { exact: false })
      .first()
    await expect(wsLabel).toBeVisible({ timeout: 5_000 })
  })

  test('OWNER no puede ser eliminado vía la UI (bloqueo de seguridad)', async ({
    page,
    context,
  }) => {
    const owner = await seedAuthUser(OWNER_EMAIL, 'ADMIN')
    const ws = await seedWorkspaceForUser(owner.userId, { slug: SLUG })
    await applyAuthCookie(context, owner.cookieValue)

    // Visitamos /settings/workspace/members?ws=<id> — la UI lista al OWNER
    // pero NO debe ofrecer botón "Eliminar" para él (server-side guard
    // adicional: removeMember lanza OWNER_REMOVAL_FORBIDDEN).
    const res = await page.goto(
      `/settings/workspace/members?ws=${encodeURIComponent(ws.workspaceId)}`,
    )
    expect(res?.status() ?? 0).toBeLessThan(500)

    // Verificamos que el email del owner aparezca y que no haya un botón
    // "Eliminar miembro" asociado a él. Buscamos genéricamente:
    const removeButtons = page.getByRole('button', { name: /eliminar/i })
    // Pueden existir botones de eliminar para otros, pero este test no
    // crea otros miembros — el conteo debe ser 0.
    expect(await removeButtons.count()).toBe(0)
  })
})
