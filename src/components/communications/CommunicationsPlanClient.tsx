'use client'

/**
 * Wave P12 (PMI 100% · HU-12.10) — Communications Plan editor.
 *
 * Matriz N filas con audience / frequency / channel / owner /
 * nextDelivery / notes. Sugerencias de templates por audience type
 * (sponsor, equipo, stakeholder externo).
 */

import { useState, useTransition } from 'react'
import {
  CalendarDays,
  Megaphone,
  Plus,
  Save,
  Trash2,
  Users,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { setCommunicationsPlan } from '@/lib/actions/communications-plan'
import {
  COMM_CHANNEL_LABELS,
  COMM_FREQUENCY_LABELS,
  makeCommItem,
  type CommChannel,
  type CommFrequency,
  type CommunicationItem,
  type CommunicationsPlan,
} from '@/lib/communications/types'
import { toast } from '@/components/interactions/Toaster'

type Props = {
  projectId: string
  projectName: string
  initial: CommunicationsPlan
  currentUser: { id: string; name: string } | null
}

const TEMPLATES: { label: string; build: () => CommunicationItem }[] = [
  {
    label: 'Sponsor + AE (quincenal)',
    build: () => ({
      ...makeCommItem(),
      audience: 'Sponsor + Arquitecto Empresarial',
      frequency: 'BIWEEKLY',
      channel: 'STATUS_REPORT',
      owner: 'PM',
      notes: 'Status report ejecutivo + EVM (CPI/SPI/EAC)',
    }),
  },
  {
    label: 'Equipo de proyecto (semanal)',
    build: () => ({
      ...makeCommItem(),
      audience: 'Equipo de proyecto',
      frequency: 'WEEKLY',
      channel: 'MEETING',
      owner: 'Scrum Master',
      notes: 'Sprint review + retro highlights',
    }),
  },
  {
    label: 'Stakeholders externos (mensual)',
    build: () => ({
      ...makeCommItem(),
      audience: 'Stakeholders externos',
      frequency: 'MONTHLY',
      channel: 'EMAIL',
      owner: 'PM',
      notes: 'Highlights de release + roadmap próximo trimestre',
    }),
  },
  {
    label: 'Daily standup (diario)',
    build: () => ({
      ...makeCommItem(),
      audience: 'Equipo Dev/QA',
      frequency: 'DAILY',
      channel: 'MEETING',
      owner: 'Scrum Master',
      notes: 'Daily Scrum 15 min · sync de blockers',
    }),
  },
]

export function CommunicationsPlanClient({
  projectId,
  projectName,
  initial,
  currentUser,
}: Props) {
  const [items, setItems] = useState<CommunicationItem[]>(initial.items)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const updateItem = (id: string, patch: Partial<CommunicationItem>) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    )
  }

  const addItem = (template?: CommunicationItem) => {
    setItems((prev) => [...prev, template ?? makeCommItem()])
  }

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  const handleSave = () => {
    startTransition(async () => {
      try {
        await setCommunicationsPlan({
          projectId,
          items,
          actorId: currentUser?.id,
        })
        toast.success('Plan de comunicaciones guardado')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-border bg-gradient-to-br from-pink-500/10 via-card to-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-pink-300">
              <Megaphone className="h-3.5 w-3.5" />
              Communications Plan · PMBOK
            </div>
            <h1 className="mt-1 text-2xl font-bold text-foreground">
              {projectName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Define qué información se distribuye, a quién, cuándo y por qué
              canal.
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-md bg-pink-600 px-3 py-2 text-sm font-semibold text-white hover:bg-pink-500 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            Guardar plan
          </button>
        </div>
      </header>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Plus className="h-4 w-4" />
          Templates rápidos
        </h2>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              onClick={() => addItem(t.build())}
              className="rounded-full border border-border bg-background/50 px-3 py-1 text-xs text-muted-foreground hover:border-pink-500/40 hover:bg-pink-500/10 hover:text-pink-200"
            >
              + {t.label}
            </button>
          ))}
          <button
            onClick={() => addItem()}
            className="rounded-full border border-pink-500/40 bg-pink-500/10 px-3 py-1 text-xs font-medium text-pink-200 hover:bg-pink-500/20"
          >
            + Entrada en blanco
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Users className="h-4 w-4 text-pink-300" />
            Matriz de comunicaciones · {items.length} entrada
            {items.length === 1 ? '' : 's'}
          </h2>
        </div>

        {items.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            <CalendarDays className="mx-auto h-10 w-10 opacity-40" />
            <p className="mt-3">
              Aún no hay entradas. Usa los templates de arriba para arrancar
              rápido.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {items.map((it) => (
              <div key={it.id} className="p-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                  <div className="lg:col-span-2">
                    <label className="block text-xs uppercase tracking-wider text-muted-foreground">
                      Audiencia
                    </label>
                    <input
                      type="text"
                      value={it.audience}
                      onChange={(e) =>
                        updateItem(it.id, { audience: e.target.value })
                      }
                      placeholder="Ej: Sponsor + AE"
                      className="mt-1 w-full rounded-md border border-border bg-background/50 px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-muted-foreground">
                      Frecuencia
                    </label>
                    <select
                      value={it.frequency}
                      onChange={(e) =>
                        updateItem(it.id, {
                          frequency: e.target.value as CommFrequency,
                        })
                      }
                      className="mt-1 w-full rounded-md border border-border bg-background/50 px-2 py-1.5 text-sm text-foreground"
                    >
                      {Object.entries(COMM_FREQUENCY_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-muted-foreground">
                      Canal
                    </label>
                    <select
                      value={it.channel}
                      onChange={(e) =>
                        updateItem(it.id, {
                          channel: e.target.value as CommChannel,
                        })
                      }
                      className="mt-1 w-full rounded-md border border-border bg-background/50 px-2 py-1.5 text-sm text-foreground"
                    >
                      {Object.entries(COMM_CHANNEL_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-muted-foreground">
                      Owner
                    </label>
                    <input
                      type="text"
                      value={it.owner}
                      onChange={(e) =>
                        updateItem(it.id, { owner: e.target.value })
                      }
                      placeholder="PM, SM..."
                      className="mt-1 w-full rounded-md border border-border bg-background/50 px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-muted-foreground">
                      Próxima entrega
                    </label>
                    <input
                      type="date"
                      value={it.nextDelivery ?? ''}
                      onChange={(e) =>
                        updateItem(it.id, {
                          nextDelivery: e.target.value || null,
                        })
                      }
                      className="mt-1 w-full rounded-md border border-border bg-background/50 px-2 py-1.5 text-sm text-foreground"
                    />
                  </div>
                </div>
                <div className="mt-3 flex gap-3">
                  <textarea
                    rows={1}
                    value={it.notes}
                    onChange={(e) =>
                      updateItem(it.id, { notes: e.target.value })
                    }
                    placeholder="Notas · contenido del status, métricas a incluir..."
                    className="flex-1 rounded-md border border-border bg-background/50 px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground"
                  />
                  <button
                    onClick={() => removeItem(it.id)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-300"
                    title="Eliminar entrada"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {initial.updatedAt && (
        <p className="text-center text-xs text-muted-foreground">
          Última actualización:{' '}
          {new Date(initial.updatedAt).toLocaleString('es-MX')}
        </p>
      )}
    </div>
  )
}
