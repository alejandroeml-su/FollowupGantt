'use client'

/**
 * R4-D · Whiteboards · Real-time co-edit (Yjs hook)
 *
 * Hook que envuelve una pizarra (lista de `WhiteboardElement`) en un
 * `Y.Doc` con sincronización Supabase Realtime + persistencia debounced.
 *
 * Modelo:
 *   `ymap = Y.Map<elementId, Y.Map<field, value>>`
 *
 * Cada elemento es un `Y.Map` interno con `x/y/width/height/rotation/data/zIndex`
 * para que cambios en distintos campos converjan sin clobber (Yjs last-writer-
 * wins por field).
 *
 * Uso típico:
 *   ```tsx
 *   const { elements, moveElement, awareness, status } = useWhiteboardYjsCoEdit({
 *     whiteboardId, initialElements, currentUser,
 *   })
 *   <WhiteboardCanvas elements={elements} onMove={moveElement} … />
 *   ```
 *
 * Notas:
 *   - El hook NO desplaza la responsabilidad de validación zod del server
 *     action `setElementData` — al persistir, el caller reconcilia.
 *   - Para MVP, el ymap es la "vista en vivo" mientras hay peers
 *     conectados; al desmontar persistimos un snapshot.
 *   - Sin Supabase env vars el hook degrada a local-only: las mutaciones
 *     sólo afectan el ymap local pero no se broadcastean.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import {
  SupabaseYjsProvider,
  type AwarenessUser,
} from '@/lib/realtime/yjs-provider'
import { colorForUser } from '@/lib/realtime/doc-presence'
import {
  saveWhiteboardYjsState,
  loadWhiteboardYjsState,
} from '@/lib/actions/whiteboards-realtime'

/**
 * Forma simplificada del element usada por el hook. El caller hace el
 * mapping desde `PrismaWhiteboardElement` (que tiene FK + timestamps).
 */
export type CoEditElement = {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  zIndex: number
  data: unknown
}

type Options = {
  whiteboardId: string
  initialElements: CoEditElement[]
  currentUser?: { userId: string; name: string } | null
  /** Save debounce. Default 2s. */
  saveDebounceMs?: number
}

type Status = 'connecting' | 'connected' | 'disconnected'

