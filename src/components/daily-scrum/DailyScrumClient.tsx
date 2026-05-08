'use client'

/**
 * Wave P12 (Scrum 100% · HU-12.5) — Daily Scrum live widget.
 *
 * Sesión sincrona con 3 columnas por miembro: I did / I will / Blockers.
 * Botón "Levantar como Impediment" promueve un blocker a Impediment
 * formal.
 */

import { useMemo, useState, useTransition } from 'react'
import {
  CalendarClock,
  CheckCircle2,
  Send,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  createDailyScrum,
  type DailyScrumEntry,
} from '@/lib/actions/daily-scrum'
import { createImpediment } from '@/lib/actions/impediments'
import { toast } from '@/components/interactions/Toaster'

type TeamMember = { id: string; name: string }

type DailyScrum = {
  id: string
  scheduledFor: Date | string
  data: unknown
  notes: string | null
  facilitator: { id: string; name: string } | null
}

type Props = {
  sprintId: string
  sprintName: string
  team: TeamMember[]
  recent: DailyScrum[]
  currentUser: { id: string; name: string } | null
}

function readEntries(data: unknown): DailyScrumEntry[] {
  if (!data || typeof data !== 'object') return []
  const r = data as Record<string, unknown>
  if (!Array.isArray(r.entries)) return []
  return r.entries
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      userId: typeof e.userId === 'string' ? e.userId : '',
      did: typeof e.did === 'string' ? e.did : '',
      willDo: typeof e.willDo === 'string' ? e.willDo : '',
      blockers: typeof e.blockers === 'string' ? e.blockers : '',
    }))
}

