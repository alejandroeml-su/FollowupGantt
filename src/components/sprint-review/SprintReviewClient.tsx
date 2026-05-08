'use client'

/**
 * Wave P11-Scrum (HU-11.2) — Sprint Review UI.
 *
 * Layout (top→bottom):
 *   1. Hero: Sprint name + Goal + estado del Review (open/closed)
 *   2. KPI strip: SP delivered/carried-over · % completion · velocity
 *   3. Increment list (tasks DONE) con assignee + SP — el "qué se entregó"
 *   4. Carry-over list (tasks no done) con motivo implícito en status
 *   5. Demo URL editable + reviewNotes textarea
 *   6. CTA "Cerrar Sprint Review" (markSprintReviewed)
 */

import { useState, useTransition } from 'react'
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  Film,
  Loader2,
  Target as TargetIcon,
  TrendingUp,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { clsx } from 'clsx'
import { useUIStore } from '@/lib/stores/ui'
import { markSprintReviewed } from '@/lib/actions/sprint-review'
import type { SprintReviewSnapshot } from '@/lib/actions/sprint-review'
import { toast } from '@/components/interactions/Toaster'

const STATUS_TONE: Record<string, string> = {
  TODO: 'bg-slate-500/15 text-slate-300',
  IN_PROGRESS: 'bg-indigo-500/15 text-indigo-300',
  REVIEW: 'bg-violet-500/15 text-violet-300',
}

type Props = {
  data: SprintReviewSnapshot
}

