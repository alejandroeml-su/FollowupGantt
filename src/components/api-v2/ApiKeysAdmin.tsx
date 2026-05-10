'use client'

/**
 * Wave P17-B · Cliente admin de API Keys v2.
 *
 * Funcionalidad:
 *   - Form para crear key (nombre + scopes + expiración opcional).
 *   - Banner amber "guarda el plaintext" — visible una vez post-create.
 *   - Lista con prefix, scopes, lastUsedAt, status (active/revoked).
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  createApiKey,
  revokeApiKey,
  deleteApiKey,
  type ApiKeyListItem,
} from '@/lib/actions/api-keys'
import { KNOWN_V2_SCOPES } from '@/lib/api/v2-scopes'

interface Props {
  initialKeys: ApiKeyListItem[]
}

export function ApiKeysAdmin({ initialKeys }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [name, setName] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<string[]>([
    'read:projects',
    'read:tasks',
  ])
  const [expiresAt, setExpiresAt] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [createdPlaintext, setCreatedPlaintext] = useState<string | null>(null)

  const onToggleScope = (scope: string) => {
    setSelectedScopes((curr) =>
      curr.includes(scope) ? curr.filter((s) => s !== scope) : [...curr, scope],
    )
  }

  const parseError = (err: unknown): string => {
    const m = /^\[([A-Z_]+)\]\s*(.*)$/.exec(
      err instanceof Error ? err.message : String(err),
    )
    return m ? m[2] : String(err)
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setCreatedPlaintext(null)
    if (!name.trim()) {
      setError('El nombre de la key es requerido')
      return
    }
    if (selectedScopes.length === 0) {
      setError('Selecciona al menos un scope')
      return
    }
    startTransition(async () => {
      try {
        const result = await createApiKey({
          name: name.trim(),
          scopes: selectedScopes,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        })
        setCreatedPlaintext(result.plaintext)
        setName('')
        router.refresh()
      } catch (err) {
        setError(parseError(err))
      }
    })
  }

  const onRevoke = (id: string) => {
    if (
      !confirm(
        '¿Revocar esta API key? Los clientes que la usen perderán acceso inmediato.',
      )
    )
      return
    startTransition(async () => {
      try {
        await revokeApiKey({ id })
        router.refresh()
      } catch (err) {
        setError(parseError(err))
      }
    })
  }

  const onDelete = (id: string) => {
    if (!confirm('¿Eliminar permanentemente esta API key?')) return
    startTransition(async () => {
      try {
        await deleteApiKey({ id })
        router.refresh()
      } catch (err) {
        setError(parseError(err))
      }
    })
  }

  const onCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      /* best-effort */
    }
  }

  return (
    <div className="space-y-8">
      {createdPlaintext && (
        <div className="rounded-lg border-2 border-amber-500/60 bg-amber-500/10 p-4">
          <h3 className="text-sm font-semibold text-amber-200">
            API key creada — guárdala ahora
          </h3>
          <p className="mt-1 text-xs text-amber-100/80">
            Este es el único momento en que verás la key completa. Cópiala y
            guárdala en un gestor de secretos. Si la pierdes, deberás revocarla
            y crear otra.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 rounded bg-black/40 px-3 py-2 font-mono text-xs text-amber-100 break-all">
              {createdPlaintext}
            </code>
            <button
              type="button"
              onClick={() => onCopy(createdPlaintext)}
              className="rounded-md bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-500"
            >
              Copiar
            </button>
            <button
              type="button"
              onClick={() => setCreatedPlaintext(null)}
              className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-subtle"
            >
              Ya la guardé
            </button>
          </div>
        </div>
      )}

      <section className="rounded-lg border border-border bg-subtle/30 p-6">
        <h2 className="text-base font-semibold text-white">Crear API key</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Las keys v2 autentican llamadas a <code>/api/v2/*</code> con
          encabezado <code>Authorization: Bearer sk_…</code>. Rate limit:
          60 req/min, 1000 req/hora.
        </p>
        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div>
            <label
              className="block text-xs font-medium text-muted-foreground"
              htmlFor="api-key-name"
            >
              Nombre
            </label>
            <input
              id="api-key-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="Ej. Integración SAP S/4HANA producción"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-white"
            />
          </div>

          <div>
            <span className="block text-xs font-medium text-muted-foreground">
              Scopes
            </span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {KNOWN_V2_SCOPES.filter((s) => s !== '*').map((scope) => (
                <label
                  key={scope}
                  className="flex items-center gap-2 text-sm text-white"
                >
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(scope)}
                    onChange={() => onToggleScope(scope)}
                  />
                  <code className="font-mono text-xs">{scope}</code>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label
              className="block text-xs font-medium text-muted-foreground"
              htmlFor="api-key-expires"
            >
              Expiración (opcional)
            </label>
            <input
              id="api-key-expires"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-white"
            />
          </div>

          {error && (
            <div className="rounded-md border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {isPending ? 'Creando…' : 'Crear API key'}
          </button>
        </form>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">API keys existentes</h2>
        {initialKeys.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Aún no hay API keys en este workspace.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {initialKeys.map((k) => (
              <li
                key={k.id}
                className="rounded-md border border-border bg-subtle/20 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-medium text-white">
                      {k.name}
                      {k.revokedAt && (
                        <span className="ml-2 rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-200">
                          revocada
                        </span>
                      )}
                    </h3>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      sk_{k.prefix}…
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Scopes:{' '}
                      {k.scopes.map((s) => (
                        <code
                          key={s}
                          className="mr-1 rounded bg-black/30 px-1.5 py-0.5 font-mono text-[11px]"
                        >
                          {s}
                        </code>
                      ))}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Creada: {new Date(k.createdAt).toLocaleString()}
                      {k.expiresAt &&
                        ` · Expira: ${new Date(k.expiresAt).toLocaleString()}`}
                      {k.lastUsedAt &&
                        ` · Último uso: ${new Date(k.lastUsedAt).toLocaleString()}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {!k.revokedAt && (
                      <button
                        type="button"
                        onClick={() => onRevoke(k.id)}
                        disabled={isPending}
                        className="rounded-md border border-amber-500/50 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/20"
                      >
                        Revocar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDelete(k.id)}
                      disabled={isPending}
                      className="rounded-md border border-red-500/50 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/20"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
