'use client'

/**
 * R4 · US-7.4 · Email ClickApp — Card en /settings/integrations.
 *
 * Muestra el alias `inbox+<slug>@<INBOUND_EMAIL_DOMAIN>` del proyecto
 * elegido y permite copiarlo al clipboard. Incluye instrucciones de
 * uso (cómo crear una tarea, cómo agregar comentario con `[#MNEMONIC]`).
 *
 * El listado de proyectos viene server-side ya filtrado por
 * `resolveProjectVisibility` — este componente no hace queries.
 */

import { useMemo, useState } from 'react'

interface ProjectOption {
  id: string
  name: string
  alias: string | null
}

interface Props {
  projects: ProjectOption[]
  inboundDomain: string
}

export function EmailToTaskCard({ projects, inboundDomain }: Props) {
  // Default: primer proyecto con alias real; si ninguno tiene alias,
  // toma el primero crudo para que la UI muestre el estado "pendiente".
  const defaultId = useMemo(() => {
    const withAlias = projects.find((p) => p.alias)
    return withAlias?.id ?? projects[0]?.id ?? ''
  }, [projects])

  const [selectedId, setSelectedId] = useState(defaultId)
  const [copied, setCopied] = useState(false)
  const selected = projects.find((p) => p.id === selectedId) ?? projects[0]

  const handleCopy = async () => {
    if (!selected?.alias) return
    try {
      await navigator.clipboard.writeText(selected.alias)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard puede fallar en HTTP no-secure (dev en LAN); silencioso.
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Email-to-Task (Email ClickApp)
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Cada proyecto tiene un alias de correo. Los emails enviados a
            ese alias crean tareas automáticamente. Para agregar un
            comentario a una tarea existente, incluye{' '}
            <code className="rounded bg-subtle/50 px-1.5 py-0.5 text-[11px]">
              [#PROJ-123]
            </code>{' '}
            en el asunto.
          </p>
        </div>
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
          Wave R4 · US-7.4
        </span>
      </header>

      <div className="space-y-3">
        <label className="block text-xs font-medium text-muted-foreground">
          Proyecto
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <div>
          <span className="block text-xs font-medium text-muted-foreground">
            Alias de correo
          </span>
          {selected?.alias ? (
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-border bg-subtle/40 px-3 py-2 text-sm font-mono text-foreground">
                {selected.alias}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                className="rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground hover:bg-subtle/40"
              >
                {copied ? 'Copiado ✓' : 'Copiar'}
              </button>
            </div>
          ) : (
            <p className="mt-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Este proyecto aún no tiene alias asignado. Ejecuta el backfill
              o setéalo manualmente desde Prisma Studio. El dominio activo
              es <code>{inboundDomain}</code>.
            </p>
          )}
        </div>

        <details className="rounded-md border border-border bg-subtle/20 p-3 text-xs">
          <summary className="cursor-pointer font-medium text-foreground">
            ¿Cómo funciona?
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              Enviar un email al alias crea una <strong>tarea nueva</strong>{' '}
              con el asunto como título y el cuerpo como descripción.
            </li>
            <li>
              Si el asunto incluye{' '}
              <code className="rounded bg-subtle/50 px-1 py-0.5">
                [#MNEMONIC]
              </code>{' '}
              (ej.{' '}
              <code className="rounded bg-subtle/50 px-1 py-0.5">
                [#PROJ-123]
              </code>
              ), el email se anexa como <strong>comentario</strong> a la
              tarea correspondiente.
            </li>
            <li>
              Los adjuntos del correo (hasta 25 MB c/u) se cargan al{' '}
              <strong>repositorio de archivos</strong> de la tarea.
            </li>
            <li>
              Si el remitente coincide con un usuario registrado, queda
              como autor. En caso contrario aparece como{' '}
              <em>guest</em> con su nombre/correo en el cuerpo.
            </li>
          </ul>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Documentación operativa:{' '}
            <code>docs/integrations/email-to-task.md</code>.
          </p>
        </details>
      </div>
    </section>
  )
}
