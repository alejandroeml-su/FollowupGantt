'use client'

/**
 * Wave C-debt-1 · Equipo C-DEBT-1 — Sección "Checklist" del TaskDrawer.
 *
 * Renderiza N checklists relacionales para una `Task`, cada una con:
 *   - Título opcional (read-only en MVP — se setea al crear).
 *   - Lista de items con checkbox interactivo (toggle done) y botón de
 *     eliminación con confirm.
 *   - Input "+ Añadir item" al fondo.
 *   - Reorder simple via flechas ↑/↓ (drag&drop nativo HTML5 dejaría una
 *     dependencia visual frágil sin librería).
 *
 * Si la task no tiene checklists, se muestra un CTA "Nueva checklist".
 *
 * Convenciones aplicadas:
 *   - Strings ES.
 *   - A11y: cada lista lleva `role="list"` y los checkboxes son nativos
 *     (`<input type="checkbox">`) con `aria-label` y `aria-checked`
 *     implícito por el browser.
 *   - React 19: lazy load via `useEffect` + ref (mismo patrón que
 *     `TaskDocsSection`); optimistic updates con `useState` y rollback en
 *     error.
 *   - Sin `useEffect → setState` directo: el toggle hace mutación en server
 *     y luego setea el estado del item retornado (no setea desde un effect
 *     que dependa de props).
 */

import { useEffect, useRef, useState, useTransition } from 'react'
import {
  CheckSquare,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Pencil,
  Check,
  X,
} from 'lucide-react'
import {
  getChecklistsForTask,
  createChecklist,
  addChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
  reorderChecklistItems,
  updateChecklist,
  deleteChecklist,
  type ChecklistDTO,
  type ChecklistItemDTO,
} from '@/lib/actions/checklist'

interface Props {
  taskId: string
}

/**
 * Evento global que emiten otros componentes (ej: AITaskRefineMenu tras
 * insertar una checklist sugerida) para forzar refresh de esta sección.
 * El detail.taskId opcional permite filtrar; si no llega, refrescamos
 * sin filtro (estamos montados solo para el task actual de cualquier
 * modo).
 */
const CHECKLIST_REFRESH_EVENT = 'task-checklist:refresh'

