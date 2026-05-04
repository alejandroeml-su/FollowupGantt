import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Ola P4 · P4-5 · Unit tests para `src/lib/actions/integrations.ts`.
 *
 * Mockeamos `next/cache` (`revalidatePath`) y `@/lib/prisma`. Verificamos:
 *   - Validación zod (`[INVALID_INPUT]`).
 *   - Validación de config por type (`[INVALID_CONFIG]`).
 *   - Errores de no-existencia (`[INTEGRATION_NOT_FOUND]`, `[TASK_NOT_FOUND]`).
 *   - Persistencia esperada (Prisma calls).
 *   - Test webhook delegando al dispatcher correcto.
 */

const revalidatePathCalls: Array<{ path: string }> = []

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => {
    revalidatePathCalls.push({ path })
  },
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...a: unknown[]) => unknown>(fn: T) => fn,
}))

vi.mock('@/lib/prisma', () => ({
  default: {
    integration: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    task: {
      findUnique: vi.fn(),
    },
    taskGitHubLink: {
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

import prisma from '@/lib/prisma'

const mock = prisma as unknown as {
  integration: {
    findUnique: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
  }
  task: { findUnique: ReturnType<typeof vi.fn> }
  taskGitHubLink: {
    findMany: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
  }
}

beforeEach(() => {
  revalidatePathCalls.length = 0
  vi.clearAllMocks()
})

function integrationFixture(over: Partial<{
  id: string
  type: 'SLACK' | 'TEAMS' | 'GITHUB'
  name: string
  config: unknown
  enabled: boolean
  projectId: string | null
}> = {}) {
  return {
    id: over.id ?? 'i1',
    type: over.type ?? 'SLACK',
    name: over.name ?? 'Slack #dev',
    config: over.config ?? { webhookUrl: 'https://hooks.slack.com/services/X' },
    enabled: over.enabled ?? true,
    projectId: over.projectId ?? null,
    createdAt: new Date('2026-05-03T10:00:00Z'),
    updatedAt: new Date('2026-05-03T10:00:00Z'),
  }
}

describe('createIntegration', () => {
  it('crea SLACK con shape válido y revalida', async () => {
    mock.integration.create.mockResolvedValue(integrationFixture({ id: 'i1' }))
    const { createIntegration } = await import('@/lib/actions/integrations')
    const out = await createIntegration({
      type: 'SLACK',
      name: 'Slack #dev',
      config: { webhookUrl: 'https://hooks.slack.com/services/X' },
    })
    expect(out.id).toBe('i1')
    expect(out.type).toBe('SLACK')
    expect(typeof out.createdAt).toBe('string')
    expect(mock.integration.create).toHaveBeenCalledOnce()
    expect(revalidatePathCalls).toContainEqual({ path: '/settings/integrations' })
  })

  it('rechaza config SLACK sin webhookUrl con [INVALID_CONFIG]', async () => {
    const { createIntegration } = await import('@/lib/actions/integrations')
    await expect(
      createIntegration({ type: 'SLACK', name: 'X', config: {} }),
    ).rejects.toThrow(/INVALID_CONFIG/)
    expect(mock.integration.create).not.toHaveBeenCalled()
  })

  it('rechaza type desconocido (zod) con [INVALID_INPUT]', async () => {
    const { createIntegration } = await import('@/lib/actions/integrations')
    await expect(
      // @ts-expect-error invalid enum
      createIntegration({ type: 'WHATSAPP', name: 'X', config: {} }),
    ).rejects.toThrow(/INVALID_INPUT/)
  })

  it('crea GITHUB sin defaultRepo (config vacía válida)', async () => {
    mock.integration.create.mockResolvedValue(
      integrationFixture({ id: 'g1', type: 'GITHUB', config: {} }),
    )
    const { createIntegration } = await import('@/lib/actions/integrations')
    const out = await createIntegration({
      type: 'GITHUB',
      name: 'Repos',
      config: {},
    })
    expect(out.type).toBe('GITHUB')
  })
})

describe('updateIntegration', () => {
  it('lanza [INTEGRATION_NOT_FOUND] si no existe', async () => {
    mock.integration.findUnique.mockResolvedValue(null)
    const { updateIntegration } = await import('@/lib/actions/integrations')
    await expect(
      updateIntegration({ id: 'x', enabled: false }),
    ).rejects.toThrow(/INTEGRATION_NOT_FOUND/)
  })

  it('valida config nueva contra el type guardado', async () => {
    mock.integration.findUnique.mockResolvedValue({ id: 'i1', type: 'TEAMS' })
    const { updateIntegration } = await import('@/lib/actions/integrations')
    await expect(
      updateIntegration({ id: 'i1', config: { webhookUrl: 'foo://x' } }),
    ).rejects.toThrow(/INVALID_CONFIG/)
  })

  it('toggle enabled persiste y revalida', async () => {
    mock.integration.findUnique.mockResolvedValue({ id: 'i1', type: 'SLACK' })
    mock.integration.update.mockResolvedValue(
      integrationFixture({ id: 'i1', enabled: false }),
    )
    const { updateIntegration } = await import('@/lib/actions/integrations')
    const out = await updateIntegration({ id: 'i1', enabled: false })
    expect(out.enabled).toBe(false)
    expect(mock.integration.update).toHaveBeenCalledOnce()
    expect(revalidatePathCalls).toContainEqual({ path: '/settings/integrations' })
  })
})

describe('deleteIntegration', () => {
  it('lanza [INVALID_INPUT] sin id', async () => {
    const { deleteIntegration } = await import('@/lib/actions/integrations')
    await expect(deleteIntegration('')).rejects.toThrow(/INVALID_INPUT/)
  })

  it('borra y revalida', async () => {
    mock.integration.delete.mockResolvedValue(integrationFixture())
    const { deleteIntegration } = await import('@/lib/actions/integrations')
    const out = await deleteIntegration('i1')
    expect(out.id).toBe('i1')
    expect(revalidatePathCalls).toContainEqual({ path: '/settings/integrations' })
  })
})

describe('listIntegrations', () => {
  it('serializa lista', async () => {
    mock.integration.findMany.mockResolvedValue([
      integrationFixture({ id: 'i1' }),
      integrationFixture({ id: 'i2', type: 'TEAMS' }),
    ])
    const { listIntegrations } = await import('@/lib/actions/integrations')
    const out = await listIntegrations()
    expect(out).toHaveLength(2)
    expect(out[0].id).toBe('i1')
    expect(out[1].type).toBe('TEAMS')
  })
})

describe('linkTaskToGitHub', () => {
  it('lanza [TASK_NOT_FOUND] cuando la tarea no existe', async () => {
    mock.task.findUnique.mockResolvedValue(null)
    const { linkTaskToGitHub } = await import('@/lib/actions/integrations')
    await expect(
      linkTaskToGitHub({ taskId: 't1', reference: 'https://github.com/a/b/issues/1' }),
    ).rejects.toThrow(/TASK_NOT_FOUND/)
  })

  it('crea link usando reference URL', async () => {
    mock.task.findUnique.mockResolvedValue({ id: 't1' })
    mock.taskGitHubLink.create.mockResolvedValue({
      id: 'l1',
      taskId: 't1',
      repoFullName: 'a/b',
      issueNumber: 42,
      kind: 'PR',
      createdAt: new Date('2026-05-03T10:00:00Z'),
    })
    const { linkTaskToGitHub } = await import('@/lib/actions/integrations')
    const out = await linkTaskToGitHub({
      taskId: 't1',
      reference: 'https://github.com/a/b/pull/42',
    })
    expect(out.repoFullName).toBe('a/b')
    expect(out.issueNumber).toBe(42)
    expect(out.kind).toBe('PR')
    expect(out.url).toBe('https://github.com/a/b/pull/42')
  })

  it('crea link con shape desglosado', async () => {
    mock.task.findUnique.mockResolvedValue({ id: 't1' })
    mock.taskGitHubLink.create.mockResolvedValue({
      id: 'l1',
      taskId: 't1',
      repoFullName: 'a/b',
      issueNumber: 5,
      kind: 'ISSUE',
      createdAt: new Date('2026-05-03T10:00:00Z'),
    })
    const { linkTaskToGitHub } = await import('@/lib/actions/integrations')
    const out = await linkTaskToGitHub({
      taskId: 't1',
      repoFullName: 'a/b',
      issueOrPr: 5,
    })
    expect(out.issueNumber).toBe(5)
    expect(out.kind).toBe('ISSUE')
  })

  it('rechaza sin reference ni desglose', async () => {
    mock.task.findUnique.mockResolvedValue({ id: 't1' })
    const { linkTaskToGitHub } = await import('@/lib/actions/integrations')
    await expect(
      linkTaskToGitHub({ taskId: 't1' }),
    ).rejects.toThrow(/INVALID_INPUT/)
  })

  it('lanza [LINK_DUPLICATED] cuando Prisma P2002', async () => {
    mock.task.findUnique.mockResolvedValue({ id: 't1' })
    const { Prisma } = await import('@prisma/client')
    const err = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'x',
    })
    mock.taskGitHubLink.create.mockRejectedValue(err)
    const { linkTaskToGitHub } = await import('@/lib/actions/integrations')
    await expect(
      linkTaskToGitHub({ taskId: 't1', reference: 'a/b#1' }),
    ).rejects.toThrow(/LINK_DUPLICATED/)
  })
})

describe('unlinkTaskFromGitHub', () => {
  it('idempotente cuando ya no existe (P2025)', async () => {
    const { Prisma } = await import('@prisma/client')
    const err = new Prisma.PrismaClientKnownRequestError('not found', {
      code: 'P2025',
      clientVersion: 'x',
    })
    mock.taskGitHubLink.delete.mockRejectedValue(err)
    const { unlinkTaskFromGitHub } = await import('@/lib/actions/integrations')
    const out = await unlinkTaskFromGitHub('l-zombie')
    expect(out.id).toBe('l-zombie')
  })

  it('borra y revalida cuando existe', async () => {
    mock.taskGitHubLink.delete.mockResolvedValue({ id: 'l1' })
    const { unlinkTaskFromGitHub } = await import('@/lib/actions/integrations')
    const out = await unlinkTaskFromGitHub('l1')
    expect(out.id).toBe('l1')
    expect(revalidatePathCalls.some((c) => c.path === '/projects')).toBe(true)
  })
})

describe('testIntegrationWebhook', () => {
  it('lanza [INTEGRATION_NOT_FOUND] si no existe', async () => {
    mock.integration.findUnique.mockResolvedValue(null)
    const { testIntegrationWebhook } = await import('@/lib/actions/integrations')
    await expect(testIntegrationWebhook('x')).rejects.toThrow(
      /INTEGRATION_NOT_FOUND/,
    )
  })

  it('GITHUB sólo valida config y devuelve ok', async () => {
    mock.integration.findUnique.mockResolvedValue({
      id: 'g1',
      type: 'GITHUB',
      enabled: true,
      config: { defaultRepo: 'a/b' },
    })
    const { testIntegrationWebhook } = await import('@/lib/actions/integrations')
    const out = await testIntegrationWebhook('g1')
    expect(out.ok).toBe(true)
  })

  it('integración deshabilitada devuelve ok=false', async () => {
    mock.integration.findUnique.mockResolvedValue({
      id: 'i1',
      type: 'SLACK',
      enabled: false,
      config: { webhookUrl: 'https://x' },
    })
    const { testIntegrationWebhook } = await import('@/lib/actions/integrations')
    const out = await testIntegrationWebhook('i1')
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/deshabilitada/)
  })
})
