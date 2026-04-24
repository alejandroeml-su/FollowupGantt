import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const ROUTES = ['/list', '/kanban', '/gantt', '/table'] as const

for (const route of ROUTES) {
  test(`axe :: ${route} sin violaciones serious/critical`, async ({ page }) => {
    await page.goto(route)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    const critical = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    )
    expect(critical, JSON.stringify(critical, null, 2)).toEqual([])
  })
}
