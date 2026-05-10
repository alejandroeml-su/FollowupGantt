'use client'

/**
 * Wave P18-A — Pantalla de calidad del proyecto.
 *
 * UI con dos tabs:
 *   - Inspecciones: lista con tipo/resultado/inspector + drawer detalle
 *     con checklist editable.
 *   - Defectos: lista con severity/status + filtros + drawer detalle.
 *
 * Las acciones server-side mutan optimistamente y refrescan via
 * revalidatePath del action.
 */

import { useState, useTransition, useId } from 'react'
import {
  Plus,
  ShieldCheck,
  Bug,
  X as CloseIcon,
  Trash2,
  CheckCircle2,
  Circle,
  AlertCircle,
  XCircle,
} from 'lucide-react'
import { clsx } from 'clsx'
import {
  createInspection,
  updateInspection,
  deleteInspection,
  createDefect,
  updateDefect,
  deleteDefect,
} from '@/lib/actions/quality'
import { toast } from '@/components/interactions/Toaster'

type InspectionType = 'CODE_REVIEW' | 'TEST_REVIEW' | 'DESIGN_REVIEW' | 'AUDIT' | 'WALKTHROUGH'
type InspectionResult = 'PENDING' | 'PASS' | 'PASS_WITH_DEFECTS' | 'FAIL'
type DefectSeverity = 'CRITICAL' | 'MAJOR' | 'MINOR' | 'TRIVIAL'
type DefectStatus = 'OPEN' | 'IN_REVIEW' | 'FIXED' | 'WONT_FIX' | 'DUPLICATE'

type ChecklistItem = { text: string; done: boolean; notes?: string | null }

export type InspectionRow = {
  id: string
  type: InspectionType
  result: InspectionResult
  inspectorId: string | null
  inspectorName: string | null
  taskId: string | null
  taskTitle: string | null
  taskMnemonic: string | null
  scheduledAt: string | null
  completedAt: string | null
  summary: string | null
  checklist: { items: ChecklistItem[] } | null
  defectCount: number
  createdAt: string
}

export type DefectRow = {
  id: string
  title: string
  description: string | null
  severity: DefectSeverity
  status: DefectStatus
  inspectionId: string | null
  inspectionType: string | null
  taskId: string | null
  taskTitle: string | null
  taskMnemonic: string | null
  ownerId: string | null
  ownerName: string | null
  reporterId: string | null
  reporterName: string | null
  resolvedAt: string | null
  resolution: string | null
  createdAt: string
}

type Props = {
  project: { id: string; name: string }
  inspections: InspectionRow[]
  defects: DefectRow[]
  users: { id: string; name: string }[]
  tasks: { id: string; title: string; mnemonic: string | null }[]
}

const INSPECTION_TYPE_LABEL: Record<InspectionType, string> = {
  CODE_REVIEW: 'Code Review',
  TEST_REVIEW: 'Test Review',
  DESIGN_REVIEW: 'Design Review',
  AUDIT: 'Auditoría',
  WALKTHROUGH: 'Walkthrough',
}

const INSPECTION_RESULT_TONE: Record<InspectionResult, string> = {
  PENDING: 'bg-secondary text-muted-foreground',
  PASS: 'bg-emerald-500/15 text-emerald-300',
  PASS_WITH_DEFECTS: 'bg-amber-500/15 text-amber-300',
  FAIL: 'bg-rose-500/15 text-rose-300',
}

const DEFECT_SEVERITY_TONE: Record<DefectSeverity, string> = {
  CRITICAL: 'bg-rose-600/30 text-rose-200 border-rose-500/60',
  MAJOR: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  MINOR: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  TRIVIAL: 'bg-secondary text-muted-foreground border-border',
}

const DEFECT_STATUS_TONE: Record<DefectStatus, string> = {
  OPEN: 'bg-rose-500/15 text-rose-300',
  IN_REVIEW: 'bg-blue-500/15 text-blue-300',
  FIXED: 'bg-emerald-500/15 text-emerald-300',
  WONT_FIX: 'bg-secondary text-muted-foreground line-through',
  DUPLICATE: 'bg-secondary text-muted-foreground',
}

