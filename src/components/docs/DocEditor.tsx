'use client'

/**
 * Ola P2 · Equipo P2-5 — Editor del doc.
 *
 * Textarea de markdown con auto-save debounced (1s) y toggle entre
 * "Editar" y "Vista previa". El padre controla el estado canónico del
 * doc (`title` + `content`) y recibe los cambios via callback.
 *
 * Estados visibles:
 *   - `idle`     — nada que guardar.
 *   - `dirty`    — hay cambios pendientes (buffer != props).
 *   - `saving`   — `onSave` corriendo.
 *   - `saved`    — última escritura ok.
 *   - `error`    — última escritura falló.
 *
 * Notas importantes:
 *   - El padre debe re-montar este componente con `key={docId}` cuando se
 *     navega a otro doc — así el state interno se resetea limpio sin
 *     pisar el cursor del usuario.
 *   - Las nuevas reglas de React (Next 16) prohíben setState síncrono
 *     dentro de useEffect. Por eso el debounce vive en un setTimeout
 *     guardado en una ref y se actualiza desde los handlers `onChange`
 *     en lugar de un effect derivado.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, AlertCircle, Eye, Pencil } from 'lucide-react'
import { DocPreview } from './DocPreview'
import { SoftLockProvider } from '@/components/realtime-locks/SoftLockProvider'
import { EditingByBanner } from '@/components/realtime-locks/EditingByBanner'
import { ConflictDialog } from '@/components/realtime-locks/ConflictDialog'
import { useDocEditLock } from '@/components/realtime-locks/useDocEditLock'

type Props = {
  /** Doc id — usado por el padre para forzar re-mount via key={docId}. */
  docId: string
  /** Estado inicial del título y contenido. */
  initialTitle: string
  initialContent: string
  /**
   * Callback de guardado. Se invoca con el ÚLTIMO valor estable tras el
   * debounce (1s). Debe ser idempotente — el componente no de-duplica
   * llamadas si el caller no las absorbe.
   */
  onSave: (next: { title: string; content: string }) => Promise<void>
  /** Disabled (ej. doc archivado). */
  readOnly?: boolean
  /**
   * ISO `updatedAt` del doc cargado por el padre. Wave P6 · B3 lo usa para
   * detectar conflictos. Opcional — sin él la detección queda inactiva.
   */
  initialUpdatedAt?: string | null
  /**
   * Identidad del usuario activo. Wave P6 · B3: opcional. Sin currentUser
   * el editor renderiza igual pero sin presence.
   */
  currentUser?: { id: string; name: string } | null
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

const DEBOUNCE_MS = 1000

