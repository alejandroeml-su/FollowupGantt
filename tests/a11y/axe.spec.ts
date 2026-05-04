import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// EPIC-001 · @QA · auditoría axe.
// Sprint 5: tras el rediseño del formulario y los chips de prioridad/estado
// con role=radiogroup correcto, se redujo el número de violaciones serious.
// Baseline endurecido de 50 → 10 → 5 (P3-5).
// P3-5 hardening (@UIUX): tokens de contraste subidos en `globals.css`
//   - muted-foreground light slate-600→slate-700 (9.5:1)
//   - muted-foreground dark slate-300→slate-200 (13.5:1, blinda /70 opacity)
//   - placeholder light slate-500→slate-600 (7.2:1 sobre blanco)
//   - placeholder dark slate-400→slate-300 (8.5:1 sobre input)
//   - border light slate-300→slate-400 (3.4:1 NCC AA)
//   - border dark slate-700→slate-500 (3.6:1 NCC AA)
//   - destructive/warning light bumped a tonos -700/-800 para AA
// Objetivo siguiente: 0 violaciones serious/critical (refactor de
// `text-muted-foreground/70` → `text-muted-foreground` en componentes).
const ROUTES = ['/list', '/kanban', '/gantt', '/table'] as const

const BASELINE_MAX_SERIOUS = 5

for (const route of ROUTES) {
  test(`axe :: ${route} · reporte informativo`, async ({ page }) => {
    await page.goto(route)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    )

    if (serious.length > 0) {
      console.warn(
        `[axe] ${route}: ${serious.length} violación(es) serious/critical — ` +
          `deuda @UIUX:\n` +
          serious.map((v) => `  - ${v.id} (${v.help})`).join('\n'),
      )
    }

    // Baseline endurecido P3-5 (50 → 10 → 5). El test pasa para no
    // bloquear el CI, pero cualquier subida sobre `BASELINE_MAX_SERIOUS`
    // = revisar. Si se reduce más, bajar este número y commitear.
    expect(serious.length).toBeLessThan(BASELINE_MAX_SERIOUS)
  })
}
