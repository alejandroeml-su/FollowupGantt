'use client'

/**
 * Diálogo "Añadir integración": selector de tipo (Slack/Teams/GitHub) y
 * formulario específico inline. Devuelve el shape `{ type, name, config }`
 * al padre (`IntegrationsList`) que llama `createIntegration`.
 *
 * Implementado como overlay simple (no usa Radix Dialog para mantener el
 * repo libre de deps adicionales). Cierra al hacer click fuera o Esc.
 */

import { useEffect, useState } from 'react'
import { SlackConfigForm } from './SlackConfigForm'
import { TeamsConfigForm } from './TeamsConfigForm'

export type AddIntegrationPayload =
  | { type: 'SLACK'; name: string; config: { webhookUrl: string; channel?: string } }
  | { type: 'TEAMS'; name: string; config: { webhookUrl: string } }
  | {
      type: 'GITHUB'
      name: string
      config: { defaultRepo?: string }
    }

interface Props {
  open: boolean
  disabled?: boolean
  onClose: () => void
  onSubmit: (payload: AddIntegrationPayload) => void
}

/**
 * Wrapper que monta/desmonta el contenido para resetear el estado interno
 * sin recurrir a `setState` dentro de `useEffect` (regla
 * `react-hooks/set-state-in-effect`).
 */
export function AddIntegrationDialog(props: Props) {
  if (!props.open) return null
  return <AddIntegrationDialogContent {...props} />
}

function AddIntegrationDialogContent({
  disabled,
  onClose,
  onSubmit,
}: Props) {
  const [type, setType] = useState<'SLACK' | 'TEAMS' | 'GITHUB' | null>(null)
  const [githubName, setGithubName] = useState('GitHub')
  const [githubDefaultRepo, setGithubDefaultRepo] = useState('')
  const [githubError, setGithubError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleGithubSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setGithubError(null)
    const name = githubName.trim()
    if (!name) {
      setGithubError('El nombre es obligatorio')
      return
    }
    const repo = githubDefaultRepo.trim()
    onSubmit({
      type: 'GITHUB',
      name,
      config: repo ? { defaultRepo: repo } : {},
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Añadir integración"
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">
            {type ? `Conectar ${typeLabel(type)}` : 'Añadir integración'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-white text-sm"
            aria-label="Cerrar"
          >
            ×
          </button>
        </header>

        {!type && (
          <div className="grid grid-cols-1 gap-2" data-testid="integration-type-picker">
            <TypeButton
              label="Slack"
              hint="Webhook outbound (Block Kit)"
              onClick={() => setType('SLACK')}
            />
            <TypeButton
              label="Microsoft Teams"
              hint="Webhook outbound (Adaptive Card)"
              onClick={() => setType('TEAMS')}
            />
            <TypeButton
              label="GitHub"
              hint="Vincular tareas a issues/PRs"
              onClick={() => setType('GITHUB')}
            />
          </div>
        )}

        {type === 'SLACK' && (
          <SlackConfigForm
            disabled={disabled}
            onCancel={onClose}
            onSubmit={(v) =>
              onSubmit({
                type: 'SLACK',
                name: v.name,
                config: { webhookUrl: v.webhookUrl, channel: v.channel },
              })
            }
          />
        )}

        {type === 'TEAMS' && (
          <TeamsConfigForm
            disabled={disabled}
            onCancel={onClose}
            onSubmit={(v) =>
              onSubmit({
                type: 'TEAMS',
                name: v.name,
                config: { webhookUrl: v.webhookUrl },
              })
            }
          />
        )}

        {type === 'GITHUB' && (
          <form onSubmit={handleGithubSubmit} className="space-y-3" data-testid="github-config-form">
            {githubError && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {githubError}
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Nombre *
              </label>
              <input
                value={githubName}
                onChange={(e) => setGithubName(e.target.value)}
                disabled={disabled}
                className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Repositorio por defecto (opcional)
              </label>
              <input
                value={githubDefaultRepo}
                onChange={(e) => setGithubDefaultRepo(e.target.value)}
                disabled={disabled}
                placeholder="owner/repo"
                className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Cuando esté presente, los campos GitHub de las tareas aceptan
                referencias cortas (#42).
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={disabled}
                className="rounded-md border border-border bg-secondary px-3 py-1.5 text-sm text-foreground/90 hover:bg-secondary/80 transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={disabled}
                className="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-400 transition disabled:opacity-50"
              >
                Conectar
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function typeLabel(type: 'SLACK' | 'TEAMS' | 'GITHUB'): string {
  if (type === 'SLACK') return 'Slack'
  if (type === 'TEAMS') return 'Microsoft Teams'
  return 'GitHub'
}

function TypeButton({
  label,
  hint,
  onClick,
}: {
  label: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start rounded-lg border border-border bg-secondary/40 px-4 py-3 text-left hover:border-indigo-500/50 hover:bg-secondary/60 transition"
    >
      <span className="text-sm font-semibold text-white">{label}</span>
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </button>
  )
}
