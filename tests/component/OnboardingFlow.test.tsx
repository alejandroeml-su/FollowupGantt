import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Equipo D3 · Tests del OnboardingFlow.
 *
 * Cubre navegación entre pasos, persistencia en localStorage,
 * integración con server actions (mockeadas vía bindings prop) y
 * redirección final.
 *
 * No tocamos BD: las server actions se inyectan vía `bindings` para
 * controlar la respuesta y validar los argumentos.
 */

// Mockeamos los módulos de server actions que se importan al top del
// flujo. Sus implementaciones concretas no se invocan porque el test
// usa `bindings` para sobreescribirlas.
vi.mock('@/lib/actions/workspaces', () => ({
  createWorkspace: vi.fn(),
  inviteMember: vi.fn(),
}))
vi.mock('@/lib/actions', () => ({
  createProject: vi.fn(),
  createTask: vi.fn(),
}))
vi.mock('@/lib/actions/onboarding', () => ({
  dismissOnboarding: vi.fn(),
  findFirstProjectIdByName: vi.fn(),
}))

const pushSpy = vi.fn()
vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<typeof import('next/navigation')>(
    'next/navigation',
  )
  return {
    ...actual,
    useRouter: () => ({
      push: pushSpy,
      replace: vi.fn(),
      refresh: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
    }),
  }
})

import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow'
import { OnboardingStepCreateWorkspace } from '@/components/onboarding/OnboardingStepCreateWorkspace'
import { OnboardingStepInviteMembers } from '@/components/onboarding/OnboardingStepInviteMembers'

beforeEach(() => {
  pushSpy.mockReset()
  window.localStorage.clear()
})

function makeBindings(over: Partial<{
  createWorkspace: (i: { name: string; slug: string; plan?: 'FREE' | 'PRO' | 'ENTERPRISE' }) => Promise<{ id: string; slug: string }>
  inviteMember: (i: { workspaceId: string; email: string }) => Promise<{ token: string; inviteUrl: string; expiresAt: Date }>
  createProject: (fd: FormData) => Promise<void>
  createTask: (fd: FormData) => Promise<void>
  findFirstProjectIdByName: (name: string) => Promise<string | null>
  dismissOnboarding: () => Promise<{ ok: true }>
}> = {}) {
  return {
    createWorkspace:
      over.createWorkspace ??
      vi.fn(async () => ({ id: 'ws-1', slug: 'avante' })),
    inviteMember:
      over.inviteMember ??
      vi.fn(async () => ({
        token: 'tok',
        inviteUrl: '/invite/tok',
        expiresAt: new Date(),
      })),
    createProject: over.createProject ?? vi.fn(async () => undefined),
    createTask: over.createTask ?? vi.fn(async () => undefined),
    findFirstProjectIdByName:
      over.findFirstProjectIdByName ?? vi.fn(async () => 'proj-1'),
    dismissOnboarding:
      over.dismissOnboarding ?? vi.fn(async () => ({ ok: true as const })),
  }
}