const DEFAULT_CHECKLIST_BY_TYPE: Record<InspectionType, string[]> = {
  CODE_REVIEW: [
    'Cobertura de tests adecuada',
    'Manejo de errores tipados',
    'Sin secrets en logs',
    'Performance aceptable',
    'Documentación actualizada',
  ],
  TEST_REVIEW: [
    'Casos felices cubiertos',
    'Edge cases identificados',
    'Mocks aislados',
    'Sin tests flaky',
    'Pasan en CI',
  ],
  DESIGN_REVIEW: [
    'Mockups aprobados',
    'Accesibilidad (WCAG AA)',
    'Responsive validado',
    'Tokens del design system',
    'Patrones consistentes',
  ],
  AUDIT: [
    'Trazabilidad completa',
    'Audit log activo',
    'RLS verificado',
    'Sin desviaciones del estándar',
  ],
  WALKTHROUGH: [
    'Flow E2E demostrado',
    'Stakeholders presentes',
    'Notas tomadas',
    'Acción items registrados',
  ],
}

export function ProjectQualityClient({
  project,
  inspections: initialInspections,
  defects: initialDefects,
  users,
  tasks,
}: Props) {
  const [tab, setTab] = useState<'inspections' | 'defects'>('inspections')
  const [inspections, setInspections] = useState(initialInspections)
  const [defects, setDefects] = useState(initialDefects)
  const [showInspectionModal, setShowInspectionModal] = useState(false)
  const [showDefectModal, setShowDefectModal] = useState(false)
  const [editingInspection, setEditingInspection] = useState<InspectionRow | null>(null)
  const [editingDefect, setEditingDefect] = useState<DefectRow | null>(null)

  const stats = {
    pending: inspections.filter((i) => i.result === 'PENDING').length,
    pass: inspections.filter((i) => i.result === 'PASS').length,
    fail: inspections.filter((i) => i.result === 'FAIL').length,
    open: defects.filter((d) => d.status === 'OPEN' || d.status === 'IN_REVIEW').length,
    critical: defects.filter((d) => d.severity === 'CRITICAL' && d.status !== 'FIXED').length,
    fixed: defects.filter((d) => d.status === 'FIXED').length,
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-auto p-6">
      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Kpi label="Pendientes" value={stats.pending} tone="bg-secondary text-muted-foreground" />
        <Kpi label="Pass" value={stats.pass} tone="bg-emerald-500/15 text-emerald-300" />
        <Kpi label="Fail" value={stats.fail} tone="bg-rose-500/15 text-rose-300" />
        <Kpi label="Defectos abiertos" value={stats.open} tone="bg-amber-500/15 text-amber-300" />
        <Kpi label="Críticos" value={stats.critical} tone="bg-rose-500/15 text-rose-300" />
        <Kpi label="Resueltos" value={stats.fixed} tone="bg-emerald-500/15 text-emerald-300" />
      </section>

      {/* Tabs */}
      <div className="flex border-b border-border">
        <TabButton
          active={tab === 'inspections'}
          onClick={() => setTab('inspections')}
          icon={<ShieldCheck className="h-4 w-4" />}
        >
          Inspecciones · {inspections.length}
        </TabButton>
        <TabButton
          active={tab === 'defects'}
          onClick={() => setTab('defects')}
          icon={<Bug className="h-4 w-4" />}
        >
          Defectos · {defects.length}
        </TabButton>
        <div className="ml-auto flex items-center gap-2 pb-2">
          {tab === 'inspections' ? (
            <button
              type="button"
              onClick={() => setShowInspectionModal(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              Nueva inspección
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowDefectModal(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              Reportar defecto
            </button>
          )}
        </div>
      </div>

      {/* Tab content */}
      {tab === 'inspections' ? (
        <InspectionsTab
          inspections={inspections}
          onEdit={(i) => setEditingInspection(i)}
          onDelete={async (id) => {
            try {
              await deleteInspection({ id })
              setInspections((prev) => prev.filter((x) => x.id !== id))
              toast.success('Inspección eliminada')
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Error al eliminar')
            }
          }}
        />
      ) : (
        <DefectsTab
          defects={defects}
          onEdit={(d) => setEditingDefect(d)}
          onDelete={async (id) => {
            try {
              await deleteDefect({ id })
              setDefects((prev) => prev.filter((x) => x.id !== id))
              toast.success('Defecto eliminado')
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Error al eliminar')
            }
          }}
        />
      )}

      {showInspectionModal && (
        <InspectionModal
          mode="create"
          projectId={project.id}
          users={users}
          tasks={tasks}
          onClose={() => setShowInspectionModal(false)}
          onSaved={(i) => {
            setInspections((prev) => [i, ...prev])
            setShowInspectionModal(false)
          }}
        />
      )}
      {editingInspection && (
        <InspectionModal
          mode="edit"
          projectId={project.id}
          users={users}
          tasks={tasks}
          inspection={editingInspection}
          onClose={() => setEditingInspection(null)}
          onSaved={(i) => {
            setInspections((prev) => prev.map((x) => (x.id === i.id ? i : x)))
            setEditingInspection(null)
          }}
        />
      )}
      {showDefectModal && (
        <DefectModal
          mode="create"
          projectId={project.id}
          users={users}
          tasks={tasks}
          inspections={inspections}
          onClose={() => setShowDefectModal(false)}
          onSaved={(d) => {
            setDefects((prev) => [d, ...prev])
            setShowDefectModal(false)
          }}
        />
      )}
      {editingDefect && (
        <DefectModal
          mode="edit"
          projectId={project.id}
          users={users}
          tasks={tasks}
          inspections={inspections}
          defect={editingDefect}
          onClose={() => setEditingDefect(null)}
          onSaved={(d) => {
            setDefects((prev) => prev.map((x) => (x.id === d.id ? d : x)))
            setEditingDefect(null)
          }}
        />
      )}
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={clsx('rounded-lg border border-border p-3', tone)}>
      <p className="text-[10px] uppercase tracking-wider opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors',
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

// ─────────────────────── Inspections Tab ───────────────────────

function InspectionsTab({
  inspections,
  onEdit,
  onDelete,
}: {
  inspections: InspectionRow[]
  onEdit: (i: InspectionRow) => void
  onDelete: (id: string) => Promise<void>
}) {
  if (inspections.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
        <ShieldCheck className="mx-auto h-10 w-10 text-emerald-400 opacity-50" />
        <p className="mt-3 text-sm text-foreground">
          Sin inspecciones registradas todavía.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Crea la primera para empezar a auditar entregables.
        </p>
      </div>
    )
  }
  return (
    <ul className="space-y-2">
      {inspections.map((i) => {
        const checklistDone =
          i.checklist?.items.filter((it) => it.done).length ?? 0
        const checklistTotal = i.checklist?.items.length ?? 0
        return (
          <li
            key={i.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {INSPECTION_TYPE_LABEL[i.type]}
                </span>
                <span
                  className={clsx(
                    'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                    INSPECTION_RESULT_TONE[i.result],
                  )}
                >
                  {i.result.replace('_', ' ')}
                </span>
                {i.taskMnemonic && (
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {i.taskMnemonic}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {i.inspectorName ? `Inspector: ${i.inspectorName} · ` : ''}
                {checklistTotal > 0 && (
                  <>checklist {checklistDone}/{checklistTotal} · </>
                )}
                {i.defectCount} defecto{i.defectCount === 1 ? '' : 's'}
                {i.scheduledAt && (
                  <> · {new Date(i.scheduledAt).toLocaleDateString()}</>
                )}
              </p>
              {i.taskTitle && (
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  Sobre: {i.taskTitle}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onEdit(i)}
              className="rounded-md border border-border bg-secondary px-2 py-1 text-xs hover:bg-secondary/80"
            >
              Editar
            </button>
            <button
              type="button"
              onClick={async () => {
                if (confirm(`Eliminar inspección ${INSPECTION_TYPE_LABEL[i.type]}?`)) {
                  await onDelete(i.id)
                }
              }}
              className="rounded-md border border-destructive/40 bg-destructive/10 p-1 text-destructive hover:bg-destructive/20"
              title="Eliminar"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// ─────────────────────── Defects Tab ───────────────────────

function DefectsTab({
  defects,
  onEdit,
  onDelete,
}: {
  defects: DefectRow[]
  onEdit: (d: DefectRow) => void
  onDelete: (id: string) => Promise<void>
}) {
  const [filterStatus, setFilterStatus] = useState<DefectStatus | 'ALL'>('ALL')
  const [filterSeverity, setFilterSeverity] = useState<DefectSeverity | 'ALL'>('ALL')
  const filtered = defects.filter(
    (d) =>
      (filterStatus === 'ALL' || d.status === filterStatus) &&
      (filterSeverity === 'ALL' || d.severity === filterSeverity),
  )

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Filtrar:</span>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as DefectStatus | 'ALL')}
          className="rounded-md border border-border bg-input px-2 py-1"
        >
          <option value="ALL">Todos los estados</option>
          <option value="OPEN">Abierto</option>
          <option value="IN_REVIEW">En revisión</option>
          <option value="FIXED">Resuelto</option>
          <option value="WONT_FIX">No se arregla</option>
          <option value="DUPLICATE">Duplicado</option>
        </select>
        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value as DefectSeverity | 'ALL')}
          className="rounded-md border border-border bg-input px-2 py-1"
        >
          <option value="ALL">Cualquier severity</option>
          <option value="CRITICAL">Crítico</option>
          <option value="MAJOR">Mayor</option>
          <option value="MINOR">Menor</option>
          <option value="TRIVIAL">Trivial</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <Bug className="mx-auto h-10 w-10 text-amber-400 opacity-50" />
          <p className="mt-3 text-sm text-foreground">Sin defectos con ese filtro.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={clsx(
                      'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                      DEFECT_SEVERITY_TONE[d.severity],
                    )}
                  >
                    {d.severity}
                  </span>
                  <span
                    className={clsx(
                      'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      DEFECT_STATUS_TONE[d.status],
                    )}
                  >
                    {d.status.replace('_', ' ')}
                  </span>
                  <span className="text-sm font-medium text-foreground">
                    {d.title}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {d.taskMnemonic && <>Task {d.taskMnemonic} · </>}
                  {d.ownerName && <>Owner: {d.ownerName} · </>}
                  {d.reporterName && <>Reportó: {d.reporterName} · </>}
                  {new Date(d.createdAt).toLocaleDateString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onEdit(d)}
                className="rounded-md border border-border bg-secondary px-2 py-1 text-xs hover:bg-secondary/80"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (confirm(`Eliminar defecto "${d.title}"?`)) {
                    await onDelete(d.id)
                  }
                }}
                className="rounded-md border border-destructive/40 bg-destructive/10 p-1 text-destructive hover:bg-destructive/20"
                title="Eliminar"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

// ─────────────────────── Inspection Modal ───────────────────────

function InspectionModal({
  mode,
  projectId,
  users,
  tasks,
  inspection,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  projectId: string
  users: { id: string; name: string }[]
  tasks: { id: string; title: string; mnemonic: string | null }[]
  inspection?: InspectionRow
  onClose: () => void
  onSaved: (i: InspectionRow) => void
}) {
  const titleId = useId()
  const [type, setType] = useState<InspectionType>(inspection?.type ?? 'CODE_REVIEW')
  const [result, setResult] = useState<InspectionResult>(inspection?.result ?? 'PENDING')
  const [inspectorId, setInspectorId] = useState(inspection?.inspectorId ?? '')
  const [taskId, setTaskId] = useState(inspection?.taskId ?? '')
  const [scheduledAt, setScheduledAt] = useState(
    inspection?.scheduledAt ? inspection.scheduledAt.split('T')[0] : '',
  )
  const [summary, setSummary] = useState(inspection?.summary ?? '')
  const [items, setItems] = useState<ChecklistItem[]>(
    inspection?.checklist?.items ??
      DEFAULT_CHECKLIST_BY_TYPE[inspection?.type ?? 'CODE_REVIEW'].map((t) => ({
        text: t,
        done: false,
      })),
  )
  const [isPending, startTransition] = useTransition()

  const handleTypeChange = (next: InspectionType) => {
    setType(next)
    if (mode === 'create') {
      // Recargar plantilla de checklist al cambiar tipo si no fue editada
      setItems(
        DEFAULT_CHECKLIST_BY_TYPE[next].map((t) => ({ text: t, done: false })),
      )
    }
  }

  const handleSubmit = () => {
    startTransition(async () => {
      try {
        const payload = {
          type,
          inspectorId: inspectorId || null,
          taskId: taskId || null,
          scheduledAt: scheduledAt || null,
          summary: summary.trim() || null,
          checklist: { items },
        }
        if (mode === 'edit' && inspection) {
          await updateInspection({ id: inspection.id, ...payload, result })
          onSaved({
            ...inspection,
            type,
            result,
            inspectorId: inspectorId || null,
            inspectorName: users.find((u) => u.id === inspectorId)?.name ?? null,
            taskId: taskId || null,
            taskTitle: tasks.find((t) => t.id === taskId)?.title ?? null,
            taskMnemonic: tasks.find((t) => t.id === taskId)?.mnemonic ?? null,
            scheduledAt: scheduledAt
              ? new Date(scheduledAt).toISOString()
              : null,
            summary: summary.trim() || null,
            checklist: { items },
            completedAt:
              result !== 'PENDING'
                ? inspection.completedAt ?? new Date().toISOString()
                : null,
          })
          toast.success('Inspección actualizada')
        } else {
          const r = await createInspection({ projectId, ...payload })
          onSaved({
            id: r.id,
            type,
            result: 'PENDING',
            inspectorId: inspectorId || null,
            inspectorName: users.find((u) => u.id === inspectorId)?.name ?? null,
            taskId: taskId || null,
            taskTitle: tasks.find((t) => t.id === taskId)?.title ?? null,
            taskMnemonic: tasks.find((t) => t.id === taskId)?.mnemonic ?? null,
            scheduledAt: scheduledAt
              ? new Date(scheduledAt).toISOString()
              : null,
            completedAt: null,
            summary: summary.trim() || null,
            checklist: { items },
            defectCount: 0,
            createdAt: new Date().toISOString(),
          })
          toast.success('Inspección creada')
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al guardar')
      }
    })
  }

  return (
    <Modal title={mode === 'create' ? 'Nueva inspección' : 'Editar inspección'} onClose={onClose} titleId={titleId}>
      <div className="space-y-3 p-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <select
              value={type}
              onChange={(e) => handleTypeChange(e.target.value as InspectionType)}
              className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm"
            >
              {(Object.keys(INSPECTION_TYPE_LABEL) as InspectionType[]).map(
                (t) => (
                  <option key={t} value={t}>
                    {INSPECTION_TYPE_LABEL[t]}
                  </option>
                ),
              )}
            </select>
          </Field>
          {mode === 'edit' && (
            <Field label="Resultado">
              <select
                value={result}
                onChange={(e) => setResult(e.target.value as InspectionResult)}
                className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm"
              >
                <option value="PENDING">Pendiente</option>
                <option value="PASS">Pass</option>
                <option value="PASS_WITH_DEFECTS">Pass con defectos</option>
                <option value="FAIL">Fail</option>
              </select>
            </Field>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Inspector">
            <select
              value={inspectorId}
              onChange={(e) => setInspectorId(e.target.value)}
              className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm"
            >
              <option value="">Sin asignar</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fecha programada">
            <input
              type="date"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm"
            />
          </Field>
        </div>

        <Field label="Sobre tarea (opcional)">
          <select
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm"
          >
            <option value="">Sin tarea específica (proyecto completo)</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.mnemonic ? `${t.mnemonic} · ` : ''}{t.title}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Checklist">
          <div className="space-y-1.5">
            {items.map((it, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={it.done}
                  onChange={(e) => {
                    const next = [...items]
                    next[idx] = { ...it, done: e.target.checked }
                    setItems(next)
                  }}
                  className="mt-1.5"
                />
                <input
                  type="text"
                  value={it.text}
                  onChange={(e) => {
                    const next = [...items]
                    next[idx] = { ...it, text: e.target.value }
                    setItems(next)
                  }}
                  className="flex-1 rounded-md border border-border bg-input px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={() => setItems(items.filter((_, i) => i !== idx))}
                  className="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                  title="Eliminar item"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setItems([...items, { text: '', done: false }])}
              className="text-xs text-primary hover:underline"
            >
              + Añadir item
            </button>
          </div>
        </Field>

        <Field label="Resumen / notas">
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-md border border-border bg-input px-2 py-1.5 text-sm"
            placeholder="Conclusiones, recomendaciones, próximos pasos…"
          />
        </Field>
      </div>

      <Footer
        onCancel={onClose}
        onSubmit={handleSubmit}
        isPending={isPending}
        submitLabel={mode === 'create' ? 'Crear' : 'Guardar cambios'}
      />
    </Modal>
  )
}

// ─────────────────────── Defect Modal ───────────────────────

function DefectModal({
  mode,
  projectId,
  users,
  tasks,
  inspections,
  defect,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  projectId: string
  users: { id: string; name: string }[]
  tasks: { id: string; title: string; mnemonic: string | null }[]
  inspections: InspectionRow[]
  defect?: DefectRow
  onClose: () => void
  onSaved: (d: DefectRow) => void
}) {
  const titleId = useId()
  const [title, setTitle] = useState(defect?.title ?? '')
  const [description, setDescription] = useState(defect?.description ?? '')
  const [severity, setSeverity] = useState<DefectSeverity>(defect?.severity ?? 'MAJOR')
  const [status, setStatus] = useState<DefectStatus>(defect?.status ?? 'OPEN')
  const [ownerId, setOwnerId] = useState(defect?.ownerId ?? '')
  const [taskId, setTaskId] = useState(defect?.taskId ?? '')
  const [inspectionId, setInspectionId] = useState(defect?.inspectionId ?? '')
  const [resolution, setResolution] = useState(defect?.resolution ?? '')
  const [isPending, startTransition] = useTransition()

  const handleSubmit = () => {
    if (!title.trim()) {
      toast.error('Título requerido')
      return
    }
    startTransition(async () => {
      try {
        if (mode === 'edit' && defect) {
          await updateDefect({
            id: defect.id,
            title: title.trim(),
            description: description.trim() || null,
            severity,
            status,
            ownerId: ownerId || null,
            resolution: resolution.trim() || null,
          })
          onSaved({
            ...defect,
            title: title.trim(),
            description: description.trim() || null,
            severity,
            status,
            ownerId: ownerId || null,
            ownerName: users.find((u) => u.id === ownerId)?.name ?? null,
            resolution: resolution.trim() || null,
            resolvedAt:
              ['FIXED', 'WONT_FIX', 'DUPLICATE'].includes(status)
                ? defect.resolvedAt ?? new Date().toISOString()
                : null,
          })
          toast.success('Defecto actualizado')
        } else {
          const r = await createDefect({
            projectId,
            title: title.trim(),
            description: description.trim() || null,
            severity,
            status,
            ownerId: ownerId || null,
            taskId: taskId || null,
            inspectionId: inspectionId || null,
          })
          onSaved({
            id: r.id,
            title: title.trim(),
            description: description.trim() || null,
            severity,
            status,
            ownerId: ownerId || null,
            ownerName: users.find((u) => u.id === ownerId)?.name ?? null,
            reporterId: null,
            reporterName: null,
            taskId: taskId || null,
            taskTitle: tasks.find((t) => t.id === taskId)?.title ?? null,
            taskMnemonic: tasks.find((t) => t.id === taskId)?.mnemonic ?? null,
            inspectionId: inspectionId || null,
            inspectionType:
              inspections.find((i) => i.id === inspectionId)?.type ?? null,
            resolvedAt: null,
            resolution: null,
            createdAt: new Date().toISOString(),
          })
          toast.success('Defecto reportado')
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al guardar')
      }
    })
  }

  return (
    <Modal title={mode === 'create' ? 'Reportar defecto' : 'Editar defecto'} onClose={onClose} titleId={titleId}>
      <div className="space-y-3 p-5">
        <Field label="Título" required>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ej. Botón guardar no responde en Safari"
            autoFocus
            className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Descripción">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Pasos para reproducir, comportamiento esperado, observado…"
            className="w-full resize-none rounded-md border border-border bg-input px-3 py-2 text-sm"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Severity">
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as DefectSeverity)}
              className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm"
            >
              <option value="CRITICAL">Crítico (bloquea release)</option>
              <option value="MAJOR">Mayor</option>
              <option value="MINOR">Menor</option>
              <option value="TRIVIAL">Trivial / sugerencia</option>
            </select>
          </Field>
          <Field label="Estado">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as DefectStatus)}
              className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm"
            >
              <option value="OPEN">Abierto</option>
              <option value="IN_REVIEW">En revisión</option>
              <option value="FIXED">Resuelto</option>
              <option value="WONT_FIX">No se arregla</option>
              <option value="DUPLICATE">Duplicado</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Owner (responsable de fix)">
            <select
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm"
            >
              <option value="">Sin asignar</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          {mode === 'create' && (
            <Field label="Task afectada (opcional)">
              <select
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
                className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm"
              >
                <option value="">Sin task</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.mnemonic ? `${t.mnemonic} · ` : ''}{t.title}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        {mode === 'create' && (
          <Field label="Inspection origen (opcional)">
            <select
              value={inspectionId}
              onChange={(e) => setInspectionId(e.target.value)}
              className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm"
            >
              <option value="">Reporte directo (sin inspection)</option>
              {inspections.map((i) => (
                <option key={i.id} value={i.id}>
                  {INSPECTION_TYPE_LABEL[i.type]}
                  {i.taskMnemonic ? ` · ${i.taskMnemonic}` : ''}
                </option>
              ))}
            </select>
          </Field>
        )}

        {mode === 'edit' && ['FIXED', 'WONT_FIX', 'DUPLICATE'].includes(status) && (
          <Field label="Notas de resolución">
            <textarea
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              rows={2}
              placeholder="Cómo se resolvió · referencia a PR/commit cuando aplique"
              className="w-full resize-none rounded-md border border-border bg-input px-3 py-2 text-sm"
            />
          </Field>
        )}
      </div>

      <Footer
        onCancel={onClose}
        onSubmit={handleSubmit}
        isPending={isPending}
        submitLabel={mode === 'create' ? 'Reportar' : 'Guardar cambios'}
        disabled={!title.trim()}
      />
    </Modal>
  )
}

// ─────────────────────── Modal helpers ───────────────────────

function Modal({
  title,
  onClose,
  titleId,
  children,
}: {
  title: string
  onClose: () => void
  titleId: string
  children: React.ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-[560px] rounded-xl border border-border bg-card shadow-2xl max-h-[90vh] overflow-y-auto">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h2 id={titleId} className="text-base font-semibold text-foreground">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}

function Footer({
  onCancel,
  onSubmit,
  isPending,
  submitLabel,
  disabled,
}: {
  onCancel: () => void
  onSubmit: () => void
  isPending: boolean
  submitLabel: string
  disabled?: boolean
}) {
  return (
    <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-subtle/50 px-5 py-3">
      <button
        type="button"
        onClick={onCancel}
        disabled={isPending}
        className="rounded-md border border-border bg-secondary px-3 py-1.5 text-sm hover:bg-secondary/80 disabled:opacity-60"
      >
        Cancelar
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={isPending || disabled}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {isPending ? 'Guardando…' : submitLabel}
      </button>
    </footer>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </label>
      {children}
    </div>
  )
}
