'use client'

/**
 * Form de configuración para una integración Microsoft Teams. Sólo
 * gestiona `webhookUrl`. La verificación se hace en el server vía
 * `validateTeamsConfig`.
 */

import { useState } from 'react'

export interface TeamsConfigFormValue {
  name: string
  webhookUrl: string
}

interface Props {
  initial?: Partial<TeamsConfigFormValue>
  disabled?: boolean
  onSubmit: (value: TeamsConfigFormValue) => void
  onCancel: () => void
  submitLabel?: string
}

export function TeamsConfigForm({
  initial,
  disabled,
  onSubmit,
  onCancel,
  submitLabel = 'Conectar',
}: Props) {
  const [name, setName] = useState(initial?.name ?? 'Microsoft Teams')
  const [webhookUrl, setWebhookUrl] = useState(initial?.webhookUrl ?? '')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    if (!name.trim()) {
      setError('El nombre es obligatorio')
      return
    }
    if (!webhookUrl.trim()) {
      setError('webhookUrl es obligatorio')
      return
    }
    onSubmit({ name: name.trim(), webhookUrl: webhookUrl.trim() })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" data-testid="teams-config-form">
      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          Nombre *
        </label>
        <input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={disabled}
          placeholder="Teams - Equipo proyecto"
          className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          Webhook URL *
        </label>
        <input
          name="webhookUrl"
          type="url"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          disabled={disabled}
          placeholder="https://outlook.office.com/webhook/..."
          className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Configura un Incoming Webhook en el canal de Teams y pega la URL.
        </p>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
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
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
