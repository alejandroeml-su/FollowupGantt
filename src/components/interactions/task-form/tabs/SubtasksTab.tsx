'use client'

import { CheckSquare } from 'lucide-react'
import type { SerializedTask } from '@/lib/types'

type Props = {
  /** `null` = modo creación; el tab debería estar deshabilitado en ese caso. */
  task: SerializedTask | null
}

/**
 * Placeholder mínimo. La funcionalidad real (lista, crear inline, anidación)
 * se entrega en Sprint 3. Sprint 2 sólo extrae el shell para que el modal
 * y el drawer compartan la misma estructura de tabs.
 */
export function SubtasksTab({ task }: Props) {
  if (!task) {
    return (
      <div className="text-center py-12">
        <CheckSquare className="h-10 w-10 text-foreground mx-auto mb-2 opacity-30" />
        <p className="text-muted-foreground text-sm italic">
          Disponible al guardar la tarea.
        </p>
      </div>
    )
  }

  return (
    <div className="text-center py-12">
      <CheckSquare className="h-10 w-10 text-foreground mx-auto mb-2 opacity-30" />
      <p className="text-muted-foreground text-sm italic">
        Subtareas (Disponible en Sprint 3)
      </p>
    </div>
  )
}
