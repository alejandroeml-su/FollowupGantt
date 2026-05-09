/**
 * Wave P12 (PMI 100%) — Communications Plan formal.
 *
 * PMBOK · Communications Management. Define qué información se distribuye,
 * a quién, con qué frecuencia y por qué canal. Persistido en
 * `Project.communicationsPlan` Json para evitar tabla extra (es un plan
 * vivo del proyecto, no un log de eventos).
 *
 * Patrón: matriz N filas × 6 columnas {audience, frequency, channel,
 * owner, nextDelivery, notes}. Una entrada típica:
 *   { audience: "Sponsor + AE", frequency: "Quincenal",
 *     channel: "Email + Teams Live", owner: "Edwin Martinez",
 *     nextDelivery: "2026-05-20", notes: "Status report ejecutivo + EVM" }
 */

export type CommFrequency =
  | 'DAILY'
  | 'WEEKLY'
  | 'BIWEEKLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'AD_HOC'

export type CommChannel =
  | 'EMAIL'
  | 'MEETING'
  | 'STATUS_REPORT'
  | 'DASHBOARD'
  | 'CHAT'
  | 'CALL'
  | 'OTHER'

export interface CommunicationItem {
  id: string
  audience: string
  frequency: CommFrequency
  channel: CommChannel
  owner: string
  /** ISO date string. */
  nextDelivery: string | null
  notes: string
}

export interface CommunicationsPlan {
  items: CommunicationItem[]
  /** ISO timestamp del último update del plan completo. */
  updatedAt: string | null
}

export const EMPTY_COMM_PLAN: CommunicationsPlan = {
  items: [],
  updatedAt: null,
}

export const COMM_FREQUENCY_LABELS: Record<CommFrequency, string> = {
  DAILY: 'Diaria',
  WEEKLY: 'Semanal',
  BIWEEKLY: 'Quincenal',
  MONTHLY: 'Mensual',
  QUARTERLY: 'Trimestral',
  AD_HOC: 'Ad-hoc',
}

export const COMM_CHANNEL_LABELS: Record<CommChannel, string> = {
  EMAIL: 'Email',
  MEETING: 'Reunión',
  STATUS_REPORT: 'Status Report',
  DASHBOARD: 'Dashboard',
  CHAT: 'Chat / Teams',
  CALL: 'Llamada',
  OTHER: 'Otro',
}

const VALID_FREQS: CommFrequency[] = [
  'DAILY',
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'AD_HOC',
]
const VALID_CHANNELS: CommChannel[] = [
  'EMAIL',
  'MEETING',
  'STATUS_REPORT',
  'DASHBOARD',
  'CHAT',
  'CALL',
  'OTHER',
]

export function normalizeCommPlan(raw: unknown): CommunicationsPlan {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_COMM_PLAN }
  const r = raw as Record<string, unknown>
  const items = Array.isArray(r.items)
    ? r.items
        .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
        .map((i): CommunicationItem => {
          const freq = VALID_FREQS.includes(i.frequency as CommFrequency)
            ? (i.frequency as CommFrequency)
            : 'WEEKLY'
          const ch = VALID_CHANNELS.includes(i.channel as CommChannel)
            ? (i.channel as CommChannel)
            : 'EMAIL'
          return {
            id:
              typeof i.id === 'string' && i.id.length > 0
                ? i.id
                : `c-${Math.random().toString(36).slice(2, 10)}`,
            audience: typeof i.audience === 'string' ? i.audience : '',
            frequency: freq,
            channel: ch,
            owner: typeof i.owner === 'string' ? i.owner : '',
            nextDelivery:
              typeof i.nextDelivery === 'string' && i.nextDelivery.length > 0
                ? i.nextDelivery
                : null,
            notes: typeof i.notes === 'string' ? i.notes : '',
          }
        })
        .filter((i) => i.audience.trim().length > 0)
    : []
  return {
    items,
    updatedAt:
      typeof r.updatedAt === 'string' && r.updatedAt.length > 0
        ? r.updatedAt
        : null,
  }
}

export function makeCommItem(): CommunicationItem {
  return {
    id: `c-${Math.random().toString(36).slice(2, 10)}`,
    audience: '',
    frequency: 'WEEKLY',
    channel: 'EMAIL',
    owner: '',
    nextDelivery: null,
    notes: '',
  }
}
