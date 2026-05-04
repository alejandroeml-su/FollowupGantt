/**
 * Ola P7 · Equipo P7-4 · Daily Standup — Render Slack-ready.
 *
 * Convierte un `Standup` a un payload Block Kit compatible con
 * `dispatchSlackNotification` (`src/lib/integrations/slack.ts`). El
 * cron diario invoca `formatStandupForSlack` y lo entrega al webhook
 * configurado por la integración.
 *
 * Mentions:
 *   - Slack requiere `<@SLACK_USER_ID>` (no email). Como FollowupGantt
 *     no almacena el Slack ID por ahora, se acepta un mapa opcional
 *     `userMentionMap: { [emailOrName]: SlackUserId }`. Si no hay match,
 *     se renderiza el nombre/email plano.
 *
 * Formato:
 *   - Header con título + fecha.
 *   - Section con summaryShort (mrkdwn).
 *   - Divider.
 *   - Section "Ayer" + bullet list por usuario.
 *   - Section "Hoy" + bullet list por usuario.
 *   - Section "Bloqueos" (si hay) + bullet list con suggestedAction.
 *   - Context footer con summaryFull truncado.
 *
 * Slack limita a 50 bloques y ~3000 chars por section text. Truncamos
 * defensivamente para no rebotar el webhook.
 */

import type { Standup } from './standup-schema'

const SLACK_SECTION_MAX = 2900 // dejar margen del límite 3000.
const MAX_BLOCKS = 48 // dejar margen de 50.

/** Diccionario opcional de email/displayName → Slack user ID. */
export type SlackUserMentionMap = Record<string, string>

export interface FormatSlackOptions {
  /** Título del header. Default `Daily standup`. */
  headerTitle?: string
  /** Mapa para mentions tipo `<@U123>`. */
  userMentionMap?: SlackUserMentionMap
  /** Link al app FollowupGantt para botón "Abrir". */
  appUrl?: string
}

export interface SlackBlockKitPayload {
  text: string
  blocks: Array<Record<string, unknown>>
}

// ─────────────────────────── Helpers ───────────────────────────────────

function escapeSlack(text: string): string {
  // Slack mrkdwn: escapar &, <, >. NO escapar * _ ~ porque son formato.
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function mention(user: string, map?: SlackUserMentionMap): string {
  if (map) {
    const id = map[user] ?? map[user.toLowerCase()]
    if (id) return `<@${id}>`
  }
  return escapeSlack(user)
}

function trimSection(text: string): string {
  if (text.length <= SLACK_SECTION_MAX) return text
  return `${text.slice(0, SLACK_SECTION_MAX - 1)}…`
}

// ─────────────────────────── Builders ──────────────────────────────────

function headerBlock(title: string, date: string): Record<string, unknown> {
  return {
    type: 'header',
    text: {
      type: 'plain_text',
      text: `${title} · ${date}`,
      emoji: true,
    },
  }
}

function sectionBlock(text: string): Record<string, unknown> {
  return {
    type: 'section',
    text: { type: 'mrkdwn', text: trimSection(text) },
  }
}

function dividerBlock(): Record<string, unknown> {
  return { type: 'divider' }
}

function userBlocksToText(
  buckets: Standup['yesterday'],
  map?: SlackUserMentionMap,
): string {
  if (buckets.length === 0) return '_— sin items —_'
  return buckets
    .map((b) => {
      const tag = mention(b.user, map)
      const items = b.items.map((it) => `  • ${escapeSlack(it)}`).join('\n')
      return `*${tag}*\n${items}`
    })
    .join('\n\n')
}

function blockersToText(
  blockers: Standup['blockers'],
  map?: SlackUserMentionMap,
): string {
  if (blockers.length === 0) return '_— ninguno detectado —_'
  return blockers
    .map((b) => {
      const tag = mention(b.user, map)
      const tip = b.suggestedAction
        ? `\n     :bulb: ${escapeSlack(b.suggestedAction)}`
        : ''
      return `• *${tag}* — ${escapeSlack(b.description)}${tip}`
    })
    .join('\n')
}

// ─────────────────────────── Entry point ───────────────────────────────

/**
 * Construye el payload Block Kit listo para enviar a Slack.
 * Devuelve `{ text, blocks }` compatible con `SlackBlockKitMessage` de
 * `src/lib/integrations/slack.ts`.
 */
export function formatStandupForSlack(
  standup: Standup,
  opts: FormatSlackOptions = {},
): SlackBlockKitPayload {
  const title = opts.headerTitle ?? 'Daily standup'
  const map = opts.userMentionMap

  const blocks: Array<Record<string, unknown>> = []
  blocks.push(headerBlock(title, standup.date))
  blocks.push(sectionBlock(`*Resumen:* ${escapeSlack(standup.summaryShort)}`))
  blocks.push(dividerBlock())

  blocks.push(sectionBlock(`*:white_check_mark: Ayer*\n${userBlocksToText(standup.yesterday, map)}`))
  blocks.push(sectionBlock(`*:rocket: Hoy*\n${userBlocksToText(standup.today, map)}`))

  if (standup.blockers.length > 0) {
    blocks.push(sectionBlock(`*:warning: Bloqueos*\n${blockersToText(standup.blockers, map)}`))
  }

  if (opts.appUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Abrir FollowupGantt' },
          url: opts.appUrl,
        },
      ],
    })
  }

  // Context footer — útil para auditoría desde Slack.
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `_Generado automáticamente por FollowupGantt. Participantes: ${
          standup.participants.length
        }_`,
      },
    ],
  })

  // Asegurar tope de bloques.
  const trimmed = blocks.slice(0, MAX_BLOCKS)

  return {
    text: standup.summaryShort, // fallback plano para móviles.
    blocks: trimmed,
  }
}

/**
 * Genera el render compacto de texto plano (apto para "Copiar a Slack"
 * desde la UI cuando el usuario quiere pegarlo manualmente). Mantiene
 * los emojis en clear text.
 */
export function formatStandupAsPlainText(standup: Standup): string {
  const lines: string[] = []
  lines.push(`*Daily standup · ${standup.date}*`)
  lines.push(standup.summaryShort)
  lines.push('')
  lines.push(':white_check_mark: *Ayer*')
  if (standup.yesterday.length === 0) {
    lines.push('— sin items —')
  } else {
    for (const b of standup.yesterday) {
      lines.push(`*${b.user}*`)
      for (const it of b.items) lines.push(`  • ${it}`)
    }
  }
  lines.push('')
  lines.push(':rocket: *Hoy*')
  if (standup.today.length === 0) {
    lines.push('— sin items —')
  } else {
    for (const b of standup.today) {
      lines.push(`*${b.user}*`)
      for (const it of b.items) lines.push(`  • ${it}`)
    }
  }
  if (standup.blockers.length > 0) {
    lines.push('')
    lines.push(':warning: *Bloqueos*')
    for (const b of standup.blockers) {
      const tip = b.suggestedAction ? ` — :bulb: ${b.suggestedAction}` : ''
      lines.push(`  • *${b.user}* — ${b.description}${tip}`)
    }
  }
  return lines.join('\n')
}