export function SprintReviewClient({ data }: Props) {
  const router = useRouter()
  const openDrawer = useUIStore((s) => s.openDrawer)
  const [demoUrl, setDemoUrl] = useState(data.sprint.demoUrl ?? '')
  const [notes, setNotes] = useState(data.sprint.reviewNotes ?? '')
  const [isPending, startTransition] = useTransition()

  const isReviewed = !!data.sprint.reviewedAt

  const handleClose = () => {
    startTransition(async () => {
      try {
        await markSprintReviewed({
          sprintId: data.sprint.id,
          reviewNotes: notes.trim() || undefined,
          demoUrl: demoUrl.trim() || null,
        })
        toast.success('Sprint Review cerrado')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al cerrar')
      }
    })
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Hero · Sprint Goal + status */}
      <section
        className={clsx(
          'rounded-xl border p-5',
          isReviewed
            ? 'border-emerald-500/40 bg-emerald-500/5'
            : 'border-indigo-500/30 bg-indigo-500/5',
        )}
      >
        <div className="flex items-start gap-3">
          <TargetIcon
            className={clsx(
              'h-6 w-6 shrink-0',
              isReviewed ? 'text-emerald-400' : 'text-indigo-300',
            )}
          />
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <h2 className="text-base font-bold text-foreground">
                {data.sprint.name}
              </h2>
              {isReviewed ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" /> Reviewed{' '}
                  <time dateTime={data.sprint.reviewedAt!}>
                    {new Date(data.sprint.reviewedAt!).toLocaleDateString('es-MX')}
                  </time>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
                  Pendiente de Review
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {new Date(data.sprint.startDate).toLocaleDateString('es-MX')}{' '}
              →{' '}
              {new Date(data.sprint.endDate).toLocaleDateString('es-MX')}
            </p>
            {data.sprint.goal ? (
              <blockquote className="mt-3 border-l-2 border-indigo-400/60 pl-3 text-sm italic text-foreground/90">
                🎯 {data.sprint.goal}
              </blockquote>
            ) : (
              <p className="mt-3 text-xs italic text-muted-foreground">
                Sprint sin Goal definido — anti-patrón Scrum.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          label="SP entregados"
          value={String(data.totals.spDelivered)}
          tone="emerald"
        />
        <Kpi
          label="SP arrastrados"
          value={String(data.totals.spCarriedOver)}
          tone={data.totals.spCarriedOver > 0 ? 'amber' : 'slate'}
        />
        <Kpi
          label="% completion"
          value={`${data.totals.completionPercent}%`}
          tone={
            data.totals.completionPercent >= 80
              ? 'emerald'
              : data.totals.completionPercent >= 50
                ? 'amber'
                : 'rose'
          }
        />
        <Kpi
          label="Velocity actual"
          value={
            data.sprint.velocityActual != null
              ? String(data.sprint.velocityActual)
              : '—'
          }
          subtitle={
            data.sprint.capacity != null
              ? `de ${data.sprint.capacity} cap`
              : undefined
          }
          tone="indigo"
        />
      </section>

      {/* Increment · DONE tasks */}
      <section className="rounded-xl border border-border bg-card p-5">
        <header className="mb-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-foreground">
            Increment entregado
          </h3>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {data.totals.doneTasks} task{data.totals.doneTasks === 1 ? '' : 's'}{' '}
            · {data.totals.spDelivered} SP
          </span>
        </header>

        {data.completedTasks.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-input/20 px-4 py-6 text-center text-xs italic text-muted-foreground">
            Sin tasks DONE en este sprint. ¿No se logró el Sprint Goal?
          </p>
        ) : (
          <ul className="space-y-1.5">
            {data.completedTasks.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5"
              >
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <button
                  type="button"
                  onClick={() => openDrawer(t.id)}
                  className="flex-1 truncate text-left text-xs text-foreground hover:text-indigo-300 hover:underline"
                  title={`Abrir ${t.title}`}
                >
                  {t.mnemonic && (
                    <span className="font-mono opacity-60">{t.mnemonic} · </span>
                  )}
                  {t.title}
                </button>
                {t.storyPoints != null && (
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                    {t.storyPoints} SP
                  </span>
                )}
                {t.assignee && (
                  <span className="text-[10px] text-muted-foreground">
                    {t.assignee.name}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Carry-over · NO done */}
      {data.carryOverTasks.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-5">
          <header className="mb-3 flex items-center gap-2">
            <Circle className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-foreground">
              No entregado · carry-over
            </h3>
            <span className="ml-auto text-[10px] text-muted-foreground">
              {data.totals.carryOverTasks} task
              {data.totals.carryOverTasks === 1 ? '' : 's'} ·{' '}
              {data.totals.spCarriedOver} SP
            </span>
          </header>
          <ul className="space-y-1.5">
            {data.carryOverTasks.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-1.5"
              >
                <Circle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                <button
                  type="button"
                  onClick={() => openDrawer(t.id)}
                  className="flex-1 truncate text-left text-xs text-foreground hover:text-indigo-300 hover:underline"
                >
                  {t.mnemonic && (
                    <span className="font-mono opacity-60">{t.mnemonic} · </span>
                  )}
                  {t.title}
                </button>
                <span
                  className={clsx(
                    'rounded px-1.5 py-0.5 text-[10px] font-medium',
                    STATUS_TONE[t.status] ?? 'bg-secondary text-muted-foreground',
                  )}
                >
                  {t.status}
                </span>
                {t.storyPoints != null && (
                  <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                    {t.storyPoints} SP
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Demo + notes */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <label
            htmlFor="demo-url"
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            <Film className="mr-1 inline h-3 w-3" />
            Demo del increment (Loom · video · doc)
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              id="demo-url"
              type="url"
              value={demoUrl}
              onChange={(e) => setDemoUrl(e.target.value)}
              placeholder="https://loom.com/share/…"
              className="flex-1 rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground focus:border-primary focus:outline-none"
            />
            {demoUrl && (
              <a
                href={demoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-1.5 text-xs text-foreground hover:bg-secondary/80"
              >
                <ExternalLink className="h-3 w-3" />
                Abrir
              </a>
            )}
          </div>
        </div>

        <div>
          <label
            htmlFor="review-notes"
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Feedback de stakeholders / notas del Review
          </label>
          <textarea
            id="review-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Acuerdos · próximos pasos · feedback recibido en la reunión"
            rows={4}
            className="mt-1.5 w-full resize-none rounded-md border border-border bg-input px-3 py-2 text-sm text-input-foreground focus:border-primary focus:outline-none"
          />
        </div>
      </section>

      {/* Footer CTA */}
      <footer className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-[11px] text-muted-foreground">
          <TrendingUp className="mr-1 inline h-3 w-3" />
          Tras cerrar el Review, los tasks no entregados quedan disponibles
          para mover al Backlog o al siguiente Sprint.
        </p>
        <button
          type="button"
          onClick={handleClose}
          disabled={isPending}
          className={clsx(
            'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors',
            isReviewed
              ? 'border border-border bg-secondary text-foreground hover:bg-secondary/80'
              : 'bg-emerald-600 text-white hover:bg-emerald-500',
            isPending && 'opacity-60',
          )}
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          {isReviewed
            ? 'Actualizar Review'
            : isPending
              ? 'Cerrando…'
              : 'Cerrar Sprint Review'}
        </button>
      </footer>
    </div>
  )
}

function Kpi({
  label,
  value,
  subtitle,
  tone,
}: {
  label: string
  value: string
  subtitle?: string
  tone: 'emerald' | 'amber' | 'rose' | 'indigo' | 'slate'
}) {
  const TONE_BG: Record<string, string> = {
    emerald: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    amber: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    rose: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
    indigo: 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300',
    slate: 'border-border bg-card text-muted-foreground',
  }
  return (
    <div className={clsx('rounded-lg border p-3', TONE_BG[tone])}>
      <p className="text-[10px] uppercase tracking-wider opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {subtitle && <p className="text-[10px] opacity-70">{subtitle}</p>}
    </div>
  )
}