export function TaskChecklistSection({ taskId }: Props) {
  const [checklists, setChecklists] = useState<ChecklistDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const lastTaskIdRef = useRef<string | null>(null)

  function reload(targetTaskId: string) {
    startTransition(async () => {
      try {
        const list = await getChecklistsForTask(targetTaskId)
        setChecklists(list)
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error desconocido')
        setChecklists([])
      }
    })
  }

  // Lazy-load: la primera vez por taskId, cargamos. Pattern alineado con
  // TaskDocsSection — la ref se muta primero y reload arranca un transition.
  useEffect(() => {
    if (lastTaskIdRef.current === taskId) return
    lastTaskIdRef.current = taskId
    reload(taskId)
  }, [taskId])

  // Escucha eventos de refresh externos (ej: tras aplicar checklist IA
  // desde el menú de refinamiento). Sin esto, una checklist creada
  // server-side no aparecía hasta refresh manual del drawer.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ taskId?: string }>).detail
      if (!detail || !detail.taskId || detail.taskId === taskId) {
        reload(taskId)
      }
    }
    window.addEventListener(CHECKLIST_REFRESH_EVENT, handler)
    return () => window.removeEventListener(CHECKLIST_REFRESH_EVENT, handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  async function handleCreateChecklist() {
    try {
      const created = await createChecklist({
        taskId,
        title: 'Checklist',
      })
      setChecklists((prev) => (prev ? [...prev, created] : [created]))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al crear checklist')
    }
  }

  async function handleUpdateTitle(checklistId: string, title: string) {
    const trimmed = title.trim()
    // Optimistic.
    const prevState = checklists
    setChecklists((prev) =>
      prev
        ? prev.map((cl) =>
            cl.id === checklistId
              ? { ...cl, title: trimmed.length > 0 ? trimmed : null }
              : cl,
          )
        : prev,
    )
    try {
      await updateChecklist({
        checklistId,
        title: trimmed.length > 0 ? trimmed : null,
      })
    } catch (e) {
      setChecklists(prevState)
      setError(e instanceof Error ? e.message : 'Error al actualizar título')
    }
  }

  async function handleDeleteChecklist(checklistId: string) {
    const ok = typeof window !== 'undefined'
      ? window.confirm('¿Eliminar este checklist completo?')
      : true
    if (!ok) return
    const prevState = checklists
    setChecklists((prev) => prev?.filter((cl) => cl.id !== checklistId) ?? prev)
    try {
      await deleteChecklist({ checklistId })
    } catch (e) {
      setChecklists(prevState)
      setError(e instanceof Error ? e.message : 'Error al eliminar checklist')
    }
  }

  async function handleAddItem(checklistId: string, text: string) {
    if (!text.trim()) return
    try {
      const newItem = await addChecklistItem({ checklistId, text })
      setChecklists((prev) =>
        prev
          ? prev.map((cl) =>
              cl.id === checklistId
                ? { ...cl, items: [...cl.items, newItem] }
                : cl,
            )
          : prev,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al añadir item')
    }
  }

  async function handleToggle(item: ChecklistItemDTO) {
    // Optimistic flip.
    setChecklists((prev) =>
      prev
        ? prev.map((cl) =>
            cl.id === item.checklistId
              ? {
                  ...cl,
                  items: cl.items.map((it) =>
                    it.id === item.id ? { ...it, done: !it.done } : it,
                  ),
                }
              : cl,
          )
        : prev,
    )
    try {
      const updated = await toggleChecklistItem({ itemId: item.id })
      setChecklists((prev) =>
        prev
          ? prev.map((cl) =>
              cl.id === item.checklistId
                ? {
                    ...cl,
                    items: cl.items.map((it) =>
                      it.id === item.id ? updated : it,
                    ),
                  }
                : cl,
            )
          : prev,
      )
    } catch (e) {
      // Rollback.
      setChecklists((prev) =>
        prev
          ? prev.map((cl) =>
              cl.id === item.checklistId
                ? {
                    ...cl,
                    items: cl.items.map((it) =>
                      it.id === item.id ? { ...it, done: item.done } : it,
                    ),
                  }
                : cl,
          )
          : prev,
      )
      setError(e instanceof Error ? e.message : 'Error al actualizar item')
    }
  }

  async function handleDelete(item: ChecklistItemDTO) {
    const ok = typeof window !== 'undefined'
      ? window.confirm(`Eliminar "${item.text}"?`)
      : true
    if (!ok) return

    // Optimistic: remover del state.
    const prevState = checklists
    setChecklists((prev) =>
      prev
        ? prev.map((cl) =>
            cl.id === item.checklistId
              ? { ...cl, items: cl.items.filter((it) => it.id !== item.id) }
              : cl,
          )
        : prev,
    )

    try {
      await deleteChecklistItem({ itemId: item.id })
    } catch (e) {
      // Rollback.
      setChecklists(prevState)
      setError(e instanceof Error ? e.message : 'Error al eliminar item')
    }
  }

  async function handleMove(
    checklist: ChecklistDTO,
    itemId: string,
    delta: -1 | 1,
  ) {
    const ids = checklist.items.map((it) => it.id)
    const idx = ids.indexOf(itemId)
    if (idx < 0) return
    const newIdx = idx + delta
    if (newIdx < 0 || newIdx >= ids.length) return
    const reordered = [...ids]
    ;[reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]]

    // Optimistic.
    const prevState = checklists
    setChecklists((prev) =>
      prev
        ? prev.map((cl) =>
            cl.id === checklist.id
              ? {
                  ...cl,
                  items: reordered.map(
                    (id) => cl.items.find((it) => it.id === id)!,
                  ),
                }
              : cl,
          )
        : prev,
    )

    try {
      await reorderChecklistItems({
        checklistId: checklist.id,
        itemIds: reordered,
      })
    } catch (e) {
      setChecklists(prevState)
      setError(e instanceof Error ? e.message : 'Error al reordenar')
    }
  }

  return (
    <section data-testid="task-checklist-section">
      <header className="mb-2 flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <CheckSquare className="h-3.5 w-3.5 text-primary" />
          Checklists
          {checklists ? (
            <span className="text-[10px] text-muted-foreground">
              ({checklists.length})
            </span>
          ) : null}
        </h4>
        <button
          type="button"
          onClick={handleCreateChecklist}
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] hover:bg-secondary"
          data-testid="task-checklist-new"
        >
          <Plus className="h-3 w-3" />
          Nueva checklist
        </button>
      </header>

      {error ? (
        <p
          className="text-[11px] text-red-500"
          data-testid="task-checklist-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {checklists === null ? (
        <p className="text-[11px] text-muted-foreground">Cargando…</p>
      ) : checklists.length === 0 ? (
        <p
          className="rounded border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground"
          data-testid="task-checklist-empty"
        >
          Aún no hay checklists para esta tarea.
        </p>
      ) : (
        <div className="space-y-3" data-testid="task-checklist-list">
          {checklists.map((cl) => (
            <ChecklistBlock
              key={cl.id}
              checklist={cl}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onMove={(itemId, delta) => handleMove(cl, itemId, delta)}
              onAddItem={(text) => handleAddItem(cl.id, text)}
              onUpdateTitle={(title) => handleUpdateTitle(cl.id, title)}
              onDeleteChecklist={() => handleDeleteChecklist(cl.id)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

interface ChecklistBlockProps {
  checklist: ChecklistDTO
  onToggle: (item: ChecklistItemDTO) => void
  onDelete: (item: ChecklistItemDTO) => void
  onMove: (itemId: string, delta: -1 | 1) => void
  onAddItem: (text: string) => void
  onUpdateTitle: (title: string) => void
  onDeleteChecklist: () => void
}

function ChecklistBlock({
  checklist,
  onToggle,
  onDelete,
  onMove,
  onAddItem,
  onUpdateTitle,
  onDeleteChecklist,
}: ChecklistBlockProps) {
  const [draft, setDraft] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(checklist.title ?? '')

  const total = checklist.items.length
  const done = checklist.items.filter((it) => it.done).length
  const percent = total > 0 ? Math.round((done / total) * 100) : 0

  function commitTitle() {
    setEditingTitle(false)
    const next = titleDraft.trim()
    const current = (checklist.title ?? '').trim()
    if (next === current) return
    onUpdateTitle(next)
  }

  function cancelTitleEdit() {
    setEditingTitle(false)
    setTitleDraft(checklist.title ?? '')
  }

  return (
    <div
      className="rounded border border-border bg-card/40 p-2"
      data-testid={`task-checklist-block-${checklist.id}`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        {editingTitle ? (
          <div className="flex flex-1 items-center gap-1">
            <input
              type="text"
              value={titleDraft}
              autoFocus
              onChange={(ev) => setTitleDraft(ev.target.value)}
              onBlur={commitTitle}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') commitTitle()
                if (ev.key === 'Escape') cancelTitleEdit()
              }}
              maxLength={200}
              placeholder="Título del checklist"
              className="flex-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium"
              aria-label="Editar título del checklist"
              data-testid={`task-checklist-title-input-${checklist.id}`}
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={commitTitle}
              className="rounded p-0.5 text-emerald-500 hover:bg-emerald-500/10"
              aria-label="Guardar título"
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={cancelTitleEdit}
              className="rounded p-0.5 text-muted-foreground hover:bg-secondary"
              aria-label="Cancelar"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className="flex flex-1 items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="flex items-center gap-1 text-[11px] font-medium text-foreground hover:text-primary truncate"
              aria-expanded={!collapsed}
              data-testid={`task-checklist-toggle-${checklist.id}`}
            >
              {collapsed ? (
                <ChevronDown className="h-3 w-3 shrink-0" />
              ) : (
                <ChevronUp className="h-3 w-3 shrink-0" />
              )}
              <span className="truncate">{checklist.title ?? 'Checklist'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTitleDraft(checklist.title ?? '')
                setEditingTitle(true)
              }}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 focus:opacity-100"
              aria-label="Editar título del checklist"
              data-testid={`task-checklist-edit-title-${checklist.id}`}
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={onDeleteChecklist}
              className="rounded p-0.5 text-muted-foreground hover:text-red-500"
              aria-label="Eliminar checklist completo"
              data-testid={`task-checklist-delete-block-${checklist.id}`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
        <span
          className="shrink-0 text-[10px] text-muted-foreground tabular-nums"
          data-testid={`task-checklist-progress-${checklist.id}`}
        >
          {done}/{total} · {percent}%
        </span>
      </div>

      {/* Barra de progreso */}
      <div
        className="mb-2 h-1 w-full overflow-hidden rounded-full bg-secondary/40"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Progreso del checklist: ${percent}%`}
      >
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>

      {!collapsed ? (
        <>
          <ul role="list" className="space-y-1">
            {checklist.items.map((item, idx) => (
              <li
                key={item.id}
                className="flex items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-secondary/40"
                data-testid={`task-checklist-item-${item.id}`}
              >
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() => onToggle(item)}
                  aria-label={item.text}
                  className="h-3.5 w-3.5 cursor-pointer"
                />
                <span
                  className={
                    item.done
                      ? 'flex-1 truncate text-muted-foreground line-through'
                      : 'flex-1 truncate'
                  }
                >
                  {item.text}
                </span>
                <button
                  type="button"
                  onClick={() => onMove(item.id, -1)}
                  disabled={idx === 0}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label={`Mover "${item.text}" arriba`}
                  data-testid={`task-checklist-up-${item.id}`}
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onMove(item.id, 1)}
                  disabled={idx === checklist.items.length - 1}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label={`Mover "${item.text}" abajo`}
                  data-testid={`task-checklist-down-${item.id}`}
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(item)}
                  className="rounded p-0.5 text-muted-foreground hover:text-red-500"
                  aria-label={`Eliminar "${item.text}"`}
                  data-testid={`task-checklist-delete-${item.id}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>

          <form
            onSubmit={(ev) => {
              ev.preventDefault()
              const txt = draft.trim()
              if (!txt) return
              onAddItem(txt)
              setDraft('')
            }}
            className="mt-2 flex items-center gap-1"
          >
            <input
              type="text"
              value={draft}
              onChange={(ev) => setDraft(ev.target.value)}
              placeholder="Añadir item…"
              maxLength={500}
              className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
              aria-label="Añadir nuevo item al checklist"
              data-testid={`task-checklist-add-input-${checklist.id}`}
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-secondary disabled:opacity-50"
              data-testid={`task-checklist-add-submit-${checklist.id}`}
            >
              <Plus className="h-3 w-3" />
              Añadir
            </button>
          </form>
        </>
      ) : null}
    </div>
  )
}
