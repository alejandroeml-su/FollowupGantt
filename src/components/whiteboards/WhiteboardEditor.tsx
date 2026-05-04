'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Save, Loader2 } from 'lucide-react'
import {
  createElement,
  deleteElements,
  updateWhiteboardElements,
} from '@/lib/actions/whiteboards'
import { toast } from '@/components/interactions/Toaster'
import { defaultDataFor, defaultGeometry } from '@/lib/whiteboards/factories'
import { exportElementsToPng, downloadDataUrl } from '@/lib/whiteboards/export-png'
import type { WhiteboardElement } from '@/lib/whiteboards/types'
import { WhiteboardCanvas } from './WhiteboardCanvas'
import { WhiteboardToolbar, type ToolId, toolToElementType } from './WhiteboardToolbar'
import { SoftLockProvider } from '@/components/realtime-locks/SoftLockProvider'
import { EditingByBanner } from '@/components/realtime-locks/EditingByBanner'
import { ConflictDialog } from '@/components/realtime-locks/ConflictDialog'
import { useWhiteboardEditLock } from '@/components/realtime-locks/useWhiteboardEditLock'

type Props = {
  whiteboard: {
    id: string
    title: string
    description: string | null
    projectName: string | null
    /**
     * ISO `updatedAt` del whiteboard top-level. Wave P6 · B3 lo usa para
     * detectar conflictos via `useVersionCheck`. Opcional para no romper
     * callers existentes; si falta, conflict detection queda inactivo.
     */
    updatedAt?: string | null
  }
  initialElements: WhiteboardElement[]
  /**
   * Identidad del usuario activo. Wave P6 · B3: opcional. Sin currentUser
   * el editor renderiza igual pero sin presence ni conflict detection.
   */
  currentUser?: { id: string; name: string } | null
}

const AUTOSAVE_DEBOUNCE_MS = 500

