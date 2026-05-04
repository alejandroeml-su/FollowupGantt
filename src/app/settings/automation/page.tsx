/**
 * Ola P5 · Equipo P5-5 — Listado admin de reglas de automatización.
 */

import { listRules } from '@/lib/actions/automation'
import { AutomationsAdmin } from '@/components/automation/AutomationsAdmin'
import { safeParseRulePersisted } from '@/lib/automation/validation'
import type { AutomationCondition, AutomationAction, AutomationEvent } from '@/lib/automation/types'

export const dynamic = 'force-dynamic'

export default async function SettingsAutomationPage() {
  let rules: Awaited<ReturnType<typeof listRules>> = []
  try {
    rules = await listRules()
  } catch {
    rules = []
  }

  const items = rules.map((r) => {
    const parsed = safeParseRulePersisted({
      id: r.id,
      name: r.name,
      isActive: r.isActive,
      trigger: r.trigger,
      conditions: r.conditions,
      actions: r.actions,
    })
    return {
      id: r.id,
      name: r.name,
      isActive: r.isActive,
      trigger: parsed?.trigger ?? { event: 'form.submitted' as AutomationEvent },
      conditions: (parsed?.conditions ?? []) as AutomationCondition[],
      actions: (parsed?.actions ?? []) as AutomationAction[],
      _count: r._count,
    }
  })

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8 bg-subtle/50">
        <div>
          <h1 className="text-xl font-semibold text-white">Automatizaciones</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Reglas if-this-then-that para reaccionar a eventos del sistema.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl">
          <AutomationsAdmin initialRules={items} />
        </div>
      </div>
    </div>
  )
}
