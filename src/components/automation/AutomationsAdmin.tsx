'use client'

/**
 * Ola P5 · Equipo P5-5 — Cliente del listado de reglas de automatización.
 *
 * Builder simple inline: crear/editar reglas con trigger + conditions +
 * actions. Persiste vía server actions (`createRule`, `updateRule`,
 * `toggleRule`, `deleteRule`).
 *
 * Nota deliberada: el constructor visual de condiciones/acciones es
 * minimalista (lista + dropdowns). Ola P5+ podrá iterar a un editor más
 * rico (drag-drop, schemas dinámicos por trigger, autocomplete de fields).
 */

import { useState, useTransition } from 'react'
import {
  createRule,
  toggleRule,
  deleteRule,
  updateRule,
} from '@/lib/actions/automation'
import {
  AUTOMATION_EVENTS,
  CONDITION_OPERATORS,
  ACTION_KINDS,
  type AutomationCondition,
  type AutomationAction,
  type AutomationEvent,
  type ConditionOperator,
  type ActionKind,
} from '@/lib/automation/types'

interface RuleItem {
  id: string
  name: string
  isActive: boolean
  trigger: { event: AutomationEvent }
  conditions: AutomationCondition[]
  actions: AutomationAction[]
  _count: { executions: number }
}

interface Props {
  initialRules: RuleItem[]
}

