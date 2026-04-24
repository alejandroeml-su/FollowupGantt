import { test, expect } from '@playwright/test'

/**
 * EPIC-001 · @QA · Preservación de filtros entre vistas (Sprint 4).
 * Depende de que el seed cree al menos 1 tarea visible en cada vista.
 */

test.describe('ViewSwitcher · filter preservation', () => {
  test('filtros sobreviven al navegar List → Kanban', async ({ page }) => {
    await page.goto('/list?status=TODO&assignee=u1')
    const kanbanTab = page.getByRole('tab', { name: /Kanban/i })
    await kanbanTab.click()
    await expect(page).toHaveURL(/\/kanban\?.*status=TODO/)
    await expect(page).toHaveURL(/assignee=u1/)
  })

  test('month se descarta al salir de /gantt', async ({ page }) => {
    await page.goto('/gantt?month=2026-05&priority=HIGH')
    await page.getByRole('tab', { name: /List/i }).click()
    await expect(page).not.toHaveURL(/month=/)
    await expect(page).toHaveURL(/priority=HIGH/)
  })

  test('month se preserva al entrar a /gantt', async ({ page }) => {
    await page.goto('/list?month=2026-05')
    await page.getByRole('tab', { name: /Gantt/i }).click()
    await expect(page).toHaveURL(/month=2026-05/)
  })
})

test.describe('GlobalBreadcrumbs', () => {
  test('marca la última ruta como aria-current="page"', async ({ page }) => {
    await page.goto('/projects')
    const crumb = page.getByText('Proyectos').last()
    await expect(crumb).toHaveAttribute('aria-current', 'page')
  })
})
