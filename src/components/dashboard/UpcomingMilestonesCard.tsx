/**
 * Equipo D3 · UpcomingMilestonesCard — hitos próximos.
 *
 * Server component. Recibe la lista de `UpcomingMilestone` desde el
 * helper `getUpcomingMilestones` y los muestra ordenados por proximidad.
 */

import Link from 'next/link'
import type { UpcomingMilestone } from '@/lib/dashboard/upcoming-milestones'

type Props = {
  items: UpcomingMilestone[]
}

function urgencyTone(daysUntil: number): string {
  if (daysUntil <= 2) return 'text-red-500'
  if (daysUntil <= 7) return 'text-amber-500'
  return 'text-emerald-500'
}

function urgencyLabel(daysUntil: number): string {
  if (daysUntil < 0) return 'Vencido'
  if (daysUntil === 0) return 'Hoy'
  if (daysUntil === 1) return 'Mañana'
  return `En ${daysUntil} días`
}

export function UpcomingMilestonesCard({ items }: Props) {
  return (
    <section
      data-testid="upcoming-milestones-card"
      className="rounded-2xl bg-card border border-border p-6 space-y-4"
    >
      <header className="flex items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-foreground">Hitos próximos</h2>
          <p className="text-xs text-muted-foreground">
            Próximas 2 semanas
          </p>
        </div>
        <Link
          href="/calendar"
          className="text-xs font-semibold text-primary hover:underline"
        >
          Ver calendario →
        </Link>
      </header>

      <ul className="space-y-3">
        {items.length === 0 && (
          <li className="text-sm text-muted-foreground">
            Sin hitos en la ventana cercana.
          </li>
        )}
        {items.map((m) => (
          <li
            key={m.id}
            data-testid={`upcoming-milestone-${m.id}`}
            className="flex items-start justify-between gap-3"
          >
            <div className="min-w-0 flex-1">
              <Link
                href={`/list?project=${m.projectId}&task=${m.id}`}
                className="block truncate text-sm font-medium text-foreground hover:underline"
              >
                {m.title}
              </Link>
              <p className="truncate text-xs text-muted-foreground">
                {m.projectName} ·{' '}
                {new Date(m.endDate).toLocaleDateString('es-MX')}
              </p>
            </div>
            <span
              className={`shrink-0 text-xs font-semibold ${urgencyTone(m.daysUntil)}`}
            >
              {urgencyLabel(m.daysUntil)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
