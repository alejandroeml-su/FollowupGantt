'use client'

/**
 * Equipo D3 · OnboardingFlow — wrapper multi-step.
 *
 * Maneja:
 *   - Estado de paso actual (`useState`).
 *   - Persistencia en `localStorage` (key = `fg.onboarding.state`).
 *   - Navegación: "Atrás" disponible siempre menos en el primer paso;
 *     "Siguiente" se desbloquea cuando el step interno completa su
 *     acción (cada step llama `onComplete(...)` con el resultado).
 *   - Redirect final a `/projects/{newProjectId}` con toast.
 *
 * Decisión D3-OB-3: NO usamos `useEffect → setState` para sincronizar
 * con localStorage. La hidratación se hace lazy con `useState(() =>
 * readFromStorage())`. Para reaccionar al `currentStep` cambiante
 * usamos un efecto solo-write (escribe a localStorage), lo cual NO
 * dispara setState. Cumple `react-hooks/set-state-in-effect`.
 *
 * TODO(BD): cuando exista `User.onboardingStep` reemplazar localStorage
 * por server action `saveOnboardingProgress(step, payload)` invocada
 * tras cada `onComplete`.
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createWorkspace, inviteMember } from '@/lib/actions/workspaces'
import { createProject } from '@/lib/actions'
import { createTask } from '@/lib/actions'
import {
  dismissOnboarding,
  findFirstProjectIdByName,
} from '@/lib/actions/onboarding'
import { toast } from '@/components/interactions/Toaster'
import {
  OnboardingStepCreateWorkspace,
  type WorkspaceFormResult,
} from './OnboardingStepCreateWorkspace'
import { OnboardingStepInviteMembers } from './OnboardingStepInviteMembers'
import {
  OnboardingStepFirstProject,
  type ProjectFormResult,
} from './OnboardingStepFirstProject'
import { OnboardingStepFirstTask } from './OnboardingStepFirstTask'

const STORAGE_KEY = 'fg.onboarding.state'

type FlowState = {
  step: 1 | 2 | 3 | 4
  workspace: WorkspaceFormResult | null
  invitedCount: number
  project: ProjectFormResult | null
  taskCreated: boolean
}

const INITIAL_STATE: FlowState = {
  step: 1,
  workspace: null,
  invitedCount: 0,
  project: null,
  taskCreated: false,
}

function readState(): FlowState {
  if (typeof window === 'undefined') return INITIAL_STATE
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return INITIAL_STATE
    const parsed = JSON.parse(raw) as Partial<FlowState>
    return {
      step:
        parsed.step === 1 || parsed.step === 2 || parsed.step === 3 || parsed.step === 4
          ? parsed.step
          : 1,
      workspace: parsed.workspace ?? null,
      invitedCount: parsed.invitedCount ?? 0,
      project: parsed.project ?? null,
      taskCreated: parsed.taskCreated ?? false,
    }
  } catch {
    return INITIAL_STATE
  }
}

function writeState(state: FlowState) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // QuotaExceeded u otro: silenciar — el flujo sigue siendo usable
    // sin persistencia.
  }
}

type StepperProps = {
  current: 1 | 2 | 3 | 4
}

const STEP_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: 'Crear workspace',
  2: 'Invitar miembros',
  3: 'Primer proyecto',
  4: 'Primera tarea',
}

function Stepper({ current }: StepperProps) {
  const steps = [1, 2, 3, 4] as const
  return (
    <ol
      className="flex flex-wrap items-center gap-2"
      aria-label="Progreso del onboarding"
      data-testid="onboarding-stepper"
    >
      {steps.map((s, idx) => {
        const isActive = s === current
        const isDone = s < current
        return (
          <li
            key={s}
            data-testid={`onboarding-stepper-${s}`}
            data-active={isActive ? 'true' : 'false'}
            data-done={isDone ? 'true' : 'false'}
            className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
              isActive
                ? 'border-primary bg-primary/10 text-primary'
                : isDone
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                  : 'border-border bg-background text-muted-foreground'
            }`}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-current/20 text-[10px]">
              {isDone ? '✓' : s}
            </span>
            <span>{STEP_LABELS[s]}</span>
            {idx < steps.length - 1 && (
              <span aria-hidden className="ml-1 text-muted-foreground">
                →
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

type Props = {
  /** Inyectables para tests / mocks. */
  bindings?: {
    createWorkspace?: typeof createWorkspace
    inviteMember?: typeof inviteMember
    createProject?: typeof createProject
    createTask?: typeof createTask
    findFirstProjectIdByName?: typeof findFirstProjectIdByName
    dismissOnboarding?: typeof dismissOnboarding
  }
}

