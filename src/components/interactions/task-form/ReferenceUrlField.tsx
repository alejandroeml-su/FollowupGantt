'use client'

import { useEffect, useState, useTransition } from 'react'
import { Link2 } from 'lucide-react'
import { clsx } from 'clsx'
import { updateTaskReferenceUrl } from '@/lib/actions/collaborators'
import { toast } from '../Toaster'

type Props = {
  /**
   * `create`: control controlado por el padre (modal). Sin persistencia
   *           inline — el padre incluye `referenceUrl` en el FormData de
   *           `createTask`.
   * `edit`:  persistencia onBlur contra `updateTaskReferenceUrl`.
   */
  mode: 'create' | 'edit'
  taskId?: string
  /** Valor inicial (modo edit) o controlado (modo create vía `onChange`). */
  value: string
  onChange?: (next: string) => void
  className?: string
}

/**
 * Valida una URL con `new URL`. Acepta cadena vacía como "sin enlace".
 * Sólo http(s).
 */
function validateReferenceUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return 'URL inválida'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'URL inválida (solo http/https)'
  }
  return null
}

/**
 * Campo "URL de referencia" — input de texto con validación inline.
 * Compartido entre el modal de creación y el drawer de edición.
 *
 * En modo `edit`, persiste onBlur contra `updateTaskReferenceUrl`.
 * En modo `create`, el padre debe leer `value` y enviarla en el FormData
 * de `createTask`.
 */
export function ReferenceUrlField({
  mode,
  taskId,
  value,
  onChange,
  className,
}: Props) {
  const [local, setLocal] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Mismo razonamiento que en CollaboratorsField: sincronizamos el buffer
  // local cuando el padre re-pasa la prop tras revalidate del server.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setLocal(value)
  }, [value])
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleChange = (next: string) => {
    setLocal(next)
    setError(validateReferenceUrl(next))
    if (mode === 'create') onChange?.(next)
  }

  const handleBlur = () => {
    if (mode !== 'edit') return
    if (!taskId) return
    const validation = validateReferenceUrl(local)
    if (validation) {
      setError(validation)
      return
    }
    if ((local || '').trim() === (value || '').trim()) return
    startTransition(async () => {
      try {
        await updateTaskReferenceUrl(taskId, local.trim() || null)
        toast.success('URL de referencia actualizada')
        onChange?.(local.trim())
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message.replace(/^\[[A-Z_]+\]\s*/, '')
            : 'No se pudo guardar la URL',
        )
      }
    })
  }

  return (
    <div className={clsx('space-y-1.5', className)}>
      <label
        htmlFor="task-reference-url"
        className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1"
      >
        <Link2 className="h-3 w-3" /> URL de referencia
      </label>
      <input
        id="task-reference-url"
        type="url"
        inputMode="url"
        placeholder="https://…"
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        disabled={isPending}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? 'task-reference-url-error' : undefined}
        className={clsx(
          'w-full rounded-md border bg-input py-2 px-3 text-sm text-input-foreground focus:outline-none focus:ring-1',
          error
            ? 'border-destructive focus:ring-destructive'
            : 'border-border focus:border-primary focus:ring-ring',
          'disabled:opacity-60',
        )}
      />
      {error && (
        <p
          id="task-reference-url-error"
          className="text-xs text-destructive mt-1"
        >
          {error}
        </p>
      )}
    </div>
  )
}
