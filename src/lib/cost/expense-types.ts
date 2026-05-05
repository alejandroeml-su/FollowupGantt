/**
 * Ola P8 · Equipo P8-3 · Cost Management — tipos puros.
 *
 * Este módulo NO importa Prisma ni server-only: vive como contrato puro
 * compartido entre server actions, componentes cliente y tests. Los enums
 * Prisma se duplican como tuplas literales (paridad con `goals.ts`):
 * si `prisma/schema.prisma` cambia un valor, el typecheck rompe en los
 * archivos consumidores.
 *
 * Glosario:
 *   - BAC (Budget at Completion): presupuesto total planificado.
 *   - AC (Actual Cost): gasto real incurrido a la fecha.
 *   - EV (Earned Value): valor ganado = sum(plannedValue × progress%).
 *   - PV (Planned Value): valor planificado por task.
 *   - CPI (Cost Performance Index) = EV / AC.
 *   - SPI (Schedule Performance Index) = EV / PV.
 *   - EAC (Estimate at Completion) = BAC / CPI (si CPI > 0).
 *   - VAC (Variance at Completion) = BAC - EAC.
 *   - ETC (Estimate to Complete) = EAC - AC.
 */

import type { ExpenseStatus } from '@prisma/client'

export type ExpenseStatusValue = ExpenseStatus

export const EXPENSE_STATUS_VALUES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'REIMBURSED',
] as const satisfies readonly ExpenseStatus[]

/**
 * Códigos ISO 4217 soportados explícitamente para la UI. La columna
 * `currency` en BD acepta cualquier string (validado por longitud), pero el
 * dropdown del form se acota a este set para cubrir el 99% de los casos
 * Avante (México + LATAM + EU + USA).
 */
export const SUPPORTED_CURRENCIES = [
  'USD',
  'MXN',
  'EUR',
  'CAD',
  'GBP',
  'JPY',
  'BRL',
  'COP',
  'CLP',
  'ARS',
] as const

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]

/**
 * Validador laxo: acepta cualquier string ISO 4217 de 3 letras mayúsculas.
 * No ata a `SupportedCurrency` para permitir monedas exóticas si un usuario
 * registra un gasto manual con moneda no listada en el dropdown.
 */
export function isValidIsoCurrency(code: string): boolean {
  return /^[A-Z]{3}$/.test(code)
}

export interface BudgetSnapshot {
  /** Identificador del scope (project|phase|sprint). */
  scopeId: string
  scopeType: 'project' | 'phase' | 'sprint'
  /** Presupuesto en moneda original. */
  budget: number
  /** ISO 4217 (USD por defecto si no se especifica). */
  currency: string
  /** Presupuesto convertido a USD para reporting unificado. */
  budgetUsd: number
  /** Gasto real (suma `amountUsd` aprobada/reembolsada). */
  actualUsd: number
  /** % consumido (0..>100 si hay overrun). */
  utilization: number
}

export interface BudgetAlertEvent {
  scopeId: string
  scopeType: 'project' | 'phase' | 'sprint'
  scopeName: string
  budgetUsd: number
  actualUsd: number
  utilization: number
  threshold: number
  /** ISO timestamp. */
  triggeredAt: string
}

/**
 * Umbrales por defecto de alertas de presupuesto. Se evalúan en orden:
 * la primera que coincide gana. Si `utilization >= threshold`, se dispara
 * el webhook `budget.threshold_breached` con el snapshot.
 */
export const DEFAULT_BUDGET_ALERT_THRESHOLDS = [1.0, 0.9, 0.75] as const