export function WhiteboardEditor({
  whiteboard,
  initialElements,
  currentUser,
}: Props) {
  const [elements, setElements] = useState<WhiteboardElement[]>(initialElements)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTool, setActiveTool] = useState<ToolId | null>(null)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [panMode, setPanMode] = useState(false)
  const [savingState, setSavingState] = useState<'idle' | 'pending' | 'saving' | 'error'>('idle')

  // Wave P6 · B3 — Edit lock + conflict detection.
  const resolvedCurrentUser = useMemo(() => currentUser ?? null, [currentUser])
  const lock = useWhiteboardEditLock({
    whiteboardId: whiteboard.id,
    currentUser: resolvedCurrentUser,
    currentVersion: whiteboard.updatedAt ?? null,
  })

  // Lifecycle: marcar editing al montar; liberar al desmontar.
  useEffect(() => {
    if (!resolvedCurrentUser) return
    lock.startEditing()
    return () => {
      lock.stopEditing()
    }
    // Sólo dependemos del id de la entidad y del usuario. Re-suscribir el
    // lock por cada render rompería el heartbeat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whiteboard.id, resolvedCurrentUser?.id])

  // Resolución del conflicto: el editor autosalva por elemento. El caller
  // tiene tres salidas:
  //   - 'overwrite': descartamos el flag; los próximos autosaves siguen
  //     y la BD queda last-write-wins.
  //   - 'accept_remote': recargamos la página para descartar cambios
  //     locales y traer el estado remoto fresco.
  //   - 'cancel': cierra el dialog; el flag persiste.
  const handleResolveConflict = useCallback(
    (action: 'overwrite' | 'accept_remote' | 'cancel') => {
      if (action === 'overwrite') {
        lock.dismissConflict()
      } else if (action === 'accept_remote') {
        lock.dismissConflict()
        if (typeof window !== 'undefined') window.location.reload()
      }
    },
    [lock],
  )

  const pendingPatches = useRef<Map<string, { x?: number; y?: number; width?: number; height?: number }>>(
    new Map(),
  )
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Ref para que el listener global de teclado pueda invocar el handler
  // de borrado actualizado sin necesidad de re-suscribirse a cada cambio
  // de `selectedId`/`elements`. Cumple la regla "no useEffect→setState".
  const deleteSelectedRef = useRef<() => void>(() => {})

  const flushPatches = useCallback(async () => {
    if (pendingPatches.current.size === 0) return
    const batch = Array.from(pendingPatches.current.entries()).map(([id, p]) => ({ id, ...p }))
    pendingPatches.current.clear()
    setSavingState('saving')
    try {
      await updateWhiteboardElements(whiteboard.id, batch)
      setSavingState('idle')
    } catch (err) {
      setSavingState('error')
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    }
  }, [whiteboard.id])

  const scheduleAutosave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSavingState('pending')
    saveTimer.current = setTimeout(() => {
      void flushPatches()
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [flushPatches])

  const handleMove = useCallback(
    (id: string, next: { x: number; y: number }) => {
      setElements((prev) => prev.map((el) => (el.id === id ? { ...el, x: next.x, y: next.y } : el)))
      const existing = pendingPatches.current.get(id) ?? {}
      pendingPatches.current.set(id, { ...existing, x: next.x, y: next.y })
      scheduleAutosave()
    },
    [scheduleAutosave],
  )

  const handleCanvasClick = useCallback(
    async (worldPoint: { x: number; y: number }) => {
      if (!activeTool) {
        setSelectedId(null)
        return
      }
      const type = toolToElementType(activeTool)
      const geom = defaultGeometry(type)
      const data = activeTool.kind === 'SHAPE'
        ? { ...defaultDataFor(type), variant: activeTool.variant }
        : defaultDataFor(type)
      try {
        const created = await createElement({
          whiteboardId: whiteboard.id,
          type,
          x: worldPoint.x - geom.width / 2,
          y: worldPoint.y - geom.height / 2,
          width: geom.width,
          height: geom.height,
          rotation: 0,
          data,
        })
        // El server devuelve el elemento Prisma con `data` Json; normalizamos.
        const newEl: WhiteboardElement = {
          id: created.id,
          whiteboardId: created.whiteboardId,
          type: created.type,
          x: created.x,
          y: created.y,
          width: created.width,
          height: created.height,
          rotation: created.rotation,
          zIndex: created.zIndex,
          data: created.data as WhiteboardElement['data'],
        }
        setElements((prev) => [...prev, newEl])
        setSelectedId(newEl.id)
        // Tras insertar volvemos al modo "Seleccionar" — UX típica de Miro.
        setActiveTool(null)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al insertar elemento')
      }
    },
    [activeTool, whiteboard.id],
  )

  const handleDeleteSelected = useCallback(async () => {
    if (!selectedId) return
    const previous = elements
    setElements((prev) => prev.filter((el) => el.id !== selectedId))
    setSelectedId(null)
    try {
      await deleteElements(whiteboard.id, [selectedId])
    } catch (err) {
      // Rollback optimista
      setElements(previous)
      toast.error(err instanceof Error ? err.message : 'Error al eliminar')
    }
  }, [elements, selectedId, whiteboard.id])

  // Mantén la ref apuntando al handler vigente. Esto deja al listener
  // global de teclado independiente del ciclo de render: lo registramos
  // una sola vez (efecto vacío) y leemos `deleteSelectedRef.current`
  // dentro del callback nativo. Evita re-suscripciones costosas.
  useEffect(() => {
    deleteSelectedRef.current = () => {
      void handleDeleteSelected()
    }
  }, [handleDeleteSelected])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.code === 'Space') {
        e.preventDefault()
        setPanMode(true)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelectedRef.current()
      } else if (e.key === 'Escape') {
        setActiveTool(null)
        setSelectedId(null)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setPanMode(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  const handleExportPng = useCallback(() => {
    try {
      const dataUrl = exportElementsToPng(elements)
      const safe = whiteboard.title.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60) || 'pizarra'
      downloadDataUrl(dataUrl, `${safe}.png`)
      toast.success('PNG exportado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al exportar')
    }
  }, [elements, whiteboard.title])

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/whiteboards"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
            aria-label="Volver a pizarras"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-foreground">{whiteboard.title}</h1>
            {whiteboard.projectName && (
              <p className="truncate text-xs text-muted-foreground">{whiteboard.projectName}</p>
            )}
          </div>
        </div>
        <SaveIndicator state={savingState} />
      </header>

      {/* Wave P6 · B3 — banner de presencia. Sólo se muestra si hay otros
          peers editando (el componente devuelve null en otro caso). */}
      <div className="px-4 pt-2">
        <EditingByBanner
          editingUsers={lock.editingUsers}
          isLockedByOther={lock.isLockedByOther}
          onForceOverride={lock.forceOverride}
        />
      </div>

      {/* SoftLockProvider en modo `unwrap` — sólo proporciona contexto, no
          envuelve con div para no romper el flexbox del shell. La toolbar y
          el canvas reciben `aria-disabled` directamente cuando está locked. */}
      <SoftLockProvider isLocked={lock.isLockedByOther} unwrap>
        <div
          className={
            lock.isLockedByOther
              ? 'flex flex-1 flex-col pointer-events-none select-none opacity-70'
              : 'flex flex-1 flex-col'
          }
          data-testid="whiteboard-editor-region"
          data-locked={lock.isLockedByOther ? 'true' : 'false'}
          aria-disabled={lock.isLockedByOther || undefined}
        >
          <div className="flex items-center justify-center border-b border-border bg-subtle/30 px-4 py-2">
            <WhiteboardToolbar
              activeTool={activeTool}
              onSelectTool={setActiveTool}
              snapEnabled={snapEnabled}
              onToggleSnap={setSnapEnabled}
              onExportPng={handleExportPng}
            />
          </div>

          <div className="relative flex-1 overflow-hidden">
            <WhiteboardCanvas
              elements={elements}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMove={handleMove}
              onCanvasClick={handleCanvasClick}
              snapEnabled={snapEnabled}
              panMode={panMode}
            />
          </div>
        </div>
      </SoftLockProvider>

      {/* Wave P6 · B3 — ConflictDialog. Aparece en cuanto llega un UPDATE
          remoto más nuevo. Las pizarras autosalvan, así que mostramos esto
          como aviso post-hoc para que el usuario decida si seguir o
          recargar. */}
      <ConflictDialog
        open={lock.hasConflict}
        onOpenChange={(next) => {
          if (!next) lock.dismissConflict()
        }}
        fieldLabel="Pizarra"
        localValue={whiteboard.title}
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

function SaveIndicator({
  state,
}: {
  state: 'idle' | 'pending' | 'saving' | 'error'
}) {
  if (state === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Guardando…
      </span>
    )
  }
  if (state === 'pending') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-amber-400" aria-live="polite">
        <Save className="h-3.5 w-3.5" />
        Cambios pendientes
      </span>
    )
  }
  if (state === 'error') {
    return (
      <span className="text-xs text-red-400" role="alert">
        Error al guardar
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-emerald-400">
      <Save className="h-3.5 w-3.5" />
      Guardado
    </span>
  )
}
