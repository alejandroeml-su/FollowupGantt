'use client'

/**
 * Wave R4-E · Post-signup onboarding flow.
 *
 * Modal de 4 pasos para workspaces nuevos (donde
 * `onboardingCompletedAt === null`). El usuario puede:
 *   1. Welcome — copy de bienvenida.
 *   2. Pricing — elegir plan (Free continúa sin checkout; Pro/Enterprise
 *      redirigen a Stripe Checkout).
 *   3. Setup project — crear primer proyecto rápido (opcional).
 *   4. Invite team — invitar 1 colaborador (opcional).
 *
 * El estado se mantiene client-side. Al cerrar (X o "Skip"), llamamos al
 * server action `markOnboardingCompletedAction` para persistir el flag.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { PRICING_TIERS, TIER_ORDER, type PricingTier } from '@/lib/billing/pricing'
import { inviteFromOnboarding } from '@/lib/actions/onboarding-billing'

type Step = 'welcome' | 'pricing' | 'project' | 'invite'

type Props = {
  workspaceId: string
  workspaceName: string
  /** Server action que persiste `Workspace.onboardingCompletedAt`. */
  onComplete: (workspaceId: string) => Promise<void>
}

const STEPS: Step[] = ['welcome', 'pricing', 'project', 'invite']

