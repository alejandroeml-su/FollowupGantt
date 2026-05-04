'use client'

/**
 * Ola P4 · Equipo P4-1 — Botón cliente para aceptar la invitación.
 *
 * Aislado en archivo propio porque la página `[token]/page.tsx` debe ser
 * server (lee la BD); el botón necesita useTransition + redirect del
 * cliente para feedback inmediato.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { acceptInvitation, switchWorkspace } from '@/lib/actions/workspaces'
import { useUIStore } from '@/lib/stores/ui'

export function AcceptInvitationButton({ token }: { token: string }) {
  const router = useRouter()
  const setActiveWorkspaceId = useUIStore((s) => s.setActiveWorkspaceId)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleAccept = () => {
    setError(null)
    startTransition(async () => {
      try {
        const result = await acceptInvitation({ token })
        // Activamos el WS recién aceptado para evitar fricción.
        await switchWorkspace({ workspaceId: result.workspaceId })
        setActiveWorkspaceId(result.workspaceId)
        router.push('/settings/workspace')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error aceptando invitación')
      }
    })
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleAccept}
        disabled={isPending}
        className="w-full px-3 py-2 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? 'Aceptando…' : 'Aceptar invitación'}
      </button>
      {error && (
        <div
          role="alert"
          className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2"
        >
          {error}
        </div>
      )}
    </div>
  )
}
