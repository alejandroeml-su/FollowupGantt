'use client'

/**
 * Wave P8 · Equipo P8-2 — Dialog modal de creación/edición de Risk.
 *
 * Renderiza un formulario con todos los campos del modelo:
 *   - title (required)
 *   - description
 *   - probability (1..5) e impact (1..5) — score+tier se previsualizan en
 *     vivo
 *   - status (RiskStatus)
 *   - ownerId (opcional, dropdown de users)
 *   - mitigation
 *   - triggerDelayDays
 *
 * Despacha a `createRisk` / `updateRisk` y notifica al padre con `onSaved`.
 *
 * Implementación:
 *   - `<dialog>` HTML nativo (sin Radix) — patrón ligero del repo.
 *   - El form interno se monta con `key={risk?.id ?? 'new'}` para que
 *     React resetee el state cuando cambia el risk objetivo (sin
 *     necesidad de useEffect → cumple regla `react-hooks/set-state-in-effect`).
 */

import { useEffect, useRef, useState, useTransition } from 'react'
import { Save, X } from 'lucide-react'
import {
  createRisk,
  updateRisk,
  type CreateRiskInput,
} from '@/lib/actions/risks'
import {
  IMPACT_LABEL,
  IMPACT_LEVELS,
  PROBABILITY_LABEL,
  PROBABILITY_LEVELS,
  RISK_STATUS_VALUES,
  STATUS_LABEL,
  TIER_LABEL,
  type ImpactLevel,
  type ProbabilityLevel,
  type RiskStatus,
  type SerializedRisk,
} from '@/lib/risks/types'
import {
  TIER_BG_CLASS,
  TIER_BORDER_CLASS,
  TIER_TEXT_CLASS,
  evaluateRisk,
} from '@/lib/risks/risk-score'
import { useTranslation } from '@/lib/i18n/use-translation'

type Props = {
  open: boolean
  onClose: () => void
  /** Si se pasa, el dialog edita ese risk; si no, crea uno nuevo. */
  risk?: SerializedRisk | null
  /** Proyecto por defecto al crear (puede sobreescribirse en el form). */
  defaultProjectId?: string | null
  projects: Array<{ id: string; name: string }>
  users: Array<{ id: string; name: string }>
  onSaved?: () => void
}

export function RiskFormDialog({
  open,
  onClose,
  risk,
  defaultProjectId,
  projects,
  users,
  onSaved,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)

  // Sync open prop ↔ <dialog>.
  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (open && !d.open) {
      try {
        d.showModal()
      } catch {
        // Ignore "already open" errors.
      }
    } else if (!open && d.open) {
      d.close()
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      data-testid="risk-form-dialog"
      className="rounded-lg border border-border bg-card p-0 backdrop:bg-black/40"
    >
      {/*
        Re-mountamos el form al cambiar el risk objetivo (clave dinámica).
        Esto evita un useEffect que sincronice props → state (anti-patrón
        bloqueado por `react-hooks/set-state-in-effect`).
      */}
      <RiskFormBody
        key={risk?.id ?? 'new'}
        risk={risk ?? null}
        defaultProjectId={defaultProjectId}
        projects={projects}
        users={users}
        onClose={onClose}
        onSaved={onSaved}
      />
    </dialog>
  )
}

// ─────────────────────────── Inner form ────────────────────────────