export function OnboardingFlow({ bindings }: Props = {}) {
  const router = useRouter()
  // Lazy init: sin useEffect→setState, la hidratación ocurre en el
  // primer render del cliente (en SSR el initialState es INITIAL_STATE).
  const [state, setState] = useState<FlowState>(() => readState())
  const [finishing, setFinishing] = useState(false)

  // Solo-write: persiste cambios sin disparar setState. NO viola la
  // regla `react-hooks/set-state-in-effect` porque el efecto no llama
  // ningún setState.
  useEffect(() => {
    writeState(state)
  }, [state])

  const goNext = () => {
    setState((s) => ({
      ...s,
      step: Math.min(4, s.step + 1) as 1 | 2 | 3 | 4,
    }))
  }
  const goPrev = () => {
    setState((s) => ({
      ...s,
      step: Math.max(1, s.step - 1) as 1 | 2 | 3 | 4,
    }))
  }

  const handleWorkspaceComplete = (ws: WorkspaceFormResult) => {
    setState((s) => ({ ...s, workspace: ws, step: 2 }))
  }

  const handleInviteComplete = (sent: number) => {
    setState((s) => ({ ...s, invitedCount: sent, step: 3 }))
  }

  const handleProjectComplete = (project: ProjectFormResult) => {
    setState((s) => ({ ...s, project, step: 4 }))
  }

  const handleTaskComplete = async () => {
    setState((s) => ({ ...s, taskCreated: true }))
    if (finishing) return
    setFinishing(true)
    try {
      const dismiss = bindings?.dismissOnboarding ?? dismissOnboarding
      await dismiss()
      // Limpia el estado local para que la próxima vez (o tras logout)
      // arranque limpio. El gating "ya completó" lo hace el servidor.
      try {
        window.localStorage.removeItem(STORAGE_KEY)
      } catch {
        // ignore
      }
      toast.success('¡Listo! Tu workspace está activo')
      const projectId = state.project?.id
      router.push(projectId ? `/projects/${projectId}` : '/projects')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error'
      toast.error(msg)
    } finally {
      setFinishing(false)
    }
  }

  // Bindings con default a server actions reales
  const submitWorkspace = async (input: { name: string; slug: string }) => {
    const fn = bindings?.createWorkspace ?? createWorkspace
    return fn({ name: input.name, slug: input.slug })
  }

  const submitInvite = async (input: { workspaceId: string; email: string }) => {
    const fn = bindings?.inviteMember ?? inviteMember
    return fn({ workspaceId: input.workspaceId, email: input.email })
  }

  const submitProject = async (input: { name: string; description: string }) => {
    const create = bindings?.createProject ?? createProject
    const find = bindings?.findFirstProjectIdByName ?? findFirstProjectIdByName
    const fd = new FormData()
    fd.set('name', input.name)
    if (input.description) fd.set('description', input.description)
    fd.set('status', 'PLANNING')
    await create(fd)
    const id = await find(input.name)
    if (!id) {
      throw new Error('No se pudo localizar el proyecto recién creado')
    }
    return { id, name: input.name }
  }

  const submitTask = async (input: {
    projectId: string
    title: string
    assigneeId?: string
  }) => {
    const fn = bindings?.createTask ?? createTask
    const fd = new FormData()
    fd.set('title', input.title)
    fd.set('projectId', input.projectId)
    fd.set('status', 'TODO')
    fd.set('priority', 'MEDIUM')
    fd.set('type', 'AGILE_STORY')
    if (input.assigneeId) fd.set('assigneeId', input.assigneeId)
    await fn(fd)
  }

  return (
    <div
      className="mx-auto flex h-full max-w-2xl flex-col gap-8 p-8 lg:p-12"
      data-testid="onboarding-flow"
    >
      <header className="space-y-3">
        <h1 className="text-3xl font-black tracking-tight text-foreground">
          Bienvenido a FollowupGantt
        </h1>
        <p className="text-sm text-muted-foreground">
          Configura tu workspace en 4 pasos rápidos.
        </p>
        <Stepper current={state.step} />
      </header>

      <main className="flex-1 rounded-2xl bg-card border border-border p-6">
        {state.step === 1 && (
          <OnboardingStepCreateWorkspace
            onComplete={handleWorkspaceComplete}
            onSubmit={submitWorkspace}
          />
        )}
        {state.step === 2 && state.workspace && (
          <OnboardingStepInviteMembers
            workspaceId={state.workspace.id}
            onComplete={handleInviteComplete}
            onSkip={() => goNext()}
            onInvite={submitInvite}
          />
        )}
        {state.step === 3 && (
          <OnboardingStepFirstProject
            onComplete={handleProjectComplete}
            onSubmit={submitProject}
          />
        )}
        {state.step === 4 && state.project && (
          <OnboardingStepFirstTask
            projectId={state.project.id}
            onComplete={handleTaskComplete}
            onSubmit={submitTask}
          />
        )}
      </main>

      <footer className="flex items-center justify-between">
        <button
          type="button"
          onClick={goPrev}
          disabled={state.step === 1 || finishing}
          className="rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-50"
          data-testid="onboarding-back"
        >
          Atrás
        </button>
        <p className="text-xs text-muted-foreground">
          Paso {state.step} de 4
        </p>
      </footer>
    </div>
  )
}
