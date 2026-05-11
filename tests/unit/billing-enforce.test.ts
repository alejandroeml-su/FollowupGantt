import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Wave R4-E · Tests del módulo `enforce.ts`.
 *
 * Mockeamos `@/lib/billing/subscription` y `@/lib/prisma` para no tocar
 * BD ni Stripe. La intención del test es validar la lógica de gating, no
 * la persistencia.
 */

const getSub = vi.fn()
const projectCount = vi.fn()
const memberCount = vi.fn()
const inviteCount = vi.fn()
const workspaceFindUnique = vi.fn()

vi.mock('@/lib/billing/subscription', () => ({
  getWorkspaceSubscription: (...args: unknown[]) => getSub(...args),
}))

vi.mock('@/lib/prisma', () => ({
  default: {
    project: { count: (...args: unknown[]) => projectCount(...args) },
    workspaceMember: { count: (...args: unknown[]) => memberCount(...args) },
    workspaceInvitation: { count: (...args: unknown[]) => inviteCount(...args) },
    workspace: { findUnique: (...args: unknown[]) => workspaceFindUnique(...args) },
  },
}))

beforeEach(() => {
  getSub.mockReset()
  projectCount.mockReset()
  memberCount.mockReset()
  inviteCount.mockReset()
  workspaceFindUnique.mockReset()
})

function setSub(tier: string, isActive = true) {
  getSub.mockResolvedValue({
    tier,
    isActive,
    status: isActive ? 'active' : 'past_due',
    stripeCustomerId: 'cus_test',
    stripeSubscriptionId: 'sub_test',
    currentPeriodEnd: null,
    cancelAt: null,
    trialEndsAt: null,
    seats: 1,
  })
}

describe('requireFeature', () => {
  it('FREE puede usar gantt sin lanzar', async () => {
    setSub('FREE')
    const { requireFeature } = await import('@/lib/billing/enforce')
    await expect(requireFeature('ws-1', 'gantt')).resolves.toBeUndefined()
  })

  it('FREE NO puede usar evm — throws [FEATURE_NOT_AVAILABLE]', async () => {
    setSub('FREE')
    const { requireFeature } = await import('@/lib/billing/enforce')
    await expect(requireFeature('ws-1', 'evm')).rejects.toThrow(/FEATURE_NOT_AVAILABLE/)
  })

  it('PRO sí puede usar evm', async () => {
    setSub('PRO')
    const { requireFeature } = await import('@/lib/billing/enforce')
    await expect(requireFeature('ws-1', 'evm')).resolves.toBeUndefined()
  })

  it('ENTERPRISE puede cualquier feature (wildcard)', async () => {
    setSub('ENTERPRISE')
    const { requireFeature } = await import('@/lib/billing/enforce')
    await expect(requireFeature('ws-1', 'futuristic_module')).resolves.toBeUndefined()
  })

  it('PRO past_due degrada a FREE para gates — bloquea monte_carlo', async () => {
    setSub('PRO', false)
    const { requireFeature } = await import('@/lib/billing/enforce')
    await expect(requireFeature('ws-1', 'monte_carlo')).rejects.toThrow(
      /FEATURE_NOT_AVAILABLE/,
    )
  })

  it('lanza [INVALID_INPUT] si falta workspaceId', async () => {
    const { requireFeature } = await import('@/lib/billing/enforce')
    await expect(requireFeature('', 'gantt')).rejects.toThrow(/INVALID_INPUT/)
  })
})

describe('requireCapacity', () => {
  it('FREE permite hasta 3 users (current=2 ok)', async () => {
    setSub('FREE')
    const { requireCapacity } = await import('@/lib/billing/enforce')
    await expect(requireCapacity('ws-1', 'users', 2)).resolves.toBeUndefined()
  })

  it('FREE NO permite 3er user (current=3) → CAPACITY_EXCEEDED', async () => {
    setSub('FREE')
    const { requireCapacity } = await import('@/lib/billing/enforce')
    await expect(requireCapacity('ws-1', 'users', 3)).rejects.toThrow(
      /CAPACITY_EXCEEDED/,
    )
  })

  it('PRO permite 24 users pero NO 25', async () => {
    setSub('PRO')
    const { requireCapacity } = await import('@/lib/billing/enforce')
    await expect(requireCapacity('ws-1', 'users', 24)).resolves.toBeUndefined()
    await expect(requireCapacity('ws-1', 'users', 25)).rejects.toThrow(
      /CAPACITY_EXCEEDED/,
    )
  })

  it('ENTERPRISE permite users ilimitados', async () => {
    setSub('ENTERPRISE')
    const { requireCapacity } = await import('@/lib/billing/enforce')
    await expect(requireCapacity('ws-1', 'users', 9_999)).resolves.toBeUndefined()
  })

  it('requireProjectCapacity lee count de Prisma', async () => {
    setSub('PRO')
    projectCount.mockResolvedValue(5)
    const { requireProjectCapacity } = await import('@/lib/billing/enforce')
    await expect(requireProjectCapacity('ws-1')).resolves.toBeUndefined()
    expect(projectCount).toHaveBeenCalled()
  })

  it('requireProjectCapacity throws si excede límite', async () => {
    setSub('FREE')
    projectCount.mockResolvedValue(1)
    const { requireProjectCapacity } = await import('@/lib/billing/enforce')
    await expect(requireProjectCapacity('ws-1')).rejects.toThrow(/CAPACITY_EXCEEDED/)
  })

  it('requireMemberCapacity suma members + invitations pendientes', async () => {
    setSub('FREE')
    memberCount.mockResolvedValue(2)
    inviteCount.mockResolvedValue(1) // 2 + 1 = 3 → FREE rechaza
    const { requireMemberCapacity } = await import('@/lib/billing/enforce')
    await expect(requireMemberCapacity('ws-1')).rejects.toThrow(/CAPACITY_EXCEEDED/)
  })

  it('lanza [INVALID_INPUT] si current es negativo', async () => {
    setSub('FREE')
    const { requireCapacity } = await import('@/lib/billing/enforce')
    await expect(requireCapacity('ws-1', 'users', -1)).rejects.toThrow(/INVALID_INPUT/)
  })

  it('brainCalls FREE permite hasta 49 pero no 50', async () => {
    setSub('FREE')
    const { requireCapacity } = await import('@/lib/billing/enforce')
    await expect(requireCapacity('ws-1', 'brainCalls', 49)).resolves.toBeUndefined()
    await expect(requireCapacity('ws-1', 'brainCalls', 50)).rejects.toThrow(
      /CAPACITY_EXCEEDED/,
    )
  })
})
