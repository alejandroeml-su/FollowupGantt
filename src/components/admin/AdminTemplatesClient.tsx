'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, Copy } from 'lucide-react'
import {
  createGlobalTemplate,
  updateGlobalTemplate,
  deleteGlobalTemplate,
  applyGlobalTemplateToWorkspace,
} from '@/lib/actions/admin'

const TEMPLATE_KINDS = ['PROJECT', 'WBS', 'DOR_DOD', 'COMM_PLAN'] as const
type TemplateKind = (typeof TEMPLATE_KINDS)[number]

export type AdminTemplateRow = {
  id: string
  name: string
  kind: TemplateKind
  workspaceId: string | null
  workspaceName: string | null
  workspaceSlug: string | null
  payload: Record<string, unknown>
  createdByName: string | null
  createdAt: string
  updatedAt: string
}

const KIND_LABELS: Record<TemplateKind, string> = {
  PROJECT: 'Proyecto',
  WBS: 'WBS',
  DOR_DOD: 'DoR/DoD',
  COMM_PLAN: 'Comm Plan',
}

const KIND_COLORS: Record<TemplateKind, string> = {
  PROJECT: 'bg-indigo-500/15 text-indigo-300',
  WBS: 'bg-emerald-500/15 text-emerald-300',
  DOR_DOD: 'bg-amber-500/15 text-amber-300',
  COMM_PLAN: 'bg-cyan-500/15 text-cyan-300',
}

const KIND_PAYLOAD_HINT: Record<TemplateKind, string> = {
  PROJECT:
    '{\n  "name": "Plantilla por defecto",\n  "description": "...",\n  "methodology": "HYBRID"\n}',
  WBS: '{\n  "tasks": [\n    { "title": "Fase 1", "children": [\n      { "title": "Levantamiento" }\n    ] }\n  ]\n}',
  DOR_DOD:
    '{\n  "dor": ["Historia con criterios de aceptación"],\n  "dod": ["Pruebas pasadas", "Code review"]\n}',
  COMM_PLAN:
    '{\n  "stakeholders": [\n    { "name": "Sponsor", "channel": "email", "frequency": "semanal" }\n  ]\n}',
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message.replace(/^\[[A-Z_]+\]\s*/, '')
  }
  return 'Error desconocido'
}

