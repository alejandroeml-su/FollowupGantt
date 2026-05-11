'use client'

/**
 * Wave P19-A · Brain AI Strategist — Cross-project insights view.
 *
 * Run-on-demand: cada visita ejecuta loadStrategistReport() y renderiza
 * 3 secciones (resource contention · dependency conflicts · reusable
 * lessons). Sin persistencia · regenerable con botón "Refrescar".
 */

import { useCallback, useEffect, useState, useTransition } from 'react'
import {
  Brain,
  RefreshCw,
  Users2,
  GitBranch,
  BookOpen,
  AlertTriangle,
  Sparkles,
  Wand2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { clsx } from 'clsx'
import { loadStrategistReport } from '@/lib/brain/strategist/actions'
import { generateStrategistBrief } from '@/lib/brain/strategist/narration-actions'
import type { StrategistNarration } from '@/lib/brain/strategist/narration'
// Wave P19-D · Historial persistente del Strategist (sección inferior).
import { StrategistHistory } from './StrategistHistory'

type Report = Awaited<ReturnType<typeof loadStrategistReport>>

const SEV_TONE: Record<'HIGH' | 'MEDIUM' | 'LOW', string> = {
  HIGH: 'bg-rose-500/20 text-rose-200 border-rose-500/40',
  MEDIUM: 'bg-amber-500/20 text-amber-200 border-amber-500/40',
  LOW: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40',
}

export function StrategistAI() {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Wave P19-C · Brief ejecutivo (LLM o heurístico).
  const [narration, setNarration] = useState<StrategistNarration | null>(null)
  const [narrationError, setNarrationError] = useState<string | null>(null)
  const [isNarrating, startNarrationTransition] = useTransition()
  const [briefOpen, setBriefOpen] = useState(true)
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(() => {
    setError(null)
    startTransition(async () => {
      try {
        const r = await loadStrategistReport()
        setReport(r)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al cargar')
      }
    })
  }, [])

  const generateBrief = () => {
    setNarrationError(null)
    setCopied(false)
    startNarrationTransition(async () => {
      try {
        const n = await generateStrategistBrief({})
        setNarration(n)
      } catch (e) {
        setNarrationError(
          e instanceof Error ? e.message : 'Error al generar el brief',
        )
      }
    })
  }

  const copyBrief = async () => {
    if (!narration) return
    const sections: string[] = [narration.briefText.trim()]
    if (narration.keyFindings.length > 0) {
      sections.push(
        'Puntos clave:\n' +
          narration.keyFindings.map((k) => `- ${k}`).join('\n'),
      )
    }
    if (narration.cta) sections.push(`Llamada a acción: ${narration.cta}`)
    const text = sections.join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }

  useEffect(() => {
    const id = setTimeout(() => {
      void refresh()
    }, 0)
    return () => clearTimeout(id)
  }, [refresh])

  return (
    <div className="flex-1 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
            <Brain className="h-6 w-6 text-violet-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Strategist AI</h2>
            <p className="text-muted-foreground text-sm">
              Insights cross-project · resource contention · dependency conflicts ·
              reusable lessons.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={isPending}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-violet-600 hover:bg-violet-500 text-sm font-semibold text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={clsx('h-4 w-4', isPending && 'animate-spin')} />
          {isPending ? 'Analizando…' : 'Refrescar'}
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-300 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {!report && !error && (
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
          <Sparkles className="h-10 w-10 mx-auto text-muted-foreground opacity-50 animate-pulse" />
          <p className="mt-3 text-sm text-foreground">Cargando análisis cross-project…</p>
        </div>
      )}

      {report && (
        <div className="space-y-6">
          {/* Wave P19-C · Brief ejecutivo (LLM o heurístico) */}
          <section className="rounded-xl border border-violet-500/30 bg-gradient-to-br from-violet-500/10 via-card to-card p-5">
            <header className="flex flex-wrap items-center gap-3">
              <Wand2 className="h-5 w-5 text-violet-300" />
              <h3 className="text-sm font-semibold uppercase tracking-wider text-violet-200">
                Brief ejecutivo · Mensaje al CEO
              </h3>
              {narration && (
                <span
                  className={clsx(
                    'rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                    narration.source === 'llm'
                      ? 'border-violet-500/40 bg-violet-500/20 text-violet-200'
                      : 'border-amber-500/40 bg-amber-500/20 text-amber-200',
                  )}
                  title={narration.fallbackReason ?? undefined}
                >
                  {narration.source === 'llm'
                    ? `Generado con AI · ${narration.provider ?? 'anthropic'}`
                    : 'Heurístico (LLM disabled)'}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                {narration && (
                  <>
                    <button
                      type="button"
                      onClick={copyBrief}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-background/60 transition-colors"
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copied ? 'Copiado' : 'Copiar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setBriefOpen((v) => !v)}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-background/60 transition-colors"
                      aria-expanded={briefOpen}
                    >
                      {briefOpen ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                      {briefOpen ? 'Ocultar' : 'Mostrar'}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={generateBrief}
                  disabled={isNarrating}
                  className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 hover:bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50"
                >
                  <Sparkles className={clsx('h-3.5 w-3.5', isNarrating && 'animate-pulse')} />
                  {isNarrating
                    ? 'Generando…'
                    : narration
                      ? 'Regenerar brief'
                      : 'Generar brief ejecutivo'}
                </button>
              </div>
            </header>

            {narrationError && (
              <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {narrationError}
              </div>
            )}

            {isNarrating && !narration && (
              <div className="mt-4 space-y-2" aria-busy="true">
                <div className="h-3 w-3/4 animate-pulse rounded bg-violet-500/20" />
                <div className="h-3 w-full animate-pulse rounded bg-violet-500/20" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-violet-500/20" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-violet-500/20" />
                <p className="pt-2 text-xs text-muted-foreground italic">
                  Sintetizando hallazgos cross-project en lenguaje ejecutivo…
                </p>
              </div>
            )}

            {!narration && !isNarrating && !narrationError && (
              <p className="mt-3 text-xs text-muted-foreground">
                Genera un brief de 3-5 párrafos listo para enviar al sponsor o
                Steering Committee. Usa Anthropic si está configurado, o un
                fallback heurístico determinista si no.
              </p>
            )}

            {narration && briefOpen && (
              <div className="mt-4 space-y-4">
                <div
                  className="prose prose-sm prose-invert max-w-none text-sm leading-relaxed text-foreground [&_p]:mb-3 [&_p:last-child]:mb-0"
                  // briefHtml viene sanitizado desde `paragraphsToHtml`
                  // (escape de &, <, >, ", ' antes de envolver en <p>).
                  dangerouslySetInnerHTML={{ __html: narration.briefHtml }}
                />

                {narration.keyFindings.length > 0 && (
                  <div className="rounded-lg border border-border bg-background/40 p-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Puntos clave
                    </p>
                    <ul className="space-y-1.5 text-xs text-foreground">
                      {narration.keyFindings.map((finding, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="mt-0.5 text-violet-400">•</span>
                          <span>{finding}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {narration.cta && (
                  <div className="rounded-lg border border-violet-500/40 bg-violet-500/15 p-3">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-violet-200">
                      Llamada a acción
                    </p>
                    <p className="text-sm font-medium text-foreground">
                      {narration.cta}
                    </p>
                  </div>
                )}

                <p className="text-[10px] text-muted-foreground">
                  Generado: {new Date(narration.generatedAt).toLocaleString('es-MX')}
                </p>
              </div>
            )}
          </section>

          {/* Banner scan stats */}
          <section className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Análisis sobre:</span>
            <span>{report.scanned.activeProjects} proyectos activos</span>
            <span>·</span>
            <span>{report.scanned.tasks} tareas</span>
            <span>·</span>
            <span>{report.scanned.crossDeps} cross-deps</span>
            <span>·</span>
            <span>{report.scanned.lessons} lecciones</span>
            <span className="ml-auto">
              Generado: {new Date(report.generatedAt).toLocaleString('es-MX')}
            </span>
          </section>

          {/* Resource contention */}
          <Section
            icon={Users2}
            tone="rose"
            title="Resource Contention"
            count={report.resourceContention.length}
            emptyMessage="✅ Sin solapes detectados · usuarios bien distribuidos cross-project."
          >
            {report.resourceContention.map((i) => (
              <Card key={`${i.userId}-${i.overlapDays}`} severity={i.severity}>
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Users2 className="h-4 w-4 text-rose-400" />
                  {i.userName} · {i.overlapDays} días de solape
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Asignado en: {i.projects.map((p) => p.name).join(' · ')}
                </p>
                <p className="mt-2 text-xs text-foreground/90">{i.recommendation}</p>
              </Card>
            ))}
          </Section>

          {/* Dependency conflicts */}
          <Section
            icon={GitBranch}
            tone="amber"
            title="Dependency Conflicts"
            count={report.dependencyConflicts.length}
            emptyMessage="✅ Sin conflictos de cronograma en cross-dependencies."
          >
            {report.dependencyConflicts.map((i, idx) => (
              <Card
                key={`${i.predecessor.taskId}-${i.successor.taskId}-${idx}`}
                severity={i.severity}
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <GitBranch className="h-4 w-4 text-amber-400" />
                  Schedule fail · {Math.abs(i.gapDays)} días
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="font-mono">{i.predecessor.title}</span>{' '}
                  ({i.predecessor.project}) →{' '}
                  <span className="font-mono">{i.successor.title}</span>{' '}
                  ({i.successor.project})
                </p>
                <p className="mt-2 text-xs text-foreground/90">{i.recommendation}</p>
              </Card>
            ))}
          </Section>

          {/* Reusable lessons */}
          <Section
            icon={BookOpen}
            tone="emerald"
            title="Reusable Lessons"
            count={report.reusableLessons.length}
            emptyMessage="Sin lecciones reusables detectadas (necesitan más datos)."
          >
            {report.reusableLessons.map((i, idx) => (
              <Card key={`${i.title}-${idx}`} severity={i.severity}>
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <BookOpen className="h-4 w-4 text-emerald-400" />
                  {i.title}
                </div>
                <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Categoría: {i.category} · Fuente: {i.sourceProject}
                </p>
                <p className="mt-1 text-xs text-foreground/90">{i.recommendation}</p>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Aplicable a: {i.applicableProjects.join(' · ')}
                </p>
              </Card>
            ))}
          </Section>

          {/* Wave P19-D · Historial persistente */}
          <StrategistHistory currentReport={report} />
        </div>
      )}
    </div>
  )
}

function Section({
  icon: Icon,
  tone,
  title,
  count,
  emptyMessage,
  children,
}: {
  icon: typeof Users2
  tone: 'rose' | 'amber' | 'emerald'
  title: string
  count: number
  emptyMessage: string
  children: React.ReactNode
}) {
  const classes = {
    rose: 'from-rose-500/10 via-card to-card text-rose-300 border-rose-500/30',
    amber: 'from-amber-500/10 via-card to-card text-amber-300 border-amber-500/30',
    emerald: 'from-emerald-500/10 via-card to-card text-emerald-300 border-emerald-500/30',
  }[tone]
  return (
    <section className={clsx('rounded-xl border bg-gradient-to-br p-5', classes)}>
      <header className="mb-3 flex items-center gap-2">
        <Icon className="h-5 w-5" />
        <h3 className="text-sm font-semibold uppercase tracking-wider">
          {title} · {count}
        </h3>
      </header>
      {count === 0 ? (
        <p className="text-xs text-muted-foreground italic">{emptyMessage}</p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  )
}

function Card({
  severity,
  children,
}: {
  severity: 'HIGH' | 'MEDIUM' | 'LOW'
  children: React.ReactNode
}) {
  return (
    <article className="rounded-lg border border-border bg-background/40 p-3">
      <div className="mb-1.5 flex items-start gap-2">
        <span
          className={clsx(
            'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
            SEV_TONE[severity],
          )}
        >
          {severity}
        </span>
      </div>
      {children}
    </article>
  )
}
