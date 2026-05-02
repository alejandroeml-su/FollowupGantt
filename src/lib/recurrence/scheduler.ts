import 'server-only'

/**
 * Ola P2 · Equipo P2-3 — Scheduler de RecurrenceRule.
 *
 * `scheduleAll` itera sobre todas las reglas activas y genera tasks
 * pendientes desde `lastGeneratedAt` hasta `now`. Diseñado para
 * invocarse:
 *   - Vía Vercel Cron (configuración SRE) golpeando `/api/cron/recurrence`.
 *   - Manualmente desde la UI de admin para forzar catch-up.
 *
 * Idempotencia: cada `instantiateFromTemplate` consulta la combinación
 * `(recurrenceRuleId, occurrenceDate)` y devuelve la task pre-existente
 * si la hay. Además la `@@unique` en Task previene duplicados a nivel BD.
 *
 * Decisiones autónomas:
 *   D-SCH-1: Procesamos las reglas en serie para mantener bajo el footprint
 *            de conexiones (recordar Supabase pool=1). Si volumen crece,
 *            paralelizar con `Promise.allSettled` en chunks.
 *   D-SCH-2: Errores por regla se aíslan: una regla con template borrado
 *            no detiene el batch. Reportamos en el resumen y seguimos.
 *   D-SCH-3: La protección por token se hace fuera (en el route handler);
 *            esta función NO valida secret — debe ser internal-only.
 */

import prisma from '@/lib/prisma'
import { generateOverdueOccurrences } from '@/lib/actions/recurrence'

export type SchedulerSummary = {
  rulesProcessed: number
  rulesFailed: number
  totalGenerated: number
  totalSkipped: number
  failures: Array<{ ruleId: string; error: string }>
}

export async function scheduleAll(now: Date = new Date()): Promise<SchedulerSummary> {
  const rules = await prisma.recurrenceRule.findMany({
    where: { active: true },
    select: { id: true },
    orderBy: { lastGeneratedAt: 'asc' },
  })

  const summary: SchedulerSummary = {
    rulesProcessed: 0,
    rulesFailed: 0,
    totalGenerated: 0,
    totalSkipped: 0,
    failures: [],
  }

  for (const rule of rules) {
    try {
      const result = await generateOverdueOccurrences(rule.id, now)
      summary.rulesProcessed += 1
      summary.totalGenerated += result.generated
      summary.totalSkipped += result.skipped
    } catch (err) {
      summary.rulesFailed += 1
      const message = err instanceof Error ? err.message : String(err)
      summary.failures.push({ ruleId: rule.id, error: message })
    }
  }

  return summary
}