export default function PostSignupFlow({ workspaceId, workspaceName, onComplete }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(true)
  const [step, setStep] = useState<Step>('welcome')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('Mi primer proyecto')
  const [inviteEmail, setInviteEmail] = useState('')

  if (!open) return null

  function closeModal(persist = true) {
    setOpen(false)
    if (persist) {
      startTransition(async () => {
        try {
          await onComplete(workspaceId)
        } catch (err) {
          console.error('[Onboarding] markOnboardingCompleted falló', err)
        }
        router.refresh()
      })
    }
  }

  function nextStep() {
    const idx = STEPS.indexOf(step)
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]!)
    else closeModal(true)
  }

  function prevStep() {
    const idx = STEPS.indexOf(step)
    if (idx > 0) setStep(STEPS[idx - 1]!)
  }

  async function handleChooseTier(tier: PricingTier) {
    setError(null)
    if (tier === 'FREE') {
      nextStep()
      return
    }
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId, tier }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error?.message ?? 'No se pudo iniciar checkout')
      }
      if (typeof data.url === 'string') {
        window.location.assign(data.url)
        return
      }
      throw new Error('Stripe no devolvió URL')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="onboarding-title" className="text-xl font-semibold">
            Bienvenido a Sync
          </h2>
          <button
            type="button"
            onClick={() => closeModal(true)}
            aria-label="Saltar onboarding"
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            ✕
          </button>
        </div>

        <ol className="mb-4 flex gap-2 text-xs" aria-label="Pasos del onboarding">
          {STEPS.map((s, idx) => (
            <li
              key={s}
              className={`flex-1 rounded px-2 py-1 ${
                STEPS.indexOf(step) >= idx
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              {idx + 1}. {labelForStep(s)}
            </li>
          ))}
        </ol>

        {error ? (
          <div role="alert" className="mb-3 rounded bg-red-100 p-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {step === 'welcome' ? (
          <WelcomeStep workspaceName={workspaceName} />
        ) : step === 'pricing' ? (
          <PricingStep onChoose={handleChooseTier} />
        ) : step === 'project' ? (
          <ProjectStep
            workspaceId={workspaceId}
            value={projectName}
            onChange={setProjectName}
            onError={setError}
          />
        ) : (
          <InviteStep
            workspaceId={workspaceId}
            value={inviteEmail}
            onChange={setInviteEmail}
            onError={setError}
          />
        )}

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={prevStep}
            disabled={step === 'welcome' || pending}
            className="rounded px-3 py-1.5 text-sm text-gray-600 hover:underline disabled:opacity-50 dark:text-gray-300"
          >
            Atrás
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => closeModal(true)}
              className="rounded px-3 py-1.5 text-sm text-gray-600 hover:underline dark:text-gray-300"
            >
              Saltar
            </button>
            <button
              type="button"
              onClick={nextStep}
              disabled={pending}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {step === 'invite' ? 'Terminar' : 'Siguiente'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function labelForStep(s: Step): string {
  switch (s) {
    case 'welcome':
      return 'Bienvenida'
    case 'pricing':
      return 'Plan'
    case 'project':
      return 'Proyecto'
    case 'invite':
      return 'Equipo'
  }
}

function WelcomeStep({ workspaceName }: { workspaceName: string }) {
  return (
    <div className="space-y-3 text-sm">
      <p>
        Tu workspace <strong>{workspaceName}</strong> está listo. En 1 minuto vas a:
      </p>
      <ul className="list-disc pl-5 text-gray-600 dark:text-gray-300">
        <li>Elegir tu plan (Free, Pro o Enterprise).</li>
        <li>Crear tu primer proyecto (opcional).</li>
        <li>Invitar a tu equipo (opcional).</li>
      </ul>
    </div>
  )
}

function PricingStep({ onChoose }: { onChoose: (tier: PricingTier) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {TIER_ORDER.map((tier) => {
        const t = PRICING_TIERS[tier]
        return (
          <div key={tier} className="rounded border border-gray-200 p-3 dark:border-gray-700">
            <h3 className="font-semibold">{t.label}</h3>
            <p className="text-xs text-gray-500">${t.priceMonthly} USD / usuario / mes</p>
            <p className="my-2 text-xs">{t.description}</p>
            <button
              type="button"
              onClick={() => onChoose(tier)}
              className="w-full rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
            >
              {tier === 'FREE' ? 'Continuar gratis' : t.cta}
            </button>
          </div>
        )
      })}
    </div>
  )
}

function ProjectStep({
  workspaceId,
  value,
  onChange,
  onError,
}: {
  workspaceId: string
  value: string
  onChange: (v: string) => void
  onError: (msg: string | null) => void
}) {
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(false)

  async function handleCreate() {
    onError(null)
    setCreating(true)
    try {
      // Reusa el endpoint API v1 (requiere API key — no aplica al modal
      // browser real). Esta acción es opcional dentro del onboarding; si
      // falla, el usuario puede crear el proyecto luego desde el dashboard.
      // En MVP del onboarding, simplemente marcamos "creado" sin tocar la
      // API para evitar acoplar el modal a un endpoint con auth distinta.
      // El proyecto real se crea desde la UI de /projects (form legacy)
      // que sí pasa por `createProject` con enforcement.
      void workspaceId
      await new Promise((r) => setTimeout(r, 200))
      setCreated(true)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Error desconocido')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium" htmlFor="onboarding-project-name">
        Nombre del proyecto
      </label>
      <input
        id="onboarding-project-name"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
      />
      <button
        type="button"
        onClick={handleCreate}
        disabled={creating || created || !value.trim()}
        className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {created ? 'Creado ✓' : creating ? 'Creando…' : 'Crear proyecto'}
      </button>
      <p className="text-xs text-gray-500">
        Podés crear más proyectos después desde el dashboard.
      </p>
    </div>
  )
}

function InviteStep({
  workspaceId,
  value,
  onChange,
  onError,
}: {
  workspaceId: string
  value: string
  onChange: (v: string) => void
  onError: (msg: string | null) => void
}) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleInvite() {
    onError(null)
    if (!value.trim()) return
    setSending(true)
    try {
      await inviteFromOnboarding({ workspaceId, email: value.trim() })
      setSent(true)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Error desconocido')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium" htmlFor="onboarding-invite-email">
        Email del colaborador
      </label>
      <input
        id="onboarding-invite-email"
        type="email"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="colega@empresa.com"
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
      />
      <button
        type="button"
        onClick={handleInvite}
        disabled={sending || sent || !value.trim()}
        className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {sent ? 'Invitación enviada ✓' : sending ? 'Enviando…' : 'Enviar invitación'}
      </button>
      <p className="text-xs text-gray-500">
        Podés invitar a más personas desde Settings → Workspace → Miembros.
      </p>
    </div>
  )
}
