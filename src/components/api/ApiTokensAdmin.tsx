'use client'

/**
 * Cliente de administración de Tokens API (Ola P4 · Equipo P4-2).
 *
 * Muestra el listado existente y un formulario para crear nuevos. Al crear
 * exitosamente, expone el plaintext UNA SOLA VEZ con un copy-to-clipboard
 * y advertencia explícita en español.
 *
 * Strings UI: "Tokens API", "Crear token", "Revocar", "Copiar".
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  createApiToken,
  revokeApiToken,
  deleteApiToken,
  type ApiTokenListItem,
} from '@/lib/actions/api-tokens'
import { KNOWN_SCOPES } from '@/lib/api/scopes'

interface Props {
  initialTokens: ApiTokenListItem[]
}

export function ApiTokensAdmin({ initialTokens }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [name, setName] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<string[]>([
    'projects:read',
    'tasks:read',
  ])
  const [expiresAt, setExpiresAt] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [createdPlaintext, setCreatedPlaintext] = useState<string | null>(null)

  const onToggleScope = (scope: string) => {
    setSelectedScopes((curr) =>
      curr.includes(scope) ? curr.filter((s) => s !== scope) : [...curr, scope],
    )
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setCreatedPlaintext(null)
    if (!name.trim()) {
      setError('El nombre del token es requerido')
      return
    }
    if (selectedScopes.length === 0) {
      setError('Selecciona al menos un scope')
      return
    }
    startTransition(async () => {
      try {
        const result = await createApiToken({
          name: name.trim(),
          scopes: selectedScopes,
          expiresAt: expiresAt
            ? new Date(expiresAt).toISOString()
            : null,
        })
        setCreatedPlaintext(result.plaintext)
        setName('')
        router.refresh()
      } catch (err) {
        const m = /^\[([A-Z_]+)\]\s*(.*)$/.exec(
          err instanceof Error ? err.message : String(err),
        )
        setError(m ? m[2] : String(err))
      }
    })
  }

  const onRevoke = (id: string) => {
    if (!confirm('¿Revocar este token? Los clientes que lo usen perderán acceso inmediato.')) return
    startTransition(async () => {
      try {
        await revokeApiToken({ id })
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  const onDelete = (id: string) => {
    if (!confirm('¿Eliminar permanentemente este token?')) return
    startTransition(async () => {
      try {
        await deleteApiToken({ id })
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  const onCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // best-effort
    }
  }

  return (
    <div className="space-y-8">
      {/* Plaintext recién creado — banner amarillo de "una sola vez" */}
      {createdPlaintext && (
        <div className="rounded-lg border-2 border-amber-500/60 bg-amber-500/10 p-4">
          <h3 className="text-sm font-semibold text-amber-200">
            Token creado — guárdalo ahora
          </h3>
          <p className="mt-1 text-xs text-amber-100/80">
            Este es el único momento en que verás el token completo. Cópialo y
            guárdalo en un lugar seguro. Si lo pierdes, deberás revocarlo y
            crear uno nuevo.
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
              Ya lo guardé
            </button>
          </div>
        </div>
      )}

      {/* Formulario crear token */}
      <section className="rounded-lg border border-border bg-subtle/30 p-6">
        <h2 className="text-base font-semibold text-white">Crear token</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Los tokens autentican llamadas a <code>/api/v1/*</code> con
          encabezado <code>Authorization: Bearer …</code>.
        </p>
        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground" htmlFor="api-token-name">
              Nombre
            </label>
            <input
              id="api-token-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Ej. CI Vercel, Script Edwin"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-white"
            />
          </div>

          <div>
            <span className="block text-xs font-medium text-muted-foreground">Scopes</span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {KNOWN_SCOPES.filter((s) => s !== '*').map((scope) => (
                <label key={scope} className="flex items-center gap-2 text-sm text-white">
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
            <label className="block text-xs font-medium text-muted-foreground" htmlFor="api-token-expires">
              Expiración (opcional)
            </label>
            <input
              id="api-token-expires"
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
            {isPending ? 'Creando…' : 'Crear token'}
          </button>
        </form>
      </section>

      {/* Listado existente */}
      <section>
        <h2 className="text-base font-semibold text-white">Tokens existentes</h2>
        {initialTokens.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No tienes tokens todavía.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {initialTokens.map((t) => (
              <li
                key={t.id}
                className="rounded-md border border-border bg-subtle/20 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-medium text-white">
                      {t.name}
                      {t.revokedAt && (
                        <span className="ml-2 rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-200">
                          revocado
                        </span>
                      )}
                    </h3>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {t.prefix}…
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Scopes:{' '}
                      {t.scopes.map((s) => (
                        <code key={s} className="mr-1 rounded bg-black/30 px-1.5 py-0.5 font-mono text-[11px]">
                          {s}
                        </code>
                      ))}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Creado: {new Date(t.createdAt).toLocaleString()}
                      {t.expiresAt && ` · Expira: ${new Date(t.expiresAt).toLocaleString()}`}
                      {t.lastUsedAt && ` · Último uso: ${new Date(t.lastUsedAt).toLocaleString()}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {!t.revokedAt && (
                      <button
                        type="button"
                        onClick={() => onRevoke(t.id)}
                        disabled={isPending}
                        className="rounded-md border border-amber-500/50 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/20"
                      >
                        Revocar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDelete(t.id)}
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