export function AutomationsAdmin({ initialRules }: Props) {
  const [rules, setRules] = useState<RuleItem[]>(initialRules)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [isPending, startTransition] = useTransition()

  async function handleToggle(id: string) {
    startTransition(async () => {
      try {
        const updated = await toggleRule(id)
        setRules((prev) =>
          prev.map((r) => (r.id === id ? { ...r, isActive: updated.isActive } : r)),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar esta regla?')) return
    startTransition(async () => {
      try {
        await deleteRule(id)
        setRules((prev) => prev.filter((r) => r.id !== id))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {rules.length} {rules.length === 1 ? 'regla' : 'reglas'}
        </p>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Nueva regla
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}

      <ul className="space-y-2">
        {rules.length === 0 ? (
          <li className="rounded-md border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
            Sin reglas. Crea la primera para empezar.
          </li>
        ) : null}
        {rules.map((r) => (
          <li
            key={r.id}
            className="rounded-md border border-border bg-card p-4"
          >
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{r.name}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      r.isActive
                        ? 'bg-green-500/15 text-green-300'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {r.isActive ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Disparador: <code>{r.trigger.event}</code> ·{' '}
                  {r.conditions.length} condiciones · {r.actions.length} acciones ·{' '}
                  {r._count.executions} ejecuciones
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingId(r.id === editingId ? null : r.id)}
                className="rounded-md border border-border bg-background px-3 py-1 text-xs hover:bg-secondary"
              >
                {editingId === r.id ? 'Cerrar' : 'Editar'}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleToggle(r.id)}
                className="rounded-md border border-border bg-background px-3 py-1 text-xs hover:bg-secondary"
              >
                {r.isActive ? 'Desactivar' : 'Activar'}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleDelete(r.id)}
                className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs text-red-200 hover:bg-red-500/20"
              >
                Eliminar
              </button>
            </div>
            {editingId === r.id ? (
              <RuleBuilder
                rule={r}
                onSaved={(updated) => {
                  setRules((prev) => prev.map((x) => (x.id === r.id ? updated : x)))
                  setEditingId(null)
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : null}
          </li>
        ))}
      </ul>

      {showNew ? (
        <NewRuleDialog
          onClose={() => setShowNew(false)}
          onCreated={(item) => {
            setRules((prev) => [item, ...prev])
            setShowNew(false)
          }}
        />
      ) : null}
    </div>
  )
}

// ─────────────────────────── Sub-componentes ───────────────────────────

function NewRuleDialog(props: {
  onClose: () => void
  onCreated: (item: RuleItem) => void
}) {
  const [name, setName] = useState('')
  const [event, setEvent] = useState<AutomationEvent>('form.submitted')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function handleCreate() {
    setError(null)
    if (!name) {
      setError('El nombre es obligatorio')
      return
    }
    startTransition(async () => {
      try {
        const created = await createRule({
          name,
          trigger: { event },
          conditions: [],
          actions: [
            {
              kind: 'sendWebhook',
              url: 'https://example.com/webhook',
              method: 'POST',
            },
          ],
        })
        props.onCreated({
          id: created.id,
          name: created.name,
          isActive: created.isActive,
          trigger: { event },
          conditions: [],
          actions: [
            {
              kind: 'sendWebhook',
              url: 'https://example.com/webhook',
              method: 'POST',
            },
          ],
          _count: { executions: 0 },
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al crear')
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full space-y-4">
        <h2 className="text-lg font-semibold text-white">Nueva regla</h2>
        <div>
          <label className="text-sm text-foreground/80">Nombre</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-sm text-foreground/80">Disparador</label>
          <select
            value={event}
            onChange={(e) => setEvent(e.target.value as AutomationEvent)}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {AUTOMATION_EVENTS.map((ev) => (
              <option key={ev} value={ev}>
                {ev}
              </option>
            ))}
          </select>
        </div>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={handleCreate}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {isPending ? 'Creando…' : 'Crear'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RuleBuilder(props: {
  rule: RuleItem
  onSaved: (rule: RuleItem) => void
  onCancel: () => void
}) {
  const [event, setEvent] = useState<AutomationEvent>(props.rule.trigger.event)
  const [conditions, setConditions] = useState<AutomationCondition[]>(props.rule.conditions)
  const [actions, setActions] = useState<AutomationAction[]>(props.rule.actions)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function handleSave() {
    setError(null)
    startTransition(async () => {
      try {
        const updated = await updateRule(props.rule.id, {
          trigger: { event },
          conditions,
          actions,
        })
        props.onSaved({
          ...props.rule,
          name: updated.name,
          isActive: updated.isActive,
          trigger: { event },
          conditions,
          actions,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al guardar')
      }
    })
  }

  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4">
      <div>
        <label className="text-xs text-muted-foreground">Disparador</label>
        <select
          value={event}
          onChange={(e) => setEvent(e.target.value as AutomationEvent)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          {AUTOMATION_EVENTS.map((ev) => (
            <option key={ev} value={ev}>
              {ev}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Condiciones (AND)</span>
          <button
            type="button"
            onClick={() =>
              setConditions((prev) => [...prev, { field: 'payload.email', op: 'contains', value: '' }])
            }
            className="text-xs text-indigo-300 hover:underline"
          >
            + condición
          </button>
        </div>
        {conditions.map((c, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input
              value={c.field}
              onChange={(e) =>
                setConditions((prev) =>
                  prev.map((p, i) => (i === idx ? { ...p, field: e.target.value } : p)),
                )
              }
              className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs font-mono"
              placeholder="payload.email"
            />
            <select
              value={c.op}
              onChange={(e) =>
                setConditions((prev) =>
                  prev.map((p, i) =>
                    i === idx ? { ...p, op: e.target.value as ConditionOperator } : p,
                  ),
                )
              }
              className="rounded border border-border bg-background px-2 py-1 text-xs"
            >
              {CONDITION_OPERATORS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            <input
              value={String(c.value ?? '')}
              onChange={(e) =>
                setConditions((prev) =>
                  prev.map((p, i) => (i === idx ? { ...p, value: e.target.value } : p)),
                )
              }
              className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
              placeholder="valor"
            />
            <button
              type="button"
              onClick={() => setConditions((prev) => prev.filter((_, i) => i !== idx))}
              className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-200"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Acciones (secuenciales, máx 5)</span>
          <button
            type="button"
            onClick={() =>
              setActions((prev) => [
                ...prev,
                { kind: 'sendWebhook', url: 'https://example.com/webhook' } as AutomationAction,
              ])
            }
            className="text-xs text-indigo-300 hover:underline"
          >
            + acción
          </button>
        </div>
        {actions.map((a, idx) => (
          <div key={idx} className="rounded border border-border bg-background/60 p-2 space-y-1">
            <div className="flex items-center gap-2">
              <select
                value={a.kind}
                onChange={(e) => {
                  const kind = e.target.value as ActionKind
                  setActions((prev) =>
                    prev.map((p, i) => {
                      if (i !== idx) return p
                      // Re-shape al cambiar de kind con defaults sensatos.
                      switch (kind) {
                        case 'createTask':
                          return { kind, projectId: '', title: 'Nueva tarea' }
                        case 'sendWebhook':
                          return { kind, url: 'https://example.com/webhook' }
                        case 'updateField':
                          return { kind, taskId: '', field: 'status', value: 'DONE' }
                        case 'assignUser':
                          return { kind, taskId: '', userId: '' }
                      }
                    }),
                  )
                }}
                className="rounded border border-border bg-background px-2 py-1 text-xs"
              >
                {ACTION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setActions((prev) => prev.filter((_, i) => i !== idx))}
                className="ml-auto rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-200"
              >
                ×
              </button>
            </div>
            <pre className="text-[10px] text-muted-foreground bg-background/40 p-1 rounded overflow-x-auto">
              {JSON.stringify(a, null, 2)}
            </pre>
          </div>
        ))}
      </div>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={handleSave}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isPending ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  )
}
