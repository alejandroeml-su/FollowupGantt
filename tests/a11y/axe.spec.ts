import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// EPIC-001 · @QA · auditoría axe.
// Sprint 5: tras el rediseño del formulario y los chips de prioridad/estado
// con role=radiogroup correcto, se redujo el número de violaciones serious.
// Baseline endurecido de 50 a 10 (5 sobre el peor caso medido + 5 holgura).
// TODO(EPIC-001-QA): varias violaciones WCAG 2.1 AA de contraste (wcag143)
// fueron detectadas en la UI dark existente (antes del EPIC-001 también).
// Sprint posterior de @UIUX debe ajustar slate-500/slate-600 sobre slate-950
// para alcanzar ratio 4.5:1.
const ROUTES = ['/list', '/kanban', '/gantt', '/table'] as const

const BASELINE_MAX_SERIOUS = 10

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

    // Baseline endurecido en Sprint 5 (antes <50). El test pasa para no
    // bloquear el CI, pero cualquier subida sobre `BASELINE_MAX_SERIOUS`
    // = revisar. Si se reduce más, bajar este número y commitear.
    expect(serious.length).toBeLessThan(BASELINE_MAX_SERIOUS)
  })
}
