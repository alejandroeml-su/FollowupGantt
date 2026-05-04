/**
 * Ola P7 · Equipo P7-4 · Daily Standup — Fallback heurístico (sin LLM).
 *
 * Convierte un `StandupContext` en un `Standup` válido sin llamar a
 * Anthropic. Útil cuando:
 *   - `ANTHROPIC_API_KEY` no está configurada (dev local, CI).
 *   - El LLM falla / timeout (el wrapper en `generate-standup.ts` cae
 *     a esta heurística para no romper el cron).
 *
 * Determinista: misma entrada → mismo output. No usa randomness ni
 * `Date.now()` (la fecha viene del context).
 *
 * Estilo: bullet points secos, sin narrativa adornada. Cubre el contrato
 * (todos los campos zod) pero el LLM real va a producir un texto mucho
 * más legible.
 */

import type { Standup } from './standup-schema'
import type {
  StandupContext,
  StandupTaskSnapshot,
  BlockerReason,
} from './build-standup-context'

// ─────────────────────────── Helpers ───────────────────────────────────

const BLOCKER_LABELS: Record<BlockerReason, string> = {
  OVERDUE: 'vencida',
  NO_ASSIGNEE: 'sin asignar',
  BROKEN_DEPENDENCY: 'dependencia rota',
  STALE: 'sin actualización reciente',
}

const BLOCKER_SUGGESTIONS: Record<BlockerReason, string> = {
  OVERDUE: 'Replanificar fecha o escalar al PM',
  NO_ASSIGNEE: 'Asignar responsable hoy',
  BROKEN_DEPENDENCY: 'Revisar predecesor incumplido',
  STALE: 'Pedir update al responsable',
}

function userKey(t: StandupTaskSnapshot): string {
  return t.assigneeName ?? t.assigneeEmail ?? 'Sin asignar'
}

interface UserBucket {
  user: string
  items: string[]
}

function groupByUser(tasks: StandupTaskSnapshot[]): UserBucket[] {
  const map = new Map<string, string[]>()
  for (const t of tasks) {
    const user = userKey(t)
    const arr = map.get(user) ?? []
    const itemPrefix = t.isMilestone ? 'Hito: ' : ''
    const projectSuffix = t.projectName ? ` (${t.projectName})` : ''
    arr.push(`${itemPrefix}${t.title}${projectSuffix}`)
    map.set(user, arr)
  }
  return Array.from(map.entries())
    .map(([user, items]) => ({
      user,
      items: items.slice(0, 10), // schema: máx 10
    }))
    .sort((a, b) => a.user.localeCompare(b.user))
}

function buildBlockers(tasks: StandupTaskSnapshot[]): Array<{
  user: string
  description: string
  suggestedAction?: string
}> {
  return tasks.slice(0, 60).map((t) => {
    const reason = t.blockerReason ?? 'OVERDUE'
    const projectSuffix = t.projectName ? ` (${t.projectName})` : ''
    return {
      user: userKey(t),
      description: `${t.title}${projectSuffix} — ${BLOCKER_LABELS[reason]}`,
      suggestedAction: BLOCKER_SUGGESTIONS[reason],
    }
  })
}

function trimText(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

// ─────────────────────────── Builder principal ─────────────────────────

export interface HeuristicStandupOptions {
  /** Tono visible en el summaryFull. Default `formal`. */
  tone?: 'formal' | 'casual'
}

/**
 * Construye un Standup válido contra el `standupSchema` directamente
 * desde el contexto, sin LLM.
 */
export function buildHeuristicStandup(
  ctx: StandupContext,
  opts: HeuristicStandupOptions = {},
): Standup {
  const yesterday = groupByUser(ctx.yesterday)
  const today = groupByUser(ctx.today)
  const blockers = buildBlockers(ctx.blockers)

  const totals = {
    done: ctx.yesterday.length,
    inProgress: ctx.today.length,
    blocked: ctx.blockers.length,
    milestones: ctx.meta.upcomingMilestones.length,
  }

  const tone = opts.tone ?? 'formal'
  const opener =
    tone === 'casual' ? 'Buen día equipo,' : 'Reporte de avance:'

  const summaryShort = trimText(
    `${opener} ${totals.done} completadas, ${totals.inProgress} en curso, ${totals.blocked} bloqueos${
      totals.milestones > 0 ? `, ${totals.milestones} hitos próximos` : ''
    }.`,
    240,
  )

  const lines: string[] = []
  if (ctx.scope === 'project' && ctx.meta.projectName) {
    lines.push(`**Proyecto:** ${ctx.meta.projectName}`)
  }
  lines.push(`**Fecha:** ${ctx.date}`)
  lines.push(
    `**Ayer:** ${totals.done} tareas completadas${
      totals.done > 0
        ? ` (${ctx.yesterday
            .slice(0, 3)
            .map((t) => t.title)
            .join(', ')}${totals.done > 3 ? '…' : ''})`
        : ''
    }.`,
  )
  lines.push(
    `**Hoy:** ${totals.inProgress} tareas en progreso${
      totals.milestones > 0
        ? ` y ${totals.milestones} hitos próximos`
        : ''
    }.`,
  )
  if (totals.blocked > 0) {
    lines.push(
      `**Bloqueos:** ${totals.blocked} (${ctx.blockers
        .slice(0, 3)
        .map((t) => `${t.title}: ${BLOCKER_LABELS[t.blockerReason ?? 'OVERDUE']}`)
        .join('; ')}${totals.blocked > 3 ? '…' : ''}).`,
    )
  } else {
    lines.push('**Bloqueos:** ninguno detectado.')
  }
  if (ctx.meta.upcomingMilestones.length > 0) {
    const next = ctx.meta.upcomingMilestones[0]
    lines.push(
      `**Próximo hito:** ${next.title} (${next.endDate.toISOString().slice(0, 10)}).`,
    )
  }

  const summaryFull = trimText(lines.join('\n'), 2000)

  return {
    date: ctx.date,
    participants: ctx.meta.participants,
    yesterday: yesterday.length > 0 ? yesterday : [],
    today: today.length > 0 ? today : [],
    blockers,
    summaryShort,
    summaryFull,
  }
}
