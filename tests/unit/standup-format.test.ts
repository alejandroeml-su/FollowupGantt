/**
 * Ola P7 · Equipo P7-4 · Daily Standup — Tests del render Slack.
 *
 * Cubre:
 *   - Block Kit produce text + blocks.
 *   - Header + summary + ayer + hoy.
 *   - Section bloqueos sólo si hay.
 *   - Mention map renderiza `<@ID>`; sin map cae al texto plano.
 *   - Escape de caracteres mrkdwn (&, <, >).
 *   - Truncado de section sobre 2900 chars.
 *   - PlainText render incluye emojis y bullet structure.
 *   - Compatible con interfaz `SlackBlockKitMessage` (text presente).
 */

import { describe, it, expect } from 'vitest'
import {
  formatStandupForSlack,
  formatStandupAsPlainText,
} from '@/lib/ai/standup/format-slack'
import type { Standup } from '@/lib/ai/standup/standup-schema'

function baseStandup(): Standup {
  return {
    date: '2026-05-04',
    participants: ['Alice', 'Bob'],
    yesterday: [{ user: 'Alice', items: ['Cerré PR #12'] }],
    today: [{ user: 'Bob', items: ['Implementar API /standup'] }],
    blockers: [],
    summaryShort: 'Buen día equipo, todo en marcha.',
    summaryFull: '**Hoy:** progreso esperado.',
  }
}

describe('formatStandupForSlack', () => {
  it('genera text + blocks con header y summary', () => {
    const out = formatStandupForSlack(baseStandup())
    expect(out.text).toBe('Buen día equipo, todo en marcha.')
    const types = out.blocks.map((b) => b.type)
    expect(types[0]).toBe('header')
    expect(types).toContain('section')
    expect(types).toContain('divider')
    // Footer context.
    expect(types[types.length - 1]).toBe('context')
  })

  it('incluye sección de bloqueos sólo si hay', () => {
    const without = formatStandupForSlack(baseStandup())
    const blockerSection = without.blocks.find(
      (b) =>
        b.type === 'section' &&
        typeof (b as { text?: { text: string } }).text?.text === 'string' &&
        ((b as { text: { text: string } }).text.text.includes(':warning:')),
    )
    expect(blockerSection).toBeUndefined()

    const withBlockers = formatStandupForSlack({
      ...baseStandup(),
      blockers: [
        {
          user: 'Carla',
          description: 'API caída',
          suggestedAction: 'Llamar a infra',
        },
      ],
    })
    const found = withBlockers.blocks.find(
      (b) =>
        b.type === 'section' &&
        typeof (b as { text?: { text: string } }).text?.text === 'string' &&
        (b as { text: { text: string } }).text.text.includes(':warning:'),
    )
    expect(found).toBeDefined()
    const text = (found as { text: { text: string } }).text.text
    expect(text).toContain('Carla')
    expect(text).toContain('API caída')
    expect(text).toContain(':bulb:')
  })

  it('aplica userMentionMap como `<@ID>`', () => {
    const out = formatStandupForSlack(baseStandup(), {
      userMentionMap: { Alice: 'U001', Bob: 'U002' },
    })
    const sections = out.blocks
      .filter((b) => b.type === 'section')
      .map((b) => (b as { text: { text: string } }).text.text)
      .join('\n')
    expect(sections).toContain('<@U001>')
    expect(sections).toContain('<@U002>')
  })

  it('sin mention map, deja texto plano del usuario', () => {
    const out = formatStandupForSlack(baseStandup())
    const sections = out.blocks
      .filter((b) => b.type === 'section')
      .map((b) => (b as { text: { text: string } }).text.text)
      .join('\n')
    expect(sections).toContain('Alice')
    expect(sections).not.toContain('<@')
  })

  it('escapa caracteres mrkdwn (&, <, >)', () => {
    const out = formatStandupForSlack({
      ...baseStandup(),
      yesterday: [
        {
          user: 'Edge<>Case',
          items: ['fix A & B <crash>'],
        },
      ],
    })
    const sections = out.blocks
      .filter((b) => b.type === 'section')
      .map((b) => (b as { text: { text: string } }).text.text)
      .join('\n')
    expect(sections).toContain('Edge&lt;&gt;Case')
    expect(sections).toContain('&amp;')
    expect(sections).toContain('&lt;crash&gt;')
  })

  it('truncar sections que excedan límite de Slack', () => {
    const longItems = Array.from({ length: 10 }, (_, i) =>
      `${i}-${'x'.repeat(280)}`.slice(0, 280),
    )
    const out = formatStandupForSlack({
      ...baseStandup(),
      yesterday: [{ user: 'Alice', items: longItems }],
    })
    const longestSection = Math.max(
      ...out.blocks
        .filter((b) => b.type === 'section')
        .map((b) => ((b as { text: { text: string } }).text.text ?? '').length),
    )
    expect(longestSection).toBeLessThanOrEqual(2900)
  })

  it('agrega botón actions cuando se pasa appUrl', () => {
    const out = formatStandupForSlack(baseStandup(), {
      appUrl: 'https://gantt.example.com/standup',
    })
    const actions = out.blocks.find((b) => b.type === 'actions')
    expect(actions).toBeDefined()
  })
})

describe('formatStandupAsPlainText', () => {
  it('incluye date, summaryShort y bullets', () => {
    const text = formatStandupAsPlainText(baseStandup())
    expect(text).toContain('2026-05-04')
    expect(text).toContain('Buen día equipo')
    expect(text).toContain(':white_check_mark:')
    expect(text).toContain(':rocket:')
    expect(text).toContain('Cerré PR #12')
    expect(text).toContain('Implementar API /standup')
  })

  it('omite bloqueos si no hay; los muestra si existen', () => {
    const noBlockers = formatStandupAsPlainText(baseStandup())
    expect(noBlockers).not.toContain(':warning:')

    const withBlockers = formatStandupAsPlainText({
      ...baseStandup(),
      blockers: [{ user: 'Carla', description: 'X', suggestedAction: 'Y' }],
    })
    expect(withBlockers).toContain(':warning:')
    expect(withBlockers).toContain('Carla')
    expect(withBlockers).toContain('X')
    expect(withBlockers).toContain('Y')
  })

  it('renderiza placeholder cuando ayer/hoy están vacíos', () => {
    const text = formatStandupAsPlainText({
      ...baseStandup(),
      yesterday: [],
      today: [],
    })
    expect(text).toContain('— sin items —')
  })
})
