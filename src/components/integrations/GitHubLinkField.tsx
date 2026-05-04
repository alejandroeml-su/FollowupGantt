'use client'

/**
 * Campo "Vincular a GitHub" usado dentro de TaskForm avanzado y del drawer.
 *
 * Acepta una `reference` flexible (URL o `owner/repo#N`) y al confirmar
 * llama al server action `linkTaskToGitHub`. Renderiza la lista de
 * vínculos existentes con botón "Quitar".
 *
 * Uso típico:
 *   <GitHubLinkField taskId={t.id} initialLinks={t.githubLinks} />
 *
 * Si no hay `taskId` (ej. en modo creación de tarea desde el form simple),
 * el componente se comporta como mero input controlado y emite
 * `onPendingChange(reference)`; el padre persistirá tras crear la tarea.
 */

import { useState, useTransition } from 'react'
import {
  linkTaskToGitHub,
  unlinkTaskFromGitHub,
  type SerializedTaskGitHubLink,
} from '@/lib/actions/integrations'

interface Props {
  taskId?: string | null
  initialLinks?: SerializedTaskGitHubLink[]
  defaultRepo?: string
  /**
   * Cuando no hay `taskId` (creación), el padre puede recibir el valor
   * pendiente para persistirlo tras crear la tarea.
   */
  onPendingChange?: (reference: string | null) => void
  disabled?: boolean
}

export function GitHubLinkField({
  taskId,
  initialLinks = [],
  defaultRepo,
  onPendingChange,
  disabled,
}: Props) {
  const [reference, setReference] = useState('')
  const [links, setLinks] = useState<SerializedTaskGitHubLink[]>(initialLinks)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const persistedMode = Boolean(taskId)

  const handleAdd = () => {
    setError(null)
    const ref = reference.trim()
    if (!ref) {
      setError('Introduce una URL de GitHub o owner/repo#N')
      return
    }
    if (!persistedMode) {
      // Modo creación: solo notifica al padre.
      onPendingChange?.(ref)
      return
    }
    startTransition(async () => {
      try {
        const link = await linkTaskToGitHub({
          taskId: taskId!,
          reference: ref,
          defaultRepo,
        })
        setLinks((prev) => [...prev, link])
        setReference('')
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  const handleRemove = (id: string) => {
    setError(null)
    startTransition(async () => {
      try {
        await unlinkTaskFromGitHub(id)
        setLinks((prev) => prev.filter((l) => l.id !== id))
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  return (
    <div className="space-y-2" data-testid="github-link-field">
      <label className="block text-xs font-medium text-muted-foreground">
        Vincular a GitHub
      </label>
      <div className="flex gap-2">
        <input
          name="githubReference"
          value={reference}
          onChange={(e) => {
            setReference(e.target.value)
            if (!persistedMode) onPendingChange?.(e.target.value.trim() || null)
          }}
          disabled={disabled || isPending}
          placeholder={
            defaultRepo
              ? `${defaultRepo}#42 o https://github.com/${defaultRepo}/issues/42`
              : 'owner/repo#42 o URL completa'
          }
          className="flex-1 rounded-md border border-border bg-background py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
        />
        {persistedMode && (
          <button
            type="button"
            onClick={handleAdd}
            disabled={disabled || isPending || !reference.trim()}
            className="rounded-md bg-indigo-500/20 px-3 py-1.5 text-sm font-medium text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 transition disabled:opacity-50"
          >
            Vincular
          </button>
        )}
      </div>
      {error && (
        <p className="text-xs text-red-300" role="alert">
          {error}
        </p>
      )}

      {links.length > 0 && (
        <ul className="space-y-1 pt-2" data-testid="github-link-list">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex items-center justify-between rounded-md border border-border bg-card/50 px-3 py-1.5 text-xs"
            >
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-300 hover:text-indigo-200 underline"
              >
                {link.repoFullName}#{link.issueNumber}
                <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                  {link.kind === 'PR' ? 'PR' : 'Issue'}
                </span>
              </a>
              {persistedMode && (
                <button
                  type="button"
                  onClick={() => handleRemove(link.id)}
                  disabled={disabled || isPending}
                  className="rounded text-red-300 hover:text-red-200 disabled:opacity-50"
                >
                  Quitar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