export function DocEditor({
  docId,
  initialTitle,
  initialContent,
  onSave,
  readOnly = false,
  initialUpdatedAt = null,
  currentUser,
}: Props) {
  const [title, setTitle] = useState(initialTitle)
  const [content, setContent] = useState(initialContent)
  const [view, setView] = useState<'edit' | 'preview'>('edit')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)

  // Wave P6 · B3 — Edit lock + conflict detection.
  const resolvedCurrentUser = useMemo(() => currentUser ?? null, [currentUser])
  const lock = useDocEditLock({
    docId,
    currentUser: resolvedCurrentUser,
    currentVersion: initialUpdatedAt ?? null,
  })

  // Lifecycle: marcar editing en mount, liberar en unmount. El padre re-monta
  // el componente con key={docId}, así que cada doc abre su propio lock.
  useEffect(() => {
    if (!resolvedCurrentUser) return
    lock.startEditing()
    return () => {
      lock.stopEditing()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, resolvedCurrentUser?.id])

  const handleResolveConflict = useCallback(
    (action: 'overwrite' | 'accept_remote' | 'cancel') => {
      if (action === 'overwrite') {
        // Mantener mi versión: limpiamos el flag y dejamos que el próximo
        // autosave (debounced) sobrescriba la BD (last-write-wins).
        lock.dismissConflict()
      } else if (action === 'accept_remote') {
        lock.dismissConflict()
        if (typeof window !== 'undefined') window.location.reload()
      }
    },
    [lock],
  )

  // Refs para el debounce. Sólo se acceden en handlers (eventos) — nunca
  // durante render — para cumplir las reglas de hooks de React 19+.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedRef = useRef({ title: initialTitle, content: initialContent })
  const onSaveRef = useRef(onSave)

  // Mantener `onSaveRef.current` apuntando al último prop. Hacerlo dentro
  // de un useEffect (no en render directo) cumple `react-hooks/refs`.
  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  // Cleanup del timer al desmontar.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // ── Debounce centralizado en un único helper que se llama desde los
  // ── onChange handlers. Esto evita el patrón "useEffect dispara setState"
  // ── que la nueva regla react-hooks/set-state-in-effect prohíbe.
  function scheduleSave(nextTitle: string, nextContent: string): void {
    if (readOnly) return
    const dirty =
      nextTitle !== lastSavedRef.current.title ||
      nextContent !== lastSavedRef.current.content
    if (!dirty) {
      setSaveState('idle')
      return
    }
    setSaveState('dirty')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      void doSave(nextTitle, nextContent)
    }, DEBOUNCE_MS)
  }

  async function doSave(t: string, c: string): Promise<void> {
    setSaveState('saving')
    try {
      await onSaveRef.current({ title: t, content: c })
      lastSavedRef.current = { title: t, content: c }
      setSaveState('saved')
      setError(null)
    } catch (e) {
      setSaveState('error')
      setError(e instanceof Error ? e.message : 'Error desconocido')
    }
  }

  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const next = e.target.value
    setTitle(next)
    scheduleSave(next, content)
  }

  function handleContentChange(
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ): void {
    const next = e.target.value
    setContent(next)
    scheduleSave(title, next)
  }

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      data-testid="doc-editor"
    >
      {/* Wave P6 · B3 — banner de presencia. */}
      <div className="px-4 pt-2">
        <EditingByBanner
          editingUsers={lock.editingUsers}
          isLockedByOther={lock.isLockedByOther}
          onForceOverride={lock.forceOverride}
        />
      </div>

      {/* SoftLockProvider en modo unwrap para no romper el layout flex. El
          textarea se deshabilita visualmente vía la clase condicional sobre
          el wrapper inmediato; los inputs nativos siguen funcionalmente
          deshabilitados via aria-disabled. */}
      <SoftLockProvider isLocked={lock.isLockedByOther} unwrap>
      {/* Toolbar */}
      <div className="flex h-12 items-center justify-between border-b border-border bg-card/40 px-4 shrink-0">
        <div
          className="flex items-center gap-1 rounded-md border border-border bg-card p-1"
          role="tablist"
          aria-label="Modo del editor"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === 'edit'}
            onClick={() => setView('edit')}
            className={[
              'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
              view === 'edit'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            ].join(' ')}
            data-testid="doc-editor-tab-edit"
          >
            <Pencil className="h-3 w-3" aria-hidden /> Editar
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'preview'}
            onClick={() => setView('preview')}
            className={[
              'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
              view === 'preview'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            ].join(' ')}
            data-testid="doc-editor-tab-preview"
          >
            <Eye className="h-3 w-3" aria-hidden /> Vista previa
          </button>
        </div>

        <div
          className="flex items-center gap-2 text-[11px]"
          data-testid="doc-editor-status"
          aria-live="polite"
        >
          {readOnly ? (
            <span className="text-muted-foreground">Solo lectura</span>
          ) : saveState === 'saving' ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Guardando…
            </span>
          ) : saveState === 'saved' ? (
            <span className="inline-flex items-center gap-1 text-emerald-500">
              <Check className="h-3 w-3" aria-hidden />
              Guardado
            </span>
          ) : saveState === 'dirty' ? (
            <span className="text-amber-500">Sin guardar…</span>
          ) : saveState === 'error' ? (
            <span
              className="inline-flex items-center gap-1 text-red-500"
              title={error ?? undefined}
            >
              <AlertCircle className="h-3 w-3" aria-hidden />
              Error al guardar
            </span>
          ) : (
            <span className="text-muted-foreground">Listo</span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <input
            type="text"
            className="mb-4 w-full border-none bg-transparent text-3xl font-bold text-foreground outline-none disabled:opacity-60"
            value={title}
            onChange={handleTitleChange}
            placeholder="Título del documento"
            data-testid="doc-editor-title"
            disabled={readOnly}
          />
          {view === 'edit' ? (
            <textarea
              className="min-h-[60vh] w-full resize-none rounded border border-border bg-card/30 p-3 font-mono text-sm leading-relaxed text-foreground outline-none focus:border-primary disabled:opacity-60"
              value={content}
              onChange={handleContentChange}
              placeholder="# Empieza a escribir en markdown…"
              data-testid="doc-editor-textarea"
              disabled={readOnly}
              spellCheck={false}
            />
          ) : (
            <DocPreview content={content} />
          )}
          {/*
           * `docId` no se usa en el render pero se conserva en la firma
           * para que el padre pueda hacer key={docId} y forzar re-mount
           * limpio al cambiar de doc.
           */}
          <input type="hidden" value={docId} readOnly aria-hidden />
        </div>
      </div>
      </SoftLockProvider>

      {/* Wave P6 · B3 — ConflictDialog. */}
      <ConflictDialog
        open={lock.hasConflict}
        onOpenChange={(next) => {
          if (!next) lock.dismissConflict()
        }}
        fieldLabel="Documento"
        localValue={content}
        remoteValue={
          lock.remoteVersion
            ? `Versión remota guardada el ${lock.remoteVersion}`
            : 'Versión remota desconocida'
        }
        remoteAuthor={lock.remoteAuthorId ?? null}
        onResolve={handleResolveConflict}
      />
    </div>
  )
}
