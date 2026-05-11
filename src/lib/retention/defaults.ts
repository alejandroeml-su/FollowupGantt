import 'server-only'

import type { RetentionDomain } from '@prisma/client'
import prisma from '@/lib/prisma'

/**
 * R3.0-F · Data Retention Policies — defaults por dominio.
 *
 * Se siembran al crear un workspace (createWorkspace / getDefaultWorkspaceForUser)
 * y son idempotentes: si la policy ya existe, no se sobrescribe (el admin
 * puede haberla afinado a su gusto).
 *
 * Decisión: los valores default se eligieron alineados con benchmarks
 * típicos enterprise (SOC2 audit-log ≥ 1 año; sesiones ≤ 30 días para
 * higiene; notificaciones in-app 90 días suelen ser ruido pasado eso;
 * insights AI 180 días para retro-analítica sin saturar).
 */

export const RETENTION_DEFAULT_DAYS: Record<RetentionDomain, number> = {
  AUDIT_LOG: 365,
  SESSION: 30,
  NOTIFICATION: 90,
  BRAIN_INSIGHT: 180,
}

/**
 * Límite de seguridad por dominio × ciclo de purge. Cap defensivo para
 * evitar runaway de DELETE en workspaces grandes; si se llega, el run
 * termina como SUCCESS con un `errorMessage` informativo y el próximo
 * tick continúa borrando.
 */
export const RETENTION_SAFETY_CAP = 100_000

/**
 * Tamaño del batch CTE de DELETE. PostgreSQL no acepta DELETE...LIMIT
 * directo; usamos `WITH cte AS (SELECT id ... LIMIT 1000) DELETE ...
 * WHERE id IN (SELECT id FROM cte)` (ver `engine.ts`).
 */
export const RETENTION_BATCH_SIZE = 1000

const DOMAINS: RetentionDomain[] = [
  'AUDIT_LOG',
  'SESSION',
  'NOTIFICATION',
  'BRAIN_INSIGHT',
]

/**
 * Idempotente: garantiza que un workspace tenga las 4 políticas default.
 * NO sobrescribe configuración existente — solo inserta las faltantes.
 *
 * @returns número de policies creadas (0 si todas existían).
 *
 * @throws `[INVALID_INPUT]` si `workspaceId` está vacío.
 */
export async function ensureDefaultPolicies(
  workspaceId: string,
): Promise<{ created: number }> {
  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new Error('[INVALID_INPUT] workspaceId requerido')
  }

  // `createMany` con `skipDuplicates: true` cumple ambos requisitos:
  //   - idempotencia (gracias al UNIQUE (workspaceId, domain))
  //   - una sola round-trip (vs. 4 upserts seriales)
  const result = await prisma.retentionPolicy.createMany({
    data: DOMAINS.map((domain) => ({
      workspaceId,
      domain,
      retainDays: RETENTION_DEFAULT_DAYS[domain],
      enabled: true,
    })),
    skipDuplicates: true,
  })

  return { created: result.count }
}
