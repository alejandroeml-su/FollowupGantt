import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Ola P4 · P4-5 · Unit tests para `src/lib/integrations/teams.ts`.
 *
 * Verifica:
 *   - Validación de config TEAMS.
 *   - Helpers Adaptive Card v1.4 (estructura body + actions opcionales).
 *   - Wrapping del payload en `attachments[0]` para el connector de Teams.
 *   - Manejo de errores network/HTTP.
 */

vi.mock('@/lib/prisma', () => ({
  default: {
    integration: { findUnique: vi.fn() },
  },
}))

import prisma from '@/lib/prisma'
import {
  validateTeamsConfig,
  buildTaskAssignedCard,
  buildTaskCompletedCard,
  buildBaselineCapturedCard,
  dispatchTeamsCard,
  type AdaptiveCard,
} from '@/lib/integrations/teams'

const mock = prisma as unknown as {
  integration: { findUnique: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('validateTeamsConfig', () => {
  it('retorna webhookUrl válido', () => {
    const out = validateTeamsConfig({
      webhookUrl: 'https://outlook.office.com/webhook/abc',
    })
    expect(out.webhookUrl).toMatch(/^https:/)
  })

  it('rechaza shape inválido', () => {
    expect(() => validateTeamsConfig({ webhookUrl: '' })).toThrow(
      /INVALID_CONFIG/,
    )
    expect(() => validateTeamsConfig({ webhookUrl: 'foo://bar' })).toThrow(
      /INVALID_CONFIG.*http/,
    )
    expect(() => validateTeamsConfig(null)).toThrow(/INVALID_CONFIG/)
  })
})

describe('build*Card helpers', () => {
  it('buildTaskAssignedCard incluye TextBlock + FactSet + Action.OpenUrl', () => {
    const card = buildTaskAssignedCard({
      taskTitle: 'X',
      assigneeName: 'Edwin',
      projectName: 'P',
      link: 'https://app',
    })
    expect(card.type).toBe('AdaptiveCard')
    expect(card.version).toBe('1.4')
    expect((card.body[0] as { type: string }).type).toBe('TextBlock')
    expect((card.body[1] as { type: string }).type).toBe('FactSet')
    expect(card.actions?.[0]).toMatchObject({ type: 'Action.OpenUrl', url: 'https://app' })
  })

  it('buildTaskCompletedCard sin link omite actions', () => {
    const card = buildTaskCompletedCard({ taskTitle: 'X' })
    expect(card.actions).toBeUndefined()
  })

  it('buildBaselineCapturedCard incluye versión', () => {
    const card = buildBaselineCapturedCard({
      projectName: 'X',
      version: 5,
      label: null,
    })
    const body = JSON.stringify(card.body)
    expect(body).toMatch(/v5/)
  })
})

describe('dispatchTeamsCard', () => {
  const card: AdaptiveCard = {
    type: 'AdaptiveCard',
    version: '1.4',
    body: [{ type: 'TextBlock', text: 'hi' }],
  }

  it('lanza [INTEGRATION_NOT_FOUND] si la integración no existe', async () => {
    mock.integration.findUnique.mockResolvedValue(null)
    await expect(dispatchTeamsCard('x', card)).rejects.toThrow(
      /INTEGRATION_NOT_FOUND/,
    )
  })

  it('lanza [INVALID_CONFIG] si type no es TEAMS', async () => {
    mock.integration.findUnique.mockResolvedValue({
      id: 'id1',
      type: 'SLACK',
      enabled: true,
      config: { webhookUrl: 'https://x' },
    })
    await expect(dispatchTeamsCard('id1', card)).rejects.toThrow(
      /INVALID_CONFIG.*TEAMS/,
    )
  })

  it('skip cuando enabled=false', async () => {
    mock.integration.findUnique.mockResolvedValue({
      id: 'id1',
      type: 'TEAMS',
      enabled: false,
      config: { webhookUrl: 'https://x' },
    })
    const fetcher = vi.fn()
    const res = await dispatchTeamsCard('id1', card, {
      fetcher: fetcher as unknown as typeof fetch,
    })
    expect(res).toEqual({ ok: true, skipped: true })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('envuelve el card en attachments y POSTea', async () => {
    mock.integration.findUnique.mockResolvedValue({
      id: 'id1',
      type: 'TEAMS',
      enabled: true,
      config: { webhookUrl: 'https://outlook.office.com/webhook/abc' },
    })
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const res = await dispatchTeamsCard('id1', card, {
      fetcher: fetcher as unknown as typeof fetch,
    })
    expect(res.ok).toBe(true)
    const init = fetcher.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string)
    expect(body.type).toBe('message')
    expect(body.attachments).toHaveLength(1)
    expect(body.attachments[0].contentType).toBe(
      'application/vnd.microsoft.card.adaptive',
    )
    expect(body.attachments[0].content).toMatchObject({
      type: 'AdaptiveCard',
      version: '1.4',
    })
  })

  it('mapa HTTP error a [WEBHOOK_FAILED]', async () => {
    mock.integration.findUnique.mockResolvedValue({
      id: 'id1',
      type: 'TEAMS',
      enabled: true,
      config: { webhookUrl: 'https://x' },
    })
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'oops',
    })
    const res = await dispatchTeamsCard('id1', card, {
      fetcher: fetcher as unknown as typeof fetch,
    })
    expect(res.ok).toBe(false)
    expect(res.status).toBe(500)
    expect(res.error).toMatch(/WEBHOOK_FAILED/)
  })
})
