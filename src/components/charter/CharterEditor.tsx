'use client'

/**
 * Wave P11-PMI (HU-12.1) — Project Charter editor.
 */

import { useState, useTransition } from 'react'
import {
  FileText,
  Plus,
  X as CloseIcon,
  CheckCircle2,
  Calendar as CalendarIcon,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { setCharter, approveCharter } from '@/lib/actions/charter'
import {
  isCharterApproved,
  type ProjectCharter,
} from '@/lib/charter/types'
import { toast } from '@/components/interactions/Toaster'

type Props = {
  projectId: string
  projectName: string
  initial: ProjectCharter
  currentUser: { id: string; name: string } | null
}

export function CharterEditor({
  projectId,
  projectName,
  initial,
  currentUser,
}: Props) {
  const [vision, setVision] = useState(initial.vision)
  const [justification, setJustification] = useState(initial.businessJustification)
  const [criteria, setCriteria] = useState<string[]>(initial.successCriteria)
  const [draftCriterion, setDraftCriterion] = useState('')
  const [milestones, setMilestones] = useState(initial.milestones)
  const [draftMilestone, setDraftMilestone] = useState({ name: '', targetDate: '' })
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const [prevInitial, setPrevInitial] = useState(initial)
  if (
    prevInitial.version !== initial.version ||
    prevInitial.approvedAt !== initial.approvedAt
  ) {
    setPrevInitial(initial)
    setVision(initial.vision)
    setJustification(initial.businessJustification)
    setCriteria(initial.successCriteria)
    setMilestones(initial.milestones)
  }

  const approved = isCharterApproved(initial)

  const handleSave = () => {
    if (!vision.trim() || !justification.trim()) {
      toast.error('Vision y Justificación son requeridos')
      return
    }
    startTransition(async () => {
      try {
        await setCharter({
          projectId,
          vision: vision.trim(),
          businessJustification: justification.trim(),
          successCriteria: criteria,
          milestones,
        })
        toast.success(`Charter v${initial.version + 1} guardado`)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al guardar')
      }
    })
  }

  const handleApprove = () => {
    if (!currentUser) {
      toast.error('Sesión requerida para aprobar')
      return
    }
    if (!confirm(`¿Aprobar formalmente el Charter de "${projectName}"? Esta acción se registra en audit log.`)) {
      return
    }
    startTransition(async () => {
      try {
        await approveCharter({
          projectId,
          approverId: currentUser.id,
          approverName: currentUser.name,
        })
        toast.success('Charter aprobado · proyecto autorizado')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al aprobar')
      }
    })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <header className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-5">
        <div className="flex items-start gap-3">
          <FileText className="h-6 w-6 shrink-0 text-violet-300" />
          <div className="flex-1">
            <h2 className="text-base font-bold text-foreground">
              Project Charter · {projectName}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              PMBOK 6/7 · Documento que autoriza formalmente el inicio del
              proyecto y otorga autoridad al Project Manager.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded-full bg-input/60 px-2 py-0.5 font-bold text-muted-foreground">
                v{initial.version}
              </span>
              {approved ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" /> Aprobado
                  {initial.approvedBy && ` por ${initial.approvedBy}`}
                  {initial.approvedAt && (
                    <time className="opacity-80">
                      · {new Date(initial.approvedAt).toLocaleDateString('es-MX')}
                    </time>
                  )}
                </span>
              ) : (
                <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-300">
                  Pendiente de aprobación
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Vision */}
      <section>
        <label
          htmlFor="ch-vision"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Vision Statement <span className="text-rose-400">*</span>
        </label>
        <textarea
          id="ch-vision"
          value={vision}
          onChange={(e) => setVision(e.target.value)}
          placeholder="Estado futuro del producto / servicio que el proyecto entregará."
          rows={3}
          className="mt-1.5 w-full resize-none rounded-md border border-border bg-input px-3 py-2 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </section>

      {/* Business Justification */}
      <section>
        <label
          htmlFor="ch-justif"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Business Justification <span className="text-rose-400">*</span>
        </label>
        <textarea
          id="ch-justif"
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          placeholder="Por qué este proyecto es viable y necesario · ROI · alignment estratégico."
          rows={4}
          className="mt-1.5 w-full resize-none rounded-md border border-border bg-input px-3 py-2 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </section>

      {/* Success Criteria */}
      <section>
        <div className="flex items-baseline justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Success Criteria
          </label>
          <span className="text-[10px] text-muted-foreground">{criteria.length} / 15</span>
        </div>
        {criteria.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {criteria.map((c, i) => (
              <li
                key={`${c}-${i}`}
                className="flex items-center gap-2 rounded border border-border bg-input/40 px-2.5 py-1.5"
              >
                <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
                <span className="flex-1 text-sm text-foreground">{c}</span>
                <button
                  type="button"
                  onClick={() =>
                    setCriteria((p) => p.filter((_, j) => j !== i))
                  }
                  aria-label={`Quitar ${c}`}
                  className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-rose-400"
                >
                  <CloseIcon className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {criteria.length < 15 && (
          <div className="mt-2 flex items-center gap-1.5 rounded border border-dashed border-border bg-input/20 px-2.5 py-1.5">
            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={draftCriterion}
              onChange={(e) => setDraftCriterion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (draftCriterion.trim()) {
                    setCriteria((p) => [...p, draftCriterion.trim()])
                    setDraftCriterion('')
                  }
                }
              }}
              placeholder="Ej. Cierre del módulo X al Q2 con NPS ≥ 50"
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                if (draftCriterion.trim()) {
                  setCriteria((p) => [...p, draftCriterion.trim()])
                  setDraftCriterion('')
                }
              }}
              disabled={!draftCriterion.trim()}
              className="rounded bg-violet-500/20 px-2 py-0.5 text-[10px] font-semibold text-violet-300 hover:bg-violet-500/30 disabled:opacity-40"
            >
              + Agregar
            </button>
          </div>
        )}
      </section>

      {/* Milestones */}
      <section>
        <div className="flex items-baseline justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            High-level Milestones
          </label>
          <span className="text-[10px] text-muted-foreground">
            {milestones.length} / 20
          </span>
        </div>
        {milestones.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {milestones.map((m, i) => (
              <li
                key={`${m.name}-${i}`}
                className="flex items-center gap-2 rounded border border-border bg-input/40 px-2.5 py-1.5"
              >
                <CalendarIcon className="h-3 w-3 shrink-0 text-indigo-400" />
                <span className="flex-1 text-sm text-foreground">{m.name}</span>
                {m.targetDate && (
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(m.targetDate).toLocaleDateString('es-MX')}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setMilestones((p) => p.filter((_, j) => j !== i))}
                  className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-rose-400"
                >
                  <CloseIcon className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {milestones.length < 20 && (
          <div className="mt-2 grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded border border-dashed border-border bg-input/20 px-2.5 py-1.5">
            <input
              type="text"
              value={draftMilestone.name}
              onChange={(e) =>
                setDraftMilestone((p) => ({ ...p, name: e.target.value }))
              }
              placeholder="Hito (ej. Go-Live MVP)"
              className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
            />
            <input
              type="date"
              value={draftMilestone.targetDate}
              onChange={(e) =>
                setDraftMilestone((p) => ({ ...p, targetDate: e.target.value }))
              }
              className="rounded border border-border bg-input px-2 py-0.5 text-xs text-input-foreground"
            />
            <button
              type="button"
              onClick={() => {
                if (draftMilestone.name.trim()) {
                  setMilestones((p) => [
                    ...p,
                    {
                      name: draftMilestone.name.trim(),
                      targetDate: draftMilestone.targetDate || null,
                    },
                  ])
                  setDraftMilestone({ name: '', targetDate: '' })
                }
              }}
              disabled={!draftMilestone.name.trim()}
              className="rounded bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-40"
            >
              + Agregar
            </button>
          </div>
        )}
      </section>

      {/* Footer actions */}
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {!approved && initial.version > 0 && currentUser && (
          <button
            type="button"
            onClick={handleApprove}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            <CheckCircle2 className="h-3 w-3" /> Aprobar Charter
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending || !vision.trim() || !justification.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
        >
          <FileText className="h-3.5 w-3.5" />
          {isPending
            ? 'Guardando…'
            : initial.version === 0
              ? 'Crear Charter'
              : `Actualizar Charter (v${initial.version + 1})`}
        </button>
      </footer>
    </div>
  )
}
