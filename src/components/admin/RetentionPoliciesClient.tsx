'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Database,
  KeyRound,
  Bell,
  Sparkles,
  Play,
  Save,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react'
import type { RetentionDomain } from '@prisma/client'
import {
  updatePolicy,
  runPurgeNow,
  type SerializedPolicy,
  type SerializedPurgeRun,
} from '@/lib/actions/retention'

/**
 * R3.0-F · UI de administración de Data Retention Policies.
 *
 * 4 cards (una por dominio) con:
 *   - toggle `enabled`
 *   - input numérico `retainDays`
 *   - botón "Guardar" (servidor action `updatePolicy`)
 *   - botón "Run now" global (servidor action `runPurgeNow` con confirm)
 *
 * Más una tabla con las últimas 10 runs (status + dominio + count).
 */

type DomainMeta = {
  icon: typeof Database
  label: string
  description: string
  source: string
}

const DOMAIN_META: Record<RetentionDomain, DomainMeta> = {
  AUDIT_LOG: {
    icon: Database,
    label: 'Audit Log',
    description:
      'Eventos de auditoría (mutaciones, accesos, intentos denegados). Recomendado ≥ 365 días para SOC2.',
    source: 'tabla AuditEvent (actorId IN miembros del workspace)',
  },
  SESSION: {
    icon: KeyRound,
    label: 'Sesiones',
    description:
      'Tokens de sesión activos/expirados. Recomendado ≤ 30 días para higiene de auth.',
    source: 'tabla Session (userId IN miembros del workspace)',
  },
  NOTIFICATION: {
    icon: Bell,
    label: 'Notificaciones',
    description:
      'Notificaciones in-app del centro de notificaciones. Default 90 días.',
    source: 'tabla Notification (userId IN miembros del workspace)',
  },
  BRAIN_INSIGHT: {
    icon: Sparkles,
    label: 'Brain Insights',
    description:
      'Forecasts, recomendaciones y anomalías generadas por la IA. Default 180 días.',
    source: 'tabla BrainInsight (via project.workspaceId)',
  },
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message.replace(/^\[[A-Z_]+\]\s*/, '')
  }
  return 'Error desconocido'
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('es-MX', {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

export function RetentionPoliciesClient({
  workspaceId,
  workspaceSlug,
  initialPolicies,
  initialHistory,
}: {
  workspaceId: string
  workspaceSlug: string
  initialPolicies: SerializedPolicy[]
  initialHistory: SerializedPurgeRun[]
}) {
  const router = useRouter()
  const [policies, setPolicies] = useState(initialPolicies)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleChange = (
    domain: RetentionDomain,
    patch: { retainDays?: number; enabled?: boolean },
  ) => {
    setPolicies((prev) =>
      prev.map((p) => (p.domain === domain ? { ...p, ...patch } : p)),
    )
  }

  const handleSave = (policy: SerializedPolicy) => {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      try {
        await updatePolicy({
          workspaceId,
          domain: policy.domain,
          retainDays: policy.retainDays,
          enabled: policy.enabled,
        })
        setSuccess(
          `Política ${DOMAIN_META[policy.domain].label} actualizada.`,
        )
        router.refresh()
      } catch (err) {
        setError(extractErrorMessage(err))
      }
    })
  }

  const handleRunNow = () => {
    if (
      !confirm(
        `¿Ejecutar purge ahora para el workspace "${workspaceSlug}"?\n\nEsta acción borra datos según las políticas habilitadas. La operación está acotada (100k filas/dominio) pero es DESTRUCTIVA.`,
      )
    ) {
      return
    }
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      try {
        const result = await runPurgeNow({ workspaceId })
        const total = result.outcomes.reduce(
          (acc, o) => acc + o.deletedCount,
          0,
        )
        const failed = result.outcomes.filter((o) => o.status === 'FAILED')
        if (failed.length > 0) {
          setError(
            `Purge completado con errores: ${failed
              .map((f) => `${f.domain}: ${f.errorMessage}`)
              .join(' · ')}`,
          )
        } else {
          setSuccess(
            `Purge ejecutado · ${total} filas eliminadas en ${result.outcomes.length} dominios.`,
          )
        }
        router.refresh()
      } catch (err) {
        setError(extractErrorMessage(err))
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Banner de feedback */}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          {error}
        </div>
      )}
      {success && (
        <div
          role="status"
          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
        >
          {success}
        </div>
      )}

      {/* Acción global Run now */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-card/40 p-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Ejecutar purge manualmente
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            El cron diario lo hace a las 03:00 UTC. Usá este botón solo
            para validar la configuración o limpiar después de cambios.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRunNow}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50 transition-colors"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Run now
        </button>
      </div>

      {/* Cards de policies */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {policies.map((policy) => {
          const meta = DOMAIN_META[policy.domain]
          const Icon = meta.icon
          return (
            <div
              key={policy.id}
              className="rounded-lg border border-border bg-card/40 p-5"
            >
              <div className="mb-3 flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <Icon className="mt-0.5 h-5 w-5 text-indigo-400" />
                  <div>
                    <h3 className="text-base font-semibold text-foreground">
                      {meta.label}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {meta.description}
                    </p>
                    <p className="mt-1 text-[10px] font-mono text-muted-foreground/70">
                      {meta.source}
                    </p>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={policy.enabled}
                    onChange={(e) =>
                      handleChange(policy.domain, {
                        enabled: e.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-border bg-background"
                    aria-label={`Habilitar policy ${meta.label}`}
                  />
                  Activa
                </label>
              </div>

              <div className="mb-3 flex items-center gap-3">
                <label
                  htmlFor={`days-${policy.id}`}
                  className="text-xs text-muted-foreground"
                >
                  Conservar:
                </label>
                <input
                  id={`days-${policy.id}`}
                  type="number"
                  min={1}
                  max={3650}
                  value={policy.retainDays}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10)
                    if (!Number.isNaN(v)) {
                      handleChange(policy.domain, { retainDays: v })
                    }
                  }}
                  className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                />
                <span className="text-xs text-muted-foreground">días</span>
              </div>

              <div className="mb-3 text-xs text-muted-foreground">
                <div>
                  Último purge:{' '}
                  <span className="font-mono text-foreground/80">
                    {formatDateTime(policy.lastPurgeAt)}
                  </span>{' '}
                  · {policy.lastPurgeCount} filas
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleSave(policy)}
                disabled={isPending}
                className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
              >
                <Save className="h-3.5 w-3.5" />
                Guardar
              </button>
            </div>
          )
        })}
      </div>

      {/* Historial de runs */}
      <div className="rounded-lg border border-border bg-card/40">
        <header className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            Historial de ejecuciones (últimas 10)
          </h2>
        </header>
        {initialHistory.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            Aún no hay ejecuciones registradas. El cron diario poblará este
            historial al primer ciclo, o podés disparar &quot;Run now&quot; arriba.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 text-left">Inicio</th>
                  <th className="px-4 py-2 text-left">Dominio</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-right">Filas</th>
                  <th className="px-4 py-2 text-left">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {initialHistory.map((run) => (
                  <tr
                    key={run.id}
                    className="border-b border-border/60 last:border-b-0"
                  >
                    <td className="px-4 py-2 font-mono text-xs text-foreground/80">
                      {formatDateTime(run.startedAt)}
                    </td>
                    <td className="px-4 py-2 text-foreground/90">
                      {DOMAIN_META[run.domain].label}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex items-center gap-1 text-xs ${
                          run.status === 'SUCCESS'
                            ? 'text-emerald-300'
                            : run.status === 'FAILED'
                              ? 'text-rose-300'
                              : 'text-amber-300'
                        }`}
                      >
                        {run.status === 'SUCCESS' && (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        {run.status === 'FAILED' && (
                          <XCircle className="h-3.5 w-3.5" />
                        )}
                        {run.status === 'RUNNING' && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        )}
                        {run.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-foreground/80">
                      {run.deletedCount}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {run.errorMessage ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