export function AdminTemplatesClient({
  initial,
  workspaces,
}: {
  initial: AdminTemplateRow[]
  workspaces: Array<{ id: string; name: string; slug: string }>
}) {
  const router = useRouter()
  const [openDialog, setOpenDialog] = useState<
    | { mode: 'create' }
    | { mode: 'edit'; row: AdminTemplateRow }
    | { mode: 'apply'; row: AdminTemplateRow }
    | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleDelete = (row: AdminTemplateRow) => {
    if (
      !confirm(`¿Eliminar la plantilla "${row.name}"? Esta acción no se puede deshacer.`)
    ) {
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await deleteGlobalTemplate({ id: row.id })
        router.refresh()
      } catch (err) {
        setError(extractErrorMessage(err))
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            setError(null)
            setOpenDialog({ mode: 'create' })
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nueva plantilla
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-card/40">
        <table className="w-full text-sm">
          <thead className="bg-subtle/40">
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Plantilla</th>
              <th className="px-4 py-3 font-semibold">Tipo</th>
              <th className="px-4 py-3 font-semibold">Workspace</th>
              <th className="px-4 py-3 font-semibold">Autor</th>
              <th className="px-4 py-3 font-semibold">Actualizada</th>
              <th className="px-4 py-3 text-right font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {initial.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="px-4 py-3 font-medium text-foreground">
                  {t.name}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${KIND_COLORS[t.kind]}`}
                  >
                    {KIND_LABELS[t.kind]}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs">
                  {t.workspaceId ? (
                    <span className="text-foreground/80">
                      {t.workspaceName}{' '}
                      <span className="text-muted-foreground">
                        /{t.workspaceSlug}
                      </span>
                    </span>
                  ) : (
                    <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-zinc-300">
                      Global
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {t.createdByName ?? '—'}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {new Date(t.updatedAt).toLocaleDateString('es-MX')}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-1">
                    {!t.workspaceId && workspaces.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setError(null)
                          setOpenDialog({ mode: 'apply', row: t })
                        }}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-cyan-500/20 hover:text-cyan-300 transition-colors"
                        aria-label={`Aplicar ${t.name} a workspace`}
                        title="Aplicar a workspace"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setError(null)
                        setOpenDialog({ mode: 'edit', row: t })
                      }}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-subtle hover:text-foreground transition-colors"
                      aria-label={`Editar ${t.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(t)}
                      disabled={isPending}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-red-500/20 hover:text-red-300 transition-colors disabled:opacity-50"
                      aria-label={`Eliminar ${t.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {initial.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  No hay plantillas registradas. Crea la primera con el botón superior.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {openDialog?.mode === 'create' || openDialog?.mode === 'edit' ? (
        <TemplateDialog
          state={openDialog}
          onClose={() => setOpenDialog(null)}
          onError={setError}
        />
      ) : null}

      {openDialog?.mode === 'apply' ? (
        <ApplyTemplateDialog
          row={openDialog.row}
          workspaces={workspaces}
          onClose={() => setOpenDialog(null)}
          onError={setError}
        />
      ) : null}
    </div>
  )
}

function TemplateDialog({
  state,
  onClose,
  onError,
}: {
  state:
    | { mode: 'create' }
    | { mode: 'edit'; row: AdminTemplateRow }
  onClose: () => void
  onError: (msg: string | null) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [name, setName] = useState(state.mode === 'edit' ? state.row.name : '')
  const [kind, setKind] = useState<TemplateKind>(
    state.mode === 'edit' ? state.row.kind : 'PROJECT',
  )
  const [payloadStr, setPayloadStr] = useState(() =>
    state.mode === 'edit'
      ? JSON.stringify(state.row.payload, null, 2)
      : KIND_PAYLOAD_HINT.PROJECT,
  )
  const [localError, setLocalError] = useState<string | null>(null)

  const handleKindChange = (k: TemplateKind) => {
    setKind(k)
    if (state.mode === 'create') {
      setPayloadStr(KIND_PAYLOAD_HINT[k])
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)
    onError(null)
    let parsed: Record<string, unknown>
    try {
      const raw = JSON.parse(payloadStr)
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('El payload debe ser un objeto JSON')
      }
      parsed = raw as Record<string, unknown>
    } catch (err) {
      setLocalError(
        'JSON inválido: ' +
          (err instanceof Error ? err.message : 'error desconocido'),
      )
      return
    }
    startTransition(async () => {
      try {
        if (state.mode === 'create') {
          await createGlobalTemplate({
            name: name.trim(),
            kind,
            payload: parsed,
            workspaceId: null,
          })
        } else {
          await updateGlobalTemplate({
            id: state.row.id,
            name: name.trim(),
            payload: parsed,
          })
        }
        onClose()
        router.refresh()
      } catch (err) {
        onError(extractErrorMessage(err))
      }
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tpl-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-2xl"
      >
        <h2
          id="tpl-dialog-title"
          className="mb-4 text-lg font-semibold text-foreground"
        >
          {state.mode === 'create' ? 'Crear plantilla' : 'Editar plantilla'}
        </h2>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground/90">
                Nombre
              </span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-cyan-500 focus:outline-none"
                placeholder="Plantilla SCRUM estándar"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground/90">
                Tipo
              </span>
              <select
                value={kind}
                disabled={state.mode === 'edit'}
                onChange={(e) => handleKindChange(e.target.value as TemplateKind)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-cyan-500 focus:outline-none disabled:opacity-60"
              >
                {TEMPLATE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground/90">
              Payload JSON
            </span>
            <textarea
              required
              value={payloadStr}
              onChange={(e) => setPayloadStr(e.target.value)}
              rows={12}
              spellCheck={false}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-cyan-500 focus:outline-none"
            />
            <span className="mt-1 block text-[11px] text-muted-foreground">
              Se valida con zod por tipo. Verifica el shape antes de guardar.
            </span>
          </label>

          {localError && (
            <div
              role="alert"
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
            >
              {localError}
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-subtle hover:text-foreground transition-colors"
            disabled={isPending}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 transition-colors disabled:opacity-50"
          >
            {isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  )
}

function ApplyTemplateDialog({
  row,
  workspaces,
  onClose,
  onError,
}: {
  row: AdminTemplateRow
  workspaces: Array<{ id: string; name: string; slug: string }>
  onClose: () => void
  onError: (msg: string | null) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!workspaceId) return
    onError(null)
    startTransition(async () => {
      try {
        await applyGlobalTemplateToWorkspace({
          templateId: row.id,
          workspaceId,
        })
        onClose()
        router.refresh()
      } catch (err) {
        onError(extractErrorMessage(err))
      }
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="apply-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl"
      >
        <h2
          id="apply-dialog-title"
          className="mb-2 text-lg font-semibold text-foreground"
        >
          Aplicar plantilla a workspace
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Se creará una copia de <strong>{row.name}</strong> dentro del
          workspace seleccionado. La plantilla global queda intacta.
        </p>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground/90">
            Workspace destino
          </span>
          <select
            required
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-cyan-500 focus:outline-none"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} (/{w.slug})
              </option>
            ))}
          </select>
        </label>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-subtle hover:text-foreground transition-colors"
            disabled={isPending}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isPending || !workspaceId}
            className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 transition-colors disabled:opacity-50"
          >
            {isPending ? 'Aplicando…' : 'Aplicar'}
          </button>
        </div>
      </form>
    </div>
  )
}