export function useWhiteboardYjsCoEdit({
  whiteboardId,
  initialElements,
  currentUser,
  saveDebounceMs = 2_000,
}: Options) {
  const [ydoc] = useState(() => new Y.Doc())
  const providerRef = useRef<SupabaseYjsProvider | null>(null)
  const ymapRef = useRef<Y.Map<Y.Map<unknown>> | null>(null)

  const [elements, setElements] = useState<CoEditElement[]>(initialElements)
  const [awareness, setAwareness] = useState<AwarenessUser[]>([])
  const [status, setStatus] = useState<Status>('connecting')

  const myColor = useMemo(
    () => (currentUser ? colorForUser(currentUser.userId).hex : '#0ea5e9'),
    [currentUser],
  )

  // ── Reconstruye `elements[]` desde el ymap. Llamado tras cada update Yjs.
  const rebuild = useCallback((ymap: Y.Map<Y.Map<unknown>>) => {
    const out: CoEditElement[] = []
    ymap.forEach((inner) => {
      out.push({
        id: String(inner.get('id') ?? ''),
        type: String(inner.get('type') ?? 'SHAPE'),
        x: Number(inner.get('x') ?? 0),
        y: Number(inner.get('y') ?? 0),
        width: Number(inner.get('width') ?? 0),
        height: Number(inner.get('height') ?? 0),
        rotation: Number(inner.get('rotation') ?? 0),
        zIndex: Number(inner.get('zIndex') ?? 0),
        data: inner.get('data'),
      })
    })
    setElements(out)
  }, [])

  // ── Seed inicial del ymap si está vacío (primer co-edit).
  const seedFromInitial = useCallback(
    (ymap: Y.Map<Y.Map<unknown>>, items: CoEditElement[]) => {
      if (ymap.size > 0) return // ya hay state
      ydoc.transact(() => {
        for (const it of items) {
          const inner = new Y.Map<unknown>()
          inner.set('id', it.id)
          inner.set('type', it.type)
          inner.set('x', it.x)
          inner.set('y', it.y)
          inner.set('width', it.width)
          inner.set('height', it.height)
          inner.set('rotation', it.rotation)
          inner.set('zIndex', it.zIndex)
          inner.set('data', it.data)
          ymap.set(it.id, inner)
        }
      })
    },
    [ydoc],
  )

  // ── Lifecycle del provider.
  useEffect(() => {
    const ymap = ydoc.getMap<Y.Map<unknown>>('elements')
    ymapRef.current = ymap

    const provider = new SupabaseYjsProvider({
      doc: ydoc,
      channelName: `whiteboard:${whiteboardId}`,
      identity: currentUser
        ? {
            userId: currentUser.userId,
            name: currentUser.name,
            color: myColor,
          }
        : null,
      onAwarenessChange: (users) => setAwareness(users),
      onStatusChange: (s) => setStatus(s),
    })
    providerRef.current = provider
    provider.connect()

    // Listen para rebuilds reactivos.
    const observer = () => rebuild(ymap)
    ymap.observeDeep(observer)

    // Hidratar y/o seed.
    let cancelled = false
    void loadWhiteboardYjsState(whiteboardId)
      .then((res) => {
        if (cancelled) return
        if (res.state) {
          provider.hydrateFromPersist(res.state)
        } else {
          seedFromInitial(ymap, initialElements)
        }
        rebuild(ymap)
      })
      .catch(() => {
        if (cancelled) return
        // Fallback: seed local-only.
        seedFromInitial(ymap, initialElements)
        rebuild(ymap)
      })

    return () => {
      cancelled = true
      ymap.unobserveDeep(observer)
      provider.destroy()
      providerRef.current = null
      ymapRef.current = null
    }
    // El ciclo se ata únicamente a whiteboardId; cambios en initialElements
    // no deben reiniciar el provider (rompería el state CRDT).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whiteboardId])

  // ── Persistencia debounced.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistNow = useCallback(async () => {
    const provider = providerRef.current
    if (!provider) return
    try {
      const state = provider.encodeStateForPersist()
      await saveWhiteboardYjsState({ whiteboardId, state })
    } catch (e) {
      console.warn('[R4D] whiteboard persist failed', e)
    }
  }, [whiteboardId])

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      void persistNow()
    }, saveDebounceMs)
  }, [persistNow, saveDebounceMs])

  // ── API pública del hook.

  const moveElement = useCallback(
    (id: string, next: { x: number; y: number }) => {
      const ymap = ymapRef.current
      if (!ymap) return
      const inner = ymap.get(id)
      if (!inner) return
      ydoc.transact(() => {
        inner.set('x', next.x)
        inner.set('y', next.y)
      })
      scheduleSave()
    },
    [scheduleSave, ydoc],
  )

  const upsertElement = useCallback(
    (el: CoEditElement) => {
      const ymap = ymapRef.current
      if (!ymap) return
      ydoc.transact(() => {
        let inner = ymap.get(el.id)
        if (!inner) {
          inner = new Y.Map<unknown>()
          ymap.set(el.id, inner)
        }
        inner.set('id', el.id)
        inner.set('type', el.type)
        inner.set('x', el.x)
        inner.set('y', el.y)
        inner.set('width', el.width)
        inner.set('height', el.height)
        inner.set('rotation', el.rotation)
        inner.set('zIndex', el.zIndex)
        inner.set('data', el.data)
      })
      scheduleSave()
    },
    [scheduleSave, ydoc],
  )

  const deleteElement = useCallback(
    (id: string) => {
      const ymap = ymapRef.current
      if (!ymap) return
      if (!ymap.has(id)) return
      ydoc.transact(() => {
        ymap.delete(id)
      })
      scheduleSave()
    },
    [scheduleSave, ydoc],
  )

  // Emite cursor para awareness del whiteboard.
  const reportCursor = useCallback((point: { x: number; y: number }) => {
    providerRef.current?.setLocalCursor(point)
  }, [])

  return {
    elements,
    awareness,
    status,
    moveElement,
    upsertElement,
    deleteElement,
    reportCursor,
    /** Fuerza un save inmediato (e.g. botón "Guardar"). */
    saveNow: persistNow,
  }
}
