'use client'

/**
 * Wave P9 R2 (HU-9.8) — Panel de DoR/DoD del proyecto.
 *
 * Renderiza dos cards lado a lado con preview compacto de las
 * plantillas + botón "Editar". Pensado para insertar en
 * `ProjectDetailClient` o como sección colapsable en settings.
 *
 * Si las plantillas están vacías, muestra empty state con CTA.
 *
 * Wave P12 (Scrum 100% · DoD HARD) — Switch para activar enforcement
 * bloqueante de DoD al mover a DONE.
 */

import { useState, useTransition } from 'react'
import {
  CheckCircle2,
  Lock,
  ListChecks,
  Pencil,
  Plus,
  Unlock,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useRouter } from 'next/navigation'
import { ChecklistTemplateEditor } from './ChecklistTemplateEditor'
import { toggleDodHardEnforce } from '@/lib/actions/dor-dod'
import { toast } from '@/components/interactions/Toaster'

type Props = {
  projectId: string
  dor: string[]
  dod: string[]
  /** Wave P9 follow-up — nombre del proyecto/producto para mostrar en el editor. */
  projectName?: string
  /** Wave P12 — Default false (validación SOFT toast). True bloquea status DONE sin DoD completo. */
  dodHardEnforce?: boolean
}

export function ChecklistsPanel({
  projectId,
  dor,
  dod,
  projectName,
  dodHardEnforce = false,
}: Props) {
  const [editing, setEditing] = useState<'DOR' | 'DOD' | null>(null)
  const [hardEnforce, setHardEnforce] = useState(dodHardEnforce)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const toggleHard = () => {
    const next = !hardEnforce
    setHardEnforce(next)
    startTransition(async () => {
      try {
        await toggleDodHardEnforce({ projectId, enabled: next })
        toast.success(
          next
            ? 'DoD HARD activo · DONE bloqueado sin checklist completo'
            : 'DoD SOFT · solo toast informativo',
        )
        router.refresh()
      } catch (err) {
        setHardEnforce(!next)
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  return (
    <>
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChecklistCard
          icon={<ListChecks className="h-4 w-4" />}
          title="Definition of Ready"
          subtitle="Antes de IN_PROGRESS"
          accent="indigo"
          items={dor}
          onEdit={() => setEditing('DOR')}
        />
        <ChecklistCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          title="Definition of Done"
          subtitle="Antes de DONE"
          accent="emerald"
          items={dod}
          onEdit={() => setEditing('DOD')}
        />
      </section>

      <div
        className={clsx(
          'mt-3 flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-2.5 text-sm',
          hardEnforce
            ? 'border-rose-500/40 bg-rose-500/5'
            : 'border-border',
        )}
      >
        <span
          className={clsx(
            'flex h-7 w-7 items-center justify-center rounded-md',
            hardEnforce
              ? 'bg-rose-500/20 text-rose-300'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {hardEnforce ? (
            <Lock className="h-3.5 w-3.5" />
          ) : (
            <Unlock className="h-3.5 w-3.5" />
          )}
        </span>
        <div className="flex-1">
          <div className="font-medium text-foreground">
            DoD HARD enforcement
          </div>
          <p className="text-xs text-muted-foreground">
            {hardEnforce
              ? 'Bloquea mover a DONE sin checklist DoD completo (recomendado para releases formales).'
              : 'Solo muestra toast informativo. El equipo puede saltarse DoD bajo su responsabilidad.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={hardEnforce}
          onClick={toggleHard}
          disabled={isPending}
          className={clsx(
            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
            hardEnforce ? 'bg-rose-500' : 'bg-muted',
            isPending && 'opacity-50',
          )}
        >
          <span
            className={clsx(
              'inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition',
              hardEnforce ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </button>
      </div>

      {editing === 'DOR' && (
        <ChecklistTemplateEditor
          open
          onClose={() => setEditing(null)}
          projectId={projectId}
          mode="DOR"
          initial={dor}
          projectName={projectName}
        />
      )}
      {editing === 'DOD' && (
        <ChecklistTemplateEditor
          open
          onClose={() => setEditing(null)}
          projectId={projectId}
          mode="DOD"
          initial={dod}
          projectName={projectName}
        />
      )}
    </>
  )
}

function ChecklistCard({
  icon,
  title,
  subtitle,
  accent,
  items,
  onEdit,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  accent: 'indigo' | 'emerald'
  items: string[]
  onEdit: () => void
}) {
  const accentClasses = {
    indigo: {
      iconBg: 'bg-indigo-500/15 text-indigo-300',
      border: 'border-indigo-500/40',
    },
    emerald: {
      iconBg: 'bg-emerald-500/15 text-emerald-300',
      border: 'border-emerald-500/40',
    },
  }[accent]

  return (
    <div className={clsx('rounded-xl border bg-card p-4', accentClasses.border)}>
      <header className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className={clsx('rounded p-1.5', accentClasses.iconBg)}>{icon}</span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="text-[11px] text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Editar ${title}`}
          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </header>

      {items.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-border bg-subtle/30 p-4 text-center">
          <p className="text-[11px] text-muted-foreground">
            Sin criterios definidos.
          </p>
          <button
            type="button"
            onClick={onEdit}
            className="mt-2 inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3 w-3" />
            Configurar
          </button>
        </div>
      ) : (
        <ul className="mt-3 space-y-1">
          {items.slice(0, 5).map((item, i) => (
            <li
              key={`${i}-${item}`}
              className="flex items-start gap-2 text-[12px] text-foreground"
            >
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
              <span className="flex-1">{item}</span>
            </li>
          ))}
          {items.length > 5 && (
            <li className="text-[10px] italic text-muted-foreground">
              + {items.length - 5} más
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
