'use client'

/**
 * Wave P10 (HU-10.4 · GAMMA-2.3+2.4) — Vista de dependencias cross-project.
 *
 * MVP: lista agrupada por proyecto con dos pilas (outbound / inbound) y
 * tags de tipo de dependencia (FS/SS/FF/SF) + lag. La visualización tipo
 * grafo (SVG/canvas con react-flow) queda como follow-up R2.
 */

import Link from 'next/link'
import { ArrowRight, GitBranch } from 'lucide-react'

type ProjectRef = { id: string; name: string }

type TaskRef = {
  id: string
  title: string
  projectId: string
  project: ProjectRef
  endDate: Date | string | null
  status: string
}

type CrossDepItem = {
  id: string
  type: 'FINISH_TO_START' | 'START_TO_START' | 'FINISH_TO_FINISH' | 'START_TO_FINISH'
  lagDays: number
  notes: string | null
  sourceTask: TaskRef
  targetTask: TaskRef
}

type Section = {
  id: string
  projectName: string
  outbound: CrossDepItem[]
  inbound: CrossDepItem[]
}

const TYPE_TAG: Record<CrossDepItem['type'], string> = {
  FINISH_TO_START: 'FS',
  START_TO_START: 'SS',
  FINISH_TO_FINISH: 'FF',
  START_TO_FINISH: 'SF',
}

const STATUS_COLOR: Record<string, string> = {
  TODO: 'bg-slate-500/20 text-slate-300',
  IN_PROGRESS: 'bg-sky-500/20 text-sky-300',
  REVIEW: 'bg-amber-500/20 text-amber-300',
  DONE: 'bg-emerald-500/20 text-emerald-300',
}

function fmtDate(d: Date | string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
  })
}

function isLate(task: TaskRef): boolean {
  if (!task.endDate || task.status === 'DONE') return false
  const end = new Date(task.endDate)
  return end.getTime() < Date.now()
}

function DepRow({
  dep,
  perspective,
}: {
  dep: CrossDepItem
  perspective: 'outbound' | 'inbound'
}) {
  const left = perspective === 'outbound' ? dep.sourceTask : dep.targetTask
  const right = perspective === 'outbound' ? dep.targetTask : dep.sourceTask
  const directionWord = perspective === 'outbound' ? 'bloquea' : 'depende de'

  return (
    <li className="rounded-md border border-border bg-input/40 p-3">
      <div className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {directionWord}{' '}
          <Link
            href={`/projects/${right.project.id}`}
            className="font-medium text-foreground hover:text-indigo-300"
          >
            {right.project.name}
          </Link>
        </span>
        <span className="inline-flex items-center gap-1 rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300">
          <GitBranch className="h-2.5 w-2.5" />
          {TYPE_TAG[dep.type]}
          {dep.lagDays !== 0 && ` · ${dep.lagDays > 0 ? '+' : ''}${dep.lagDays}d`}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2 text-sm">
        <span className="flex-1 truncate text-foreground">{left.title}</span>
        <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-foreground">{right.title}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
        <span
          className={`rounded px-1.5 py-0.5 ${STATUS_COLOR[right.status] ?? 'bg-slate-500/20 text-slate-300'}`}
        >
          {right.status}
        </span>
        <span className="text-muted-foreground">
          fin {fmtDate(right.endDate)}
        </span>
        {isLate(right) && (
          <span className="rounded bg-rose-500/20 px-1.5 py-0.5 font-semibold text-rose-300">
            ⚠ atrasada
          </span>
        )}
        {dep.notes && (
          <span className="text-muted-foreground italic">— {dep.notes}</span>
        )}
      </div>
    </li>
  )
}

export function CrossDependencyList({ sections }: { sections: Section[] }) {
  if (sections.length === 0) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-dashed border-border bg-card p-10 text-center">
        <GitBranch className="mx-auto h-8 w-8 text-muted-foreground" />
        <h2 className="mt-3 text-sm font-semibold text-foreground">
          Sin dependencias cross-project
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Cuando declares dependencias entre tareas de proyectos distintos
          (programa), aparecerán aquí con alertas de propagación.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {sections.map((section) => (
        <section
          key={section.id}
          className="rounded-xl border border-border bg-card p-5"
        >
          <header className="flex items-baseline justify-between">
            <Link
              href={`/projects/${section.id}`}
              className="text-sm font-semibold text-foreground hover:text-indigo-300"
            >
              {section.projectName}
            </Link>
            <p className="text-[10px] text-muted-foreground">
              {section.outbound.length} saliente
              {section.outbound.length === 1 ? '' : 's'} ·{' '}
              {section.inbound.length} entrante
              {section.inbound.length === 1 ? '' : 's'}
            </p>
          </header>

          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                Saliente · este proyecto bloquea
              </h3>
              {section.outbound.length === 0 ? (
                <p className="rounded-md border border-dashed border-border/60 px-3 py-2 text-[11px] italic text-muted-foreground">
                  No bloquea a otros proyectos.
                </p>
              ) : (
                <ul className="space-y-2">
                  {section.outbound.map((d) => (
                    <DepRow key={d.id} dep={d} perspective="outbound" />
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                Entrante · depende de
              </h3>
              {section.inbound.length === 0 ? (
                <p className="rounded-md border border-dashed border-border/60 px-3 py-2 text-[11px] italic text-muted-foreground">
                  No depende de otros proyectos.
                </p>
              ) : (
                <ul className="space-y-2">
                  {section.inbound.map((d) => (
                    <DepRow key={d.id} dep={d} perspective="inbound" />
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      ))}
    </div>
  )
}