export function DailyScrumClient({
  sprintId,
  sprintName,
  team,
  recent,
  currentUser,
}: Props) {
  const [entries, setEntries] = useState<DailyScrumEntry[]>(() =>
    team.map((m) => ({
      userId: m.id,
      did: '',
      willDo: '',
      blockers: '',
    })),
  )
  const [notes, setNotes] = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const totalBlockers = useMemo(
    () => entries.filter((e) => e.blockers.trim().length > 0).length,
    [entries],
  )
  const filledCount = useMemo(
    () =>
      entries.filter(
        (e) => e.did.trim() || e.willDo.trim() || e.blockers.trim(),
      ).length,
    [entries],
  )

  const setEntry = (userId: string, patch: Partial<DailyScrumEntry>) => {
    setEntries((prev) =>
      prev.map((e) => (e.userId === userId ? { ...e, ...patch } : e)),
    )
  }

  const handleSave = () => {
    if (filledCount === 0) {
      toast.error('Captura al menos un update antes de cerrar el daily')
      return
    }
    startTransition(async () => {
      try {
        const cleanEntries = entries.filter(
          (e) => e.did.trim() || e.willDo.trim() || e.blockers.trim(),
        )
        await createDailyScrum({
          sprintId,
          facilitatorId: currentUser?.id,
          data: { entries: cleanEntries },
          notes: notes.trim() || undefined,
        })
        toast.success('Daily Scrum registrado')
        setEntries(
          team.map((m) => ({
            userId: m.id,
            did: '',
            willDo: '',
            blockers: '',
          })),
        )
        setNotes('')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al guardar')
      }
    })
  }

  const promoteBlocker = (entry: DailyScrumEntry, memberName: string) => {
    if (!entry.blockers.trim()) return
    startTransition(async () => {
      try {
        await createImpediment({
          sprintId,
          title: `[${memberName}] ${entry.blockers.slice(0, 60)}`,
          description: entry.blockers,
          severity: 'HIGH',
          raisedById: currentUser?.id,
          ownerId: entry.userId,
        })
        toast.success('Impediment registrado · escala según severidad')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-border bg-gradient-to-br from-emerald-500/10 via-card to-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-emerald-300">
              <Sparkles className="h-3.5 w-3.5" />
              Daily Scrum · 15 min
            </div>
            <h1 className="mt-1 text-2xl font-bold text-foreground">
              {sprintName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sync diario · &quot;¿Qué hice? · ¿Qué haré? · ¿Qué me bloquea?&quot;
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-border bg-card/60 px-3 py-2 text-center">
              <div className="text-xs text-muted-foreground">Updates</div>
              <div className="text-xl font-bold text-foreground">
                {filledCount}/{team.length}
              </div>
            </div>
            <div
              className={`rounded-lg border px-3 py-2 text-center ${
                totalBlockers > 0
                  ? 'border-rose-500/40 bg-rose-500/10'
                  : 'border-border bg-card/60'
              }`}
            >
              <div className="text-xs text-muted-foreground">Blockers</div>
              <div
                className={`text-xl font-bold ${
                  totalBlockers > 0 ? 'text-rose-300' : 'text-foreground'
                }`}
              >
                {totalBlockers}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-4">
        {team.map((member) => {
          const e = entries.find((x) => x.userId === member.id)!
          const hasBlocker = e.blockers.trim().length > 0
          return (
            <div
              key={member.id}
              className={`rounded-xl border bg-card p-4 transition-shadow ${
                hasBlocker
                  ? 'border-rose-500/40 shadow-rose-500/5 shadow-lg'
                  : 'border-border'
              }`}
            >
              <div className="mb-3 flex items-center gap-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                    hasBlocker
                      ? 'bg-rose-500/20 text-rose-200'
                      : 'bg-emerald-500/20 text-emerald-200'
                  }`}
                >
                  {member.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-foreground">
                    {member.name}
                  </div>
                </div>
                {hasBlocker && (
                  <button
                    onClick={() => promoteBlocker(e, member.name)}
                    disabled={isPending}
                    className="inline-flex items-center gap-1.5 rounded-md bg-rose-500/20 px-2.5 py-1 text-xs font-medium text-rose-200 hover:bg-rose-500/30 disabled:opacity-50"
                  >
                    <TriangleAlert className="h-3 w-3" />
                    Levantar Impediment
                  </button>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <textarea
                  rows={2}
                  value={e.did}
                  onChange={(ev) =>
                    setEntry(member.id, { did: ev.target.value })
                  }
                  placeholder="Ayer hice..."
                  className="rounded-md border border-border bg-background/50 px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-emerald-500/50 focus:outline-none"
                />
                <textarea
                  rows={2}
                  value={e.willDo}
                  onChange={(ev) =>
                    setEntry(member.id, { willDo: ev.target.value })
                  }
                  placeholder="Hoy haré..."
                  className="rounded-md border border-border bg-background/50 px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-cyan-500/50 focus:outline-none"
                />
                <textarea
                  rows={2}
                  value={e.blockers}
                  onChange={(ev) =>
                    setEntry(member.id, { blockers: ev.target.value })
                  }
                  placeholder="Estoy bloqueado por..."
                  className={`rounded-md border bg-background/50 px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none ${
                    hasBlocker
                      ? 'border-rose-500/40 focus:border-rose-500/60'
                      : 'border-border focus:border-amber-500/50'
                  }`}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <label className="mb-2 block text-sm font-medium text-foreground">
          Notas del facilitador (opcional)
        </label>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Decisiones, follow-ups, parking lot..."
          className="w-full rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <div className="mt-3 flex justify-end">
          <button
            onClick={handleSave}
            disabled={isPending || filledCount === 0}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            Cerrar Daily Scrum
          </button>
        </div>
      </div>

      {recent.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            Historial reciente
          </h2>
          <ul className="divide-y divide-border/60">
            {recent.map((d) => {
              const dEntries = readEntries(d.data)
              const blockers = dEntries.filter((e) => e.blockers.trim()).length
              const date = new Date(d.scheduledFor)
              return (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center gap-3 py-2 text-sm"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-foreground">
                      {date.toLocaleDateString('es-MX', {
                        weekday: 'short',
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {dEntries.length} updates · {blockers} blockers · facilitado por{' '}
                      {d.facilitator?.name ?? '—'}
                    </div>
                  </div>
                  {blockers > 0 && (
                    <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-xs font-medium text-rose-200">
                      {blockers} blockers
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
