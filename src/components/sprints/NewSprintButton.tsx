'use client'

/**
 * Wave P9 follow-up — Botón "Nuevo Sprint" + modal.
 *
 * Wrapper client para colocar fácilmente en cualquier server page que
 * conozca `projectId`. Refresca el router al éxito para que la nueva
 * sprint aparezca en la lista sin reload manual.
 */

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { NewSprintModal, type ReleaseOption } from './NewSprintModal'

type Props = {
  projectId: string
  /** Variante visual: solid (primary) | outline (secondary). Default solid. */
  variant?: 'solid' | 'outline'
  label?: string
  /**
   * Releases del proyecto (con scopeMode=SPRINT). Si se pasan, el modal
   * mostrará selector "Asociar a Release" — regla ágil de trazabilidad.
   */
  releases?: ReleaseOption[]
}

export function NewSprintButton({
  projectId,
  variant = 'solid',
  label = 'Nuevo Sprint',
  releases,
}: Props) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const className =
    variant === 'solid'
      ? 'inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 shadow-lg shadow-indigo-500/20'
      : 'inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3.5 py-2 text-sm font-medium text-foreground hover:bg-secondary/80'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
      >
        <Plus className="h-4 w-4" />
        {label}
      </button>
      <NewSprintModal
        open={open}
        onClose={() => setOpen(false)}
        projectId={projectId}
        releases={releases}
        onSuccess={() => router.refresh()}
      />
    </>
  )
}
