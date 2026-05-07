'use client'

/**
 * Wave P9 R2 (HU-9.9) — Setup inicial cuando un Sprint no tiene retro.
 *
 * Cards para elegir format + input de título. Crea la retro y refresh.
 */

import { useState, useTransition } from 'react'
import { Sparkles } from 'lucide-react'
import { clsx } from 'clsx'
import { useRouter } from 'next/navigation'
import { createRetrospective } from '@/lib/actions/retrospective'
import {
  FORMAT_DEFINITIONS,
  formatLabel,
  type RetrospectiveFormat,
} from '@/lib/retrospective/types'
import { toast } from '@/components/interactions/Toaster'

type Props = {
  sprintId: string
  sprintName: string
  defaultTitle: string
  facilitatorId: string | null
}

const FORMATS: RetrospectiveFormat[] = [
  'FOUR_LS',
  'START_STOP_CONTINUE',
  'MAD_SAD_GLAD',
]

export function RetrospectiveSetup({
  sprintId,
  sprintName,
  defaultTitle,
  facilitatorId,
}: Props) {
  const [title, setTitle] = useState(defaultTitle)
  const [format, setFormat] = useState<RetrospectiveFormat>('FOUR_LS')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const handleCreate = () => {
    if (!title.trim()) {
      toast.error('Título requerido')
      return
    }
    startTransition(async () => {
      try {
        await createRetrospective({
          title: title.trim(),
          sprintId,
          format,
          facilitatorId,
        })
        toast.success('Retrospectiva creada')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al crear')
      }
    })
  }

  return (
    <div className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-8">
      <header className="text-center">
        <Sparkles className="mx-auto h-8 w-8 text-indigo-400" />
        <h2 className="mt-3 text-lg font-semibold text-foreground">
          Iniciar retrospectiva del sprint
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Elige un formato y comienza a capturar aprendizajes del equipo.
        </p>
      </header>

      <div className="mt-6 space-y-1.5">
        <label
          htmlFor="retro-title"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Título
        </label>
        <input
          id="retro-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`Retro · ${sprintName}`}
          className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <fieldset className="mt-5 space-y-2">
        <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Formato
        </legend>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {FORMATS.map((f) => {
            const cols = FORMAT_DEFINITIONS[f]
            const active = format === f
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFormat(f)}
                className={clsx(
                  'rounded-md border p-3 text-left transition-colors',
                  active
                    ? 'border-indigo-500 bg-indigo-500/10'
                    : 'border-border bg-input hover:border-indigo-500/40',
                )}
              >
                <div className="text-sm font-semibold text-foreground">
                  {formatLabel(f)}
                </div>
                <div className="mt-1 flex gap-1.5">
                  {cols.map((c) => (
                    <span
                      key={c.id}
                      className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5"
                      title={c.label}
                    >
                      <span aria-hidden>{c.emoji}</span>
                    </span>
                  ))}
                </div>
                <div className="mt-1.5 text-[10px] text-muted-foreground">
                  {cols.length} columna{cols.length === 1 ? '' : 's'}
                </div>
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={handleCreate}
          disabled={isPending || !title.trim()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {isPending ? 'Creando…' : 'Iniciar retrospectiva'}
        </button>
      </div>
    </div>
  )
}
