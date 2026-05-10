/**
 * Wave P16-B · Migration Assistant — pure mappers.
 *
 * Helpers puros para mapear valores de CSV (typically Jira/Trello export)
 * a los enums internos (TaskStatus, Priority) y a la escala Fibonacci de
 * Story Points. Viven en archivo no-`use server` para poder ser
 * importados desde tests, componentes cliente y server actions sin
 * marcarlos como acciones server.
 */

import type { Priority, TaskStatus } from '@prisma/client'

export const MAX_CSV_ROWS = 500

const FIBONACCI_SP = [1, 2, 3, 5, 8, 13, 21] as const

const STATUS_MAP: Record<string, TaskStatus> = {
  'backlog': 'TODO',
  'to do': 'TODO',
  'todo': 'TODO',
  'open': 'TODO',
  'new': 'TODO',
  'in progress': 'IN_PROGRESS',
  'in_progress': 'IN_PROGRESS',
  'doing': 'IN_PROGRESS',
  'wip': 'IN_PROGRESS',
  'in review': 'REVIEW',
  'review': 'REVIEW',
  'qa': 'REVIEW',
  'done': 'DONE',
  'closed': 'DONE',
  'resolved': 'DONE',
  'completed': 'DONE',
  // No hay BLOCKED en el enum: caen a TODO. El caller puede tag-ear.
  'blocked': 'TODO',
}

const PRIORITY_MAP: Record<string, Priority> = {
  'highest': 'CRITICAL',
  'critical': 'CRITICAL',
  'urgent': 'CRITICAL',
  'p0': 'CRITICAL',
  'high': 'HIGH',
  'h': 'HIGH',
  'p1': 'HIGH',
  'medium': 'MEDIUM',
  'med': 'MEDIUM',
  'm': 'MEDIUM',
  'normal': 'MEDIUM',
  'p2': 'MEDIUM',
  'low': 'LOW',
  'lowest': 'LOW',
  'l': 'LOW',
  'minor': 'LOW',
  'p3': 'LOW',
}

export function mapStatus(raw: string | null | undefined): TaskStatus {
  if (!raw) return 'TODO'
  const k = raw.trim().toLowerCase()
  return STATUS_MAP[k] ?? 'TODO'
}

export function mapPriority(raw: string | null | undefined): Priority {
  if (!raw) return 'MEDIUM'
  const k = raw.trim().toLowerCase()
  return PRIORITY_MAP[k] ?? 'MEDIUM'
}

export function mapEstimateToStoryPoints(
  raw: string | number | null | undefined,
): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isFinite(n) || n <= 0) return null
  let best = FIBONACCI_SP[0] as number
  let bestDiff = Math.abs(n - best)
  for (const v of FIBONACCI_SP) {
    const diff = Math.abs(n - v)
    if (diff < bestDiff) {
      best = v
      bestDiff = diff
    }
  }
  return best
}

export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return []
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0),
    ),
  )
}

export function buildMnemonicPrefix(name: string | null | undefined): string {
  return (
    (name ?? '')
      .split(' ')
      .map((w) => w[0])
      .join('')
      .substring(0, 4)
      .toUpperCase() || 'TASK'
  )
}