describe('OnboardingFlow', () => {
  it('arranca en el paso 1 (crear workspace) con stepper visible', () => {
    render(<OnboardingFlow bindings={makeBindings()} />)
    expect(screen.getByTestId('onboarding-stepper')).toBeInTheDocument()
    expect(screen.getByTestId('onboarding-step-workspace')).toBeInTheDocument()
    const step1 = screen.getByTestId('onboarding-stepper-1')
    expect(step1).toHaveAttribute('data-active', 'true')
  })

  it('avanza al paso 2 tras crear el workspace', async () => {
    const user = userEvent.setup()
    const bindings = makeBindings()
    render(<OnboardingFlow bindings={bindings} />)

    await user.type(
      screen.getByTestId('onboarding-ws-name'),
      'Avante Transformación',
    )
    await user.click(screen.getByTestId('onboarding-ws-submit'))

    await waitFor(() => {
      expect(bindings.createWorkspace).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-step-invite')).toBeInTheDocument()
    })
  })

  it('permite saltar el paso 2 (invitar miembros)', async () => {
    const user = userEvent.setup()
    // Pre-cargamos estado para empezar en step 2.
    window.localStorage.setItem(
      'fg.onboarding.state',
      JSON.stringify({
        step: 2,
        workspace: { id: 'ws-1', slug: 'avante' },
        invitedCount: 0,
        project: null,
        taskCreated: false,
      }),
    )
    render(<OnboardingFlow bindings={makeBindings()} />)
    await user.click(screen.getByTestId('onboarding-invite-skip'))
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-step-project')).toBeInTheDocument()
    })
  })

  it('botón Atrás regresa al paso anterior', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(
      'fg.onboarding.state',
      JSON.stringify({
        step: 3,
        workspace: { id: 'ws-1', slug: 'avante' },
        invitedCount: 0,
        project: null,
        taskCreated: false,
      }),
    )
    render(<OnboardingFlow bindings={makeBindings()} />)
    expect(screen.getByTestId('onboarding-step-project')).toBeInTheDocument()
    await user.click(screen.getByTestId('onboarding-back'))
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-step-invite')).toBeInTheDocument()
    })
  })

  it('completa el flujo: crea task y redirige a /projects/{id}', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(
      'fg.onboarding.state',
      JSON.stringify({
        step: 4,
        workspace: { id: 'ws-1', slug: 'avante' },
        invitedCount: 0,
        project: { id: 'proj-1', name: 'Demo' },
        taskCreated: false,
      }),
    )
    const bindings = makeBindings()
    render(<OnboardingFlow bindings={bindings} />)

    await user.type(
      screen.getByTestId('onboarding-task-title'),
      'Levantar requerimientos',
    )
    await user.click(screen.getByTestId('onboarding-task-submit'))

    await waitFor(() => {
      expect(bindings.createTask).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(bindings.dismissOnboarding).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(pushSpy).toHaveBeenCalledWith('/projects/proj-1')
    })
  })

  it('persiste el progreso en localStorage al avanzar', async () => {
    const user = userEvent.setup()
    const bindings = makeBindings()
    render(<OnboardingFlow bindings={bindings} />)
    await user.type(
      screen.getByTestId('onboarding-ws-name'),
      'Mi Workspace',
    )
    await user.click(screen.getByTestId('onboarding-ws-submit'))
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-step-invite')).toBeInTheDocument()
    })
    const stored = JSON.parse(
      window.localStorage.getItem('fg.onboarding.state') ?? '{}',
    )
    expect(stored.step).toBe(2)
    expect(stored.workspace?.id).toBe('ws-1')
  })

  it('hidrata desde localStorage al montar', () => {
    window.localStorage.setItem(
      'fg.onboarding.state',
      JSON.stringify({
        step: 3,
        workspace: { id: 'ws-1', slug: 'a' },
        invitedCount: 1,
        project: null,
        taskCreated: false,
      }),
    )
    render(<OnboardingFlow bindings={makeBindings()} />)
    expect(screen.getByTestId('onboarding-step-project')).toBeInTheDocument()
    const step3 = screen.getByTestId('onboarding-stepper-3')
    expect(step3).toHaveAttribute('data-active', 'true')
  })
})

describe('OnboardingStepCreateWorkspace', () => {
  it('deriva slug automáticamente desde el nombre', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => ({ id: 'ws', slug: 'mi-empresa' }))
    render(
      <OnboardingStepCreateWorkspace
        onComplete={() => {}}
        onSubmit={onSubmit}
      />,
    )
    await user.type(screen.getByTestId('onboarding-ws-name'), 'Mi Empresa')
    const slugInput = screen.getByTestId('onboarding-ws-slug') as HTMLInputElement
    expect(slugInput.value).toBe('mi-empresa')
  })

  it('botón submit deshabilitado hasta tener nombre válido', () => {
    render(
      <OnboardingStepCreateWorkspace
        onComplete={() => {}}
        onSubmit={vi.fn(async () => ({ id: 'a', slug: 'a' }))}
      />,
    )
    const submit = screen.getByTestId('onboarding-ws-submit')
    expect(submit).toBeDisabled()
  })
})

describe('OnboardingStepInviteMembers', () => {
  it('agrega y elimina emails de la lista', async () => {
    const user = userEvent.setup()
    render(
      <OnboardingStepInviteMembers
        workspaceId="ws-1"
        onComplete={() => {}}
        onSkip={() => {}}
        onInvite={vi.fn(async () => ({ token: 't' }))}
      />,
    )
    const input = screen.getByTestId('onboarding-invite-input')
    await user.type(input, 'foo@bar.com')
    await user.click(screen.getByTestId('onboarding-invite-add'))

    expect(
      screen.getByTestId('onboarding-invite-item-foo@bar.com'),
    ).toBeInTheDocument()

    await user.click(screen.getByLabelText('Eliminar foo@bar.com'))
    expect(
      screen.queryByTestId('onboarding-invite-item-foo@bar.com'),
    ).not.toBeInTheDocument()
  })

  it('rechaza emails con formato inválido', async () => {
    const user = userEvent.setup()
    render(
      <OnboardingStepInviteMembers
        workspaceId="ws-1"
        onComplete={() => {}}
        onSkip={() => {}}
        onInvite={vi.fn(async () => ({ token: 't' }))}
      />,
    )
    await user.type(screen.getByTestId('onboarding-invite-input'), 'no-email')
    await user.click(screen.getByTestId('onboarding-invite-add'))
    expect(
      screen.queryByTestId('onboarding-invite-item-no-email'),
    ).not.toBeInTheDocument()
  })
})
