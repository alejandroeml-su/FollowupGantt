/**
 * Wave P17-B · Tipos puros de eventos webhooks v2.
 *
 * NO contiene `'server-only'` ni dependencias Prisma — los client components
 * (settings UI) lo importan para hidratar selectores de eventos.
 *
 * Eventos canónicos v2:
 *   - `task.created`              · payload: snapshot mínimo de la task creada
 *   - `risk.high_severity`        · payload: risk con severity ∈ {HIGH, CRITICAL}
 *   - `project.status_changed`    · payload: { project, previousStatus, newStatus }
 */

export type V2EventType =
  | 'task.created'
  | 'risk.high_severity'
  | 'project.status_changed'

export const KNOWN_V2_EVENTS: readonly V2EventType[] = [
  'task.created',
  'risk.high_severity',
  'project.status_changed',
]

const KNOWN_SET = new Set<string>(KNOWN_V2_EVENTS)

export function validateV2Events(input: unknown): V2EventType[] {
  if (!Array.isArray(input)) return []
  const out: V2EventType[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    if (!KNOWN_SET.has(raw)) continue
    if (seen.has(raw)) continue
    seen.add(raw)
    out.push(raw as V2EventType)
  }
  return out
}
