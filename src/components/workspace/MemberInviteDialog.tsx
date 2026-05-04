'use client'

/**
 * Ola P4 · Equipo P4-1 — Diálogo "Invitar miembro".
 *
 * Form simple email + role. Llama a `inviteMember`, muestra el `inviteUrl`
 * resultante (D-WS-5) con copy-to-clipboard porque el envío de email se
 * difiere a P4-1.5.
 *
 * Stateless por defecto — el padre controla la apertura y refresca la
 * tabla de miembros tras éxito.
 */

import { useState, useTransition } from 'react'
import { Copy, Check, X, Mail } from 'lucide-react'
import { clsx } from 'clsx'
import { inviteMember } from '@/lib/actions/workspaces'

type Role = 'ADMIN' | 'MEMBER'

export function MemberInviteDialog({
  workspaceId,
  open,
  onClose,
  onInvited,
}: {
  workspaceId: string
  open: boolean
  onClose: () => void
  onInvited?: () => void
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('MEMBER')
  const [error, setError] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isPending, startTransition] = useTransition()

  const reset = () => {
    setEmail('')
    setRole('MEMBER')
    setError(null)
    setInviteUrl(null)
    setCopied(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setInviteUrl(null)

    startTransition(async () => {
      try {
        const baseUrl =
          typeof window !== 'undefined' ? window.location.origin : undefined
        const result = await inviteMember({
          workspaceId,
          email: email.trim(),
          role,
          baseUrl,
        })
        setInviteUrl(result.inviteUrl)
        onInvited?.()
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error desconocido'
        setError(msg)
      }
    })
  }

  const handleCopy = async () => {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback silencioso: el usuario puede seleccionar manualmente.
    }
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-member-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2
            id="invite-member-title"
            className="text-base font-semibold text-foreground flex items-center gap-2"
          >
            <Mail className="h-4 w-4 text-primary" />
            Invitar miembro
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded-md hover:bg-accent/50 text-muted-foreground"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {inviteUrl ? (
          <div className="p-5 space-y-3">
            <p className="text-sm text-foreground">
              Invitación creada. Comparte este enlace con la persona invitada
              (la invitación expira en 7 días):
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs px-3 py-2 rounded-md bg-muted/50 border border-border break-all">
                {inviteUrl}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                className={clsx(
                  'p-2 rounded-md border transition-colors',
                  copied
                    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-500'
                    : 'border-border text-muted-foreground hover:bg-accent/50',
                )}
                aria-label="Copiar enlace"
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Cerrar
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div className="space-y-1">
              <label
                htmlFor="invite-email"
                className="text-xs font-medium text-foreground"
              >
                Email
              </label>
              <input
                id="invite-email"
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="persona@empresa.com"
                className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="invite-role"
                className="text-xs font-medium text-foreground"
              >
                Rol
              </label>
              <select
                id="invite-role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="MEMBER">Miembro</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>

            {error && (
              <div
                role="alert"
                className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2"
              >
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-3 py-1.5 rounded-md text-sm border border-border text-foreground hover:bg-accent/50"
                disabled={isPending}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isPending || !email.trim()}
                className="px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending ? 'Enviando…' : 'Crear invitación'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
