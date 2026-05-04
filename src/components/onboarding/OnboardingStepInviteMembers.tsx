'use client'

/**
 * Equipo D3 · Onboarding · Step 2 — Invitar miembros (opcional).
 *
 * Multi-input de emails. El usuario puede agregar varios y luego
 * "Enviar invitaciones" o saltar. Cada email genera una llamada a
 * `inviteMember` (server) — los errores por email se muestran inline,
 * el resto continúa.
 */

import { useState } from 'react'

type Props = {
  workspaceId: string
  onComplete: (sent: number) => void
  onSkip: () => void
  /** Inyectable para tests. */
  onInvite?: (input: {
    workspaceId: string
    email: string
  }) => Promise<{ token: string }>
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function OnboardingStepInviteMembers({
  workspaceId,
  onComplete,
  onSkip,
  onInvite,
}: Props) {
  const [emails, setEmails] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const addEmail = () => {
    const value = draft.trim().toLowerCase()
    if (!value) return
    if (!EMAIL_RE.test(value)) {
      setErrors((p) => ({ ...p, [value]: 'Email inválido' }))
      return
    }
    if (emails.includes(value)) {
      setDraft('')
      return
    }
    setEmails((p) => [...p, value])
    setDraft('')
    setErrors((p) => {
      const next = { ...p }
      delete next[value]
      return next
    })
  }

  const removeEmail = (email: string) => {
    setEmails((p) => p.filter((e) => e !== email))
  }

  const handleSubmit = async () => {
    if (emails.length === 0 || submitting) return
    setSubmitting(true)
    let sent = 0
    const newErrors: Record<string, string> = {}
    for (const email of emails) {
      try {
        if (!onInvite) {
          throw new Error('onInvite no provisto')
        }
        await onInvite({ workspaceId, email })
        sent += 1
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error'
        newErrors[email] = msg
      }
    }
    setErrors(newErrors)
    setSubmitting(false)
    onComplete(sent)
  }

  return (
    <div className="space-y-4" data-testid="onboarding-step-invite">
      <div className="flex gap-2">
        <input
          type="email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addEmail()
            }
          }}
          placeholder="colaborador@empresa.com"
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          data-testid="onboarding-invite-input"
        />
        <button
          type="button"
          onClick={addEmail}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold"
          data-testid="onboarding-invite-add"
        >
          Agregar
        </button>
      </div>

      {emails.length > 0 && (
        <ul className="space-y-1" data-testid="onboarding-invite-list">
          {emails.map((email) => (
            <li
              key={email}
              data-testid={`onboarding-invite-item-${email}`}
              className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2 text-sm"
            >
              <span>{email}</span>
              <div className="flex items-center gap-2">
                {errors[email] && (
                  <span className="text-xs text-red-500" role="alert">
                    {errors[email]}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeEmail(email)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  aria-label={`Eliminar ${email}`}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={emails.length === 0 || submitting}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          data-testid="onboarding-invite-submit"
        >
          {submitting ? 'Enviando…' : `Enviar ${emails.length} invitación${emails.length === 1 ? '' : 'es'}`}
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="text-sm font-semibold text-muted-foreground hover:text-foreground"
          data-testid="onboarding-invite-skip"
        >
          Omitir por ahora
        </button>
      </div>
    </div>
  )
}
