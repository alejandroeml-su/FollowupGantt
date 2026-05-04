import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Ola P4 · P4-5 · Unit tests para `src/lib/integrations/slack.ts`.
 *
 * Mockeamos `@/lib/prisma` y un `fetcher` inyectable para verificar:
 *   - Validación de config (`[INVALID_CONFIG]`).
 *   - Resolución de integration (`[INTEGRATION_NOT_FOUND]`, type mismatch).
 *   - Skipping cuando `enabled=false`.
 *   - Payload Block Kit con headers correctos.
 *   - Manejo de fallos HTTP/network → `[WEBHOOK_FAILED]`.
 */

vi.mock('@/lib/prisma', () => ({
  default: {
    integration: {
      findUnique: vi.fn(),
    },
  },
}))

import prisma from '@/lib/prisma'
import {
  validateSlackConfig,
  buildTaskAssignedBlocks,
  buildTaskCompletedBlocks,
  buildBaselineCapturedBlocks,
  dispatchSlackNotification,
} from '@/lib/integrations/slack'

const mock = prisma as unknown as {
  integration: { findUnique: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('validateSlackConfig', () => {
  it('acepta config válida y retorna webhookUrl + channel', () => {
    const out = validateSlackConfig({
      webhookUrl: 'https://hooks.slack.com/services/X/Y/Z',
      channel: '#general',
    })
    expect(out.webhookUrl).toBe('https://hooks.slack.com/services/X/Y/Z')
    expect(out.channel).toBe('#general')
  })

  it('rechaza config no objeto', () => {
    expect(() => validateSlackConfig(null)).toThrow(/INVALID_CONFIG/)
    expect(() => validateSlackConfig('foo')).toThrow(/INVALID_CONFIG/)
  })

  it('rechaza webhookUrl ausente', () => {
    expect(() => validateSlackConfig({})).toThrow(/INVALID_CONFIG.*webhookUrl/)
  })

  it('rechaza webhookUrl no http(s)', () => {
    expect(() =>
      validateSlackConfig({ webhookUrl: 'ftp://hooks.slack.com/x' }),
    ).toThrow(/INVALID_CONFIG.*http/)
  })
})

describe('build*Blocks helpers', () => {
  it('buildTaskAssignedBlocks construye header + section + button', () => {
    const msg = buildTaskAssignedBlocks({
      taskTitle: 'Implementar SSO',
      assigneeName: 'Edwin',
      projectName: 'FollowupGantt',
      link: 'https://app/tasks/1',
    })
    expect(msg.text).toMatch(/Implementar SSO/)
    expect(msg.blocks).toBeDefined()
    expect(msg.blocks!.length).toBe(3)
    expect((msg.blocks![0] as { type: string }).type).toBe('header')
  })

  it('buildTaskCompletedBlocks omite link cuando no se pasa', () => {
    const msg = buildTaskCompletedBlocks({ taskTitle: 'Cerrar bug' })
    expect(msg.blocks!.some((b) => (b as { type: string }).type === 'actions')).toBe(
      false,
    )
  })

  it('buildBaselineCapturedBlocks incluye versión y label', () => {
    const msg = buildBaselineCapturedBlocks({
      projectName: 'X',
      version: 3,
      label: 'pre-release',
    })
    const sectionText = JSON.stringify(msg.blocks)
    expect(sectionText).toMatch(/v3/)
    expect(sectionText).toMatch(/pre-release/)
  })
})

describe('dispatchSlackNotification', () => {
  it('lanza [INTEGRATION_NOT_FOUND] si id vacío', async () => {
    await expect(
      dispatchSlackNotification('', { text: 'x' }),
    ).rejects.toThrow(/INTEGRATION_NOT_FOUND/)
  })

  it('lanza [INTEGRATION_NOT_FOUND] si la integración no existe', async () => {
    mock.integration.findUnique.mockResolvedValue(null)
    await expect(
      dispatchSlackNotification('id1', { text: 'x' }),
    ).rejects.toThrow(/INTEGRATION_NOT_FOUND/)
  })

  it('lanza [INVALID_CONFIG] si el type no es SLACK', async () => {
    mock.integration.findUnique.mockResolvedValue({
      id: 'id1',
      type: 'TEAMS',
      enabled: true,
      config: { webhookUrl: 'https://x' },
    })
    await expect(
      dispatchSlackNotification('id1', { text: 'x' }),
    ).rejects.toThrow(/INVALID_CONFIG.*SLACK/)
  })

  it('skip silencioso cuando enabled=false', async () => {
    mock.integration.findUnique.mockResolvedValue({
      id: 'id1',
      type: 'SLACK',
      enabled: false,
      config: { webhookUrl: 'https://x' },
    })
    const fetcher = vi.fn()
    const res = await dispatchSlackNotification('id1', { text: 'x' }, { fetcher: fetcher as unknown as typeof fetch })
    expect(res).toEqual({ ok: true, skipped: true })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('POSTea Block Kit JSON con channel del config', async () => {
    mock.integration.findUnique.mockResolvedValue({
      id: 'id1',
      type: 'SLACK',
      enabled: true,
      config: { webhookUrl: 'https://hooks.slack.com/services/A', channel: '#dev' },
    })
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const res = await dispatchSlackNotification(
      'id1',
      { text: 'hi', blocks: [{ type: 'section' }] },
      { fetcher: fetcher as unknown as typeof fetch },
    )
    expect(res.ok).toBe(true)
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://hooks.slack.com/services/A')
    const init0 = init as RequestInit
    expect(init0.method).toBe('POST')
    const body = JSON.parse(init0.body as string)
    expect(body.text).toBe('hi')
    expect(body.channel).toBe('#dev')
    expect(body.blocks).toEqual([{ type: 'section' }])
  })

  it('mapa fetch error a [WEBHOOK_FAILED]', async () => {
    mock.integration.findUnique.mockResolvedValue({
      id: 'id1',
      type: 'SLACK',
      enabled: true,
      config: { webhookUrl: 'https://x' },
    })
    const fetcher = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await dispatchSlackNotification(
      'id1',
      { text: 'x' },
      { fetcher: fetcher as unknown as typeof fetch },
    )
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/WEBHOOK_FAILED/)
  })

  it('mapa HTTP non-ok a [WEBHOOK_FAILED] con status', async () => {
    mock.integration.findUnique.mockResolvedValue({
      id: 'id1',
      type: 'SLACK',
      enabled: true,
      config: { webhookUrl: 'https://x' },
    })
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'channel_not_found',
    })
    const res = await dispatchSlackNotification(
      'id1',
      { text: 'x' },
      { fetcher: fetcher as unknown as typeof fetch },
    )
    expect(res.ok).toBe(false)
    expect(res.status).toBe(404)
    expect(res.error).toMatch(/WEBHOOK_FAILED.*404/)
  })
})