function RiskFormBody({
  risk,
  defaultProjectId,
  projects,
  users,
  onClose,
  onSaved,
}: {
  risk: SerializedRisk | null
  defaultProjectId: string | null | undefined
  projects: Array<{ id: string; name: string }>
  users: Array<{ id: string; name: string }>
  onClose: () => void
  onSaved?: () => void
}) {
  const { t } = useTranslation()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const isEdit = !!risk
  const [projectId, setProjectId] = useState(
    risk?.projectId ?? defaultProjectId ?? projects[0]?.id ?? '',
  )
  const [title, setTitle] = useState(risk?.title ?? '')
  const [description, setDescription] = useState(risk?.description ?? '')
  const [probability, setProbability] = useState<ProbabilityLevel>(
    (risk?.probability ?? 3) as ProbabilityLevel,
  )
  const [impact, setImpact] = useState<ImpactLevel>(
    (risk?.impact ?? 3) as ImpactLevel,
  )
  const [status, setStatus] = useState<RiskStatus>(risk?.status ?? 'OPEN')
  const [ownerId, setOwnerId] = useState<string>(risk?.ownerId ?? '')
  const [mitigation, setMitigation] = useState(risk?.mitigation ?? '')
  const [triggerDelayDays, setTriggerDelayDays] = useState<string>(
    risk?.triggerDelayDays != null ? String(risk.triggerDelayDays) : '',
  )

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!title.trim()) {
      setError(t('pages.riskForm.titleRequired'))
      return
    }
    if (!isEdit && !projectId) {
      setError(t('pages.riskForm.projectRequired'))
      return
    }

    const delayParsed =
      triggerDelayDays.trim() === '' ? null : Number(triggerDelayDays)
    if (
      delayParsed !== null &&
      (!Number.isInteger(delayParsed) || delayParsed < 0)
    ) {
      setError(t('pages.riskForm.delayInvalid'))
      return
    }

    startTransition(async () => {
      try {
        if (isEdit && risk) {
          await updateRisk(risk.id, {
            title: title.trim(),
            description: description.trim() || null,
            probability,
            impact,
            status,
            ownerId: ownerId || null,
            mitigation: mitigation.trim() || null,
            triggerDelayDays: delayParsed,
          })
        } else {
          const payload: CreateRiskInput = {
            projectId,
            title: title.trim(),
            description: description.trim() || null,
            probability,
            impact,
            status,
            ownerId: ownerId || null,
            mitigation: mitigation.trim() || null,
            triggerDelayDays: delayParsed,
          }
          await createRisk(payload)
        }
        onSaved?.()
        onClose()
      } catch (err) {
        setError(
          err instanceof Error ? err.message : t('pages.riskForm.unknownError'),
        )
      }
    })
  }

  const { score, tier } = evaluateRisk(probability, impact)

  return (
    <form onSubmit={handleSubmit} className="w-[min(560px,90vw)] p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">
          {isEdit
            ? t('pages.riskForm.editRisk')
            : t('pages.riskForm.newRisk')}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('pages.riskForm.close')}
          className="rounded p-1 hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="grid grid-cols-2 gap-3">
        {!isEdit && (
          <label className="col-span-2 flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">
              {t('pages.riskForm.project')} *
            </span>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="rounded border border-border bg-background px-2 py-1 text-sm"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="col-span-2 flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">
            {t('pages.riskForm.titleField')} *
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
          />
        </label>

        <label className="col-span-2 flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">
            {t('pages.riskForm.descriptionField')}
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={2000}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">
            {t('pages.riskForm.probability')}
          </span>
          <select
            value={probability}
            onChange={(e) =>
              setProbability(Number(e.target.value) as ProbabilityLevel)
            }
            className="rounded border border-border bg-background px-2 py-1 text-sm"
          >
            {PROBABILITY_LEVELS.map((p) => (
              <option key={p} value={p}>
                {p}. {PROBABILITY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">
            {t('pages.riskForm.impact')}
          </span>
          <select
            value={impact}
            onChange={(e) => setImpact(Number(e.target.value) as ImpactLevel)}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
          >
            {IMPACT_LEVELS.map((i) => (
              <option key={i} value={i}>
                {i}. {IMPACT_LABEL[i]}
              </option>
            ))}
          </select>
        </label>

        <div className="col-span-2 flex items-center gap-2 rounded border border-border bg-muted/30 px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            {t('pages.riskForm.scoreLabel')}
          </span>
          <span className="font-semibold">{score}</span>
          <span
            className={[
              'rounded border px-2 py-0.5',
              TIER_BG_CLASS[tier],
              TIER_BORDER_CLASS[tier],
              TIER_TEXT_CLASS[tier],
            ].join(' ')}
          >
            {TIER_LABEL[tier]}
          </span>
        </div>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">
            {t('pages.riskForm.status')}
          </span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as RiskStatus)}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
          >
            {RISK_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">
            {t('pages.riskForm.owner')}
          </span>
          <select
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="">{t('pages.riskForm.ownerUnassigned')}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>

        <label className="col-span-2 flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">
            {t('pages.riskForm.mitigation')}
          </span>
          <textarea
            value={mitigation}
            onChange={(e) => setMitigation(e.target.value)}
            rows={2}
            maxLength={2000}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
          />
        </label>

        <label className="col-span-2 flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">
            {t('pages.riskForm.delayDaysLabel')}
          </span>
          <input
            type="number"
            min={0}
            max={3650}
            step={1}
            value={triggerDelayDays}
            onChange={(e) => setTriggerDelayDays(e.target.value)}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
          />
          <span className="text-[10px] text-muted-foreground">
            {t('pages.riskForm.delayDaysHint')}
          </span>
        </label>
      </div>

      {error && (
        <p className="mt-3 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}

      <footer className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted"
        >
          {t('pages.riskForm.cancel')}
        </button>
        <button
          type="submit"
          disabled={pending}
          className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {pending ? t('pages.riskForm.saving') : t('pages.riskForm.save')}
        </button>
      </footer>
    </form>
  )
}
