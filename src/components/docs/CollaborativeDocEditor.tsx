'use client'

/**
 * R4-D · DocSpace + Real-time co-edit · Editor Tiptap + Yjs colaborativo.
 *
 * Reemplaza al textarea simple (`DocEditor.tsx`) con un editor rich-text
 * Tiptap conectado a un `Y.Doc` que se sincroniza vía
 * `SupabaseYjsProvider` (Supabase Realtime channel `doc:<id>`).
 *
 * Funcionalidades:
 *  - Edición concurrente convergente (Yjs CRDT)
 *  - Cursores remotos con `extension-collaboration-cursor`
 *  - Avatares de usuarios online en el header (awareness)
 *  - Persistencia debounced (2s tras idle o cada 10s mientras escribe)
 *  - Read-only opcional
 *  - Lazy-init desde markdown si el doc no tiene `contentYjs` aún
 *  - Indicador "Guardando..."
 *
 * Coexiste con `DocEditor.tsx` (markdown textarea). El padre elige cuál
 * montar — `CollaborativeDocEditor` se usa cuando hay co-edit habilitado
 * y `currentUser` presente.
 *
 * Notas React 19:
 *  - No `Date.now()` en render: timestamps van por handlers/efectos.
 *  - Refs se asignan dentro de efectos, no en cuerpo de componente.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { Check, Loader2, AlertCircle } from 'lucide-react'
import {
  SupabaseYjsProvider,
  type AwarenessUser,
} from '@/lib/realtime/yjs-provider'
import { colorForUser } from '@/lib/realtime/doc-presence'
import {
  saveDocYjsState,
  loadDocYjsState,
} from '@/lib/actions/docs-realtime'

type Props = {
  docId: string
  initialContent: string
  /**
   * Identidad para presence + cursor. Si null/undefined, el editor sigue
   * funcionando pero no broadcastea (modo "solo"). Sin Supabase env vars
   * el provider degrada a local-only automáticamente.
   */
  currentUser?: { userId: string; name: string } | null
  readOnly?: boolean
  /**
   * Callback opcional invocado tras cada persistencia. Permite al padre
   * actualizar caches o métricas.
   */
  onPersisted?: (sizeBytes: number) => void
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

const SAVE_DEBOUNCE_MS = 2_000
const SAVE_INTERVAL_MS = 10_000

export function CollaborativeDocEditor({
  docId,
  initialContent,
  currentUser,
  readOnly = false,
  onPersisted,
}: Props) {
  // Y.Doc + provider viven en refs/state para sobrevivir re-renders sin
  // re-instanciar el documento (eso reiniciaría el state CRDT).
  const [ydoc] = useState(() => new Y.Doc())
  const providerRef = useRef<SupabaseYjsProvider | null>(null)
  // El awareness adapter es un objeto stateful con su propio handle al
  // provider. Lo creamos una sola vez (lazy `useState`) y le inyectamos
  // el provider activo desde el effect via `attachProvider`. No usamos
  // el `providerRef` directamente desde el adapter (regla `react-hooks/refs`
  // prohíbe pasar refs como argumentos a funciones aun en closures).
  const [awarenessAdapter] = useState(() => createAwarenessAdapter())

  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [awarenessUsers, setAwarenessUsers] = useState<AwarenessUser[]>([])
  const [isHydrated, setIsHydrated] = useState(false)

  // Color estable del usuario actual (consistente con cursores Wave P16-A).
  const myColor = useMemo(
    () => (currentUser ? colorForUser(currentUser.userId).hex : '#0ea5e9'),
    [currentUser],
  )

  // ── Provider lifecycle: connect on mount, destroy on unmount.
  useEffect(() => {
    const provider = new SupabaseYjsProvider({
      doc: ydoc,
      channelName: `doc:${docId}`,
      identity: currentUser
        ? {
            userId: currentUser.userId,
            name: currentUser.name,
            color: myColor,
          }
        : null,
      onAwarenessChange: (users) => setAwarenessUsers(users),
    })
    providerRef.current = provider
    awarenessAdapter.attachProvider(provider)
    provider.connect()

    // Hidratar desde BD. Si hay contentYjs lo aplicamos; si no, dejamos
    // el doc vacío y el caller (initialContent) hará seed con markdown.
    let cancelled = false
    void loadDocYjsState(docId)
      .then((res) => {
        if (cancelled) return
        if (res.state) {
          provider.hydrateFromPersist(res.state)
        } else if (initialContent) {
          // Lazy-init: el documento legacy no tiene state Yjs.
          // Tiptap se encarga de poblar el Y.Doc desde el contenido inicial
          // de su prop `content` cuando montemos el editor.
        }
        setIsHydrated(true)
      })
      .catch(() => {
        // No es fatal — el editor monta vacío y el primer save creará state.
        setIsHydrated(true)
      })

    return () => {
      cancelled = true
      awarenessAdapter.detachProvider()
      provider.destroy()
      providerRef.current = null
    }
    // Sólo `docId` define el ciclo (el padre re-monta con key={docId}).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  // ── Tiptap editor.
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          // Collaboration extension provee su propio history (undo/redo)
          // basado en Yjs. Deshabilitamos el de StarterKit para evitar
          // conflictos.
          history: false,
        }),
        Collaboration.configure({ document: ydoc }),
        ...(currentUser
          ? [
              CollaborationCursor.configure({
                provider: {
                  // Tiptap CollaborationCursor espera un objeto compatible
                  // con y-protocols/awareness. Hacemos un adapter ligero
                  // sobre nuestro provider (no usamos awareness oficial
                  // porque el transport es Supabase Realtime, no WebSocket
                  // y-websocket).
                  awareness: awarenessAdapter,
                },
                user: {
                  name: currentUser.name,
                  color: myColor,
                },
              }),
            ]
          : []),
      ],
      content: initialContent || '',
      editable: !readOnly,
      // Configuración requerida en React 19 + Tiptap para evitar el warning
      // "Tiptap was rendered server-side" al inicio.
      immediatelyRender: false,
    },
    [docId, currentUser?.userId, readOnly],
  )

  // ── Cleanup del editor al desmontar.
  useEffect(() => {
    return () => {
      editor?.destroy()
    }
  }, [editor])

  // ── Persistencia debounced + max-interval.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedAtRef = useRef<number>(0)
  const dirtyRef = useRef<boolean>(false)

  const persist = useCallback(async () => {
    const provider = providerRef.current
    if (!provider) return
    setSaveState('saving')
    setErrorMsg(null)
    try {
      const state = provider.encodeStateForPersist()
      const markdown = editor?.getText() ?? undefined
      const res = await saveDocYjsState({ docId, state, markdown })
      lastSavedAtRef.current = Date.now()
      dirtyRef.current = false
      setSaveState('saved')
      onPersisted?.(res.sizeBytes)
    } catch (e) {
      setSaveState('error')
      setErrorMsg(e instanceof Error ? e.message : 'Error al guardar')
    }
  }, [docId, editor, onPersisted])

  useEffect(() => {
    if (!editor || readOnly) return
    const handleUpdate = () => {
      dirtyRef.current = true
      setSaveState('dirty')
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        void persist()
      }, SAVE_DEBOUNCE_MS)
    }
    editor.on('update', handleUpdate)
    return () => {
      editor.off('update', handleUpdate)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [editor, persist, readOnly])

  // Save-on-interval defensivo: si el usuario teclea sin parar > 10s,
  // forzamos un save para no perder demasiado en caso de crash.
  useEffect(() => {
    if (readOnly) return
    const i = setInterval(() => {
      const lastSaved = lastSavedAtRef.current
      const isDirty = dirtyRef.current
      if (!isDirty) return
      const nowMs = Date.now()
      if (nowMs - lastSaved >= SAVE_INTERVAL_MS) {
        void persist()
      }
    }, SAVE_INTERVAL_MS)
    return () => clearInterval(i)
  }, [persist, readOnly])

  // ───────────────────────── Render ─────────────────────────

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      data-testid="collaborative-doc-editor"
    >
      {/* Toolbar: avatares + estado de save */}
      <div className="flex h-12 items-center justify-between border-b border-border bg-card/40 px-4 shrink-0">
        <PresenceAvatars users={awarenessUsers} myUserId={currentUser?.userId ?? null} />
        <div
          className="flex items-center gap-2 text-[11px]"
          data-testid="cdoc-editor-status"
          aria-live="polite"
        >
          {readOnly ? (
            <span className="text-muted-foreground">Solo lectura</span>
          ) : !isHydrated ? (
            <span className="text-muted-foreground">Cargando…</span>
          ) : saveState === 'saving' ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Guardando…
            </span>
          ) : saveState === 'saved' ? (
            <span className="inline-flex items-center gap-1 text-emerald-500">
              <Check className="h-3 w-3" aria-hidden /> Guardado
            </span>
          ) : saveState === 'dirty' ? (
            <span className="text-amber-500">Sin guardar…</span>
          ) : saveState === 'error' ? (
            <span
              className="inline-flex items-center gap-1 text-red-500"
              title={errorMsg ?? undefined}
            >
              <AlertCircle className="h-3 w-3" aria-hidden /> Error
            </span>
          ) : (
            <span className="text-muted-foreground">Listo</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-6 py-6">
          {/*
           * EditorContent ya internamente maneja los listeners de Tiptap.
           * Con `Collaboration`, el state DOM se mantiene en sync con el
           * `Y.Doc` automáticamente.
           */}
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}

// ───────────────────────── Subcomponentes ─────────────────────────

function PresenceAvatars({
  users,
  myUserId,
}: {
  users: AwarenessUser[]
  myUserId: string | null
}) {
  if (users.length === 0) return <div />
  // Mostramos hasta 5 avatares + contador "+N" si excede.
  const visible = users.slice(0, 5)
  const overflow = users.length - visible.length
  return (
    <div
      className="flex items-center gap-1"
      role="list"
      aria-label={`${users.length} usuarios editando`}
    >
      {visible.map((u) => {
        const initial = (u.name || '?').trim().charAt(0).toUpperCase()
        const isMe = u.userId === myUserId
        return (
          <div
            key={u.userId}
            role="listitem"
            title={u.name + (isMe ? ' (tú)' : '')}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white shadow ring-1 ring-card"
            style={{ backgroundColor: u.color }}
            data-testid={`presence-avatar-${u.userId}`}
          >
            {initial}
          </div>
        )
      })}
      {overflow > 0 ? (
        <span className="ml-1 text-[10px] text-muted-foreground">
          +{overflow}
        </span>
      ) : null}
    </div>
  )
}

// ───────────────────────── Awareness adapter ─────────────────────────

/**
 * Adapter mínimo entre `SupabaseYjsProvider` y el shape que espera
 * `@tiptap/extension-collaboration-cursor` (compat con y-protocols
 * Awareness API). Sólo implementamos lo estrictamente necesario para que
 * Tiptap renderice cursores remotos: `setLocalStateField`, `getStates`,
 * `on('change', ...)`.
 *
 * Si en el futuro queremos awareness oficial (con metadatos enriquecidos),
 * podemos migrar a `y-protocols/awareness` y rutear sus binary messages
 * por la misma channel.
 */
/**
 * Adapter compatible con `y-protocols/awareness` API (subset que
 * `@tiptap/extension-collaboration-cursor` consume): expone
 * `setLocalStateField`, `getStates`, `on/off('change')`.
 *
 * Internamente lleva un handle al provider activo (asignado via
 * `attachProvider` desde el effect de mount) y polea su lista de
 * awareness cada 250 ms para reflejarla a Tiptap.
 */
type AwarenessAdapter = {
  setLocalStateField: (field: string, value: unknown) => void
  getStates: () => Map<number, Record<string, unknown>>
  on: (event: 'change', handler: () => void) => void
  off: (event: 'change', handler: () => void) => void
  clientID: number
  attachProvider: (p: SupabaseYjsProvider) => void
  detachProvider: () => void
}

let clientIdSeq = 1

function createAwarenessAdapter(): AwarenessAdapter {
  const clientID = clientIdSeq++
  const listeners = new Set<() => void>()
  const states = new Map<number, Record<string, unknown>>()
  const fromUserToClient = new Map<string, number>()
  let nextRemoteId = 1000
  let activeProvider: SupabaseYjsProvider | null = null
  let intervalId: ReturnType<typeof setInterval> | null = null

  function startPolling() {
    if (intervalId !== null) return
    intervalId = setInterval(() => {
      const provider = activeProvider
      if (!provider) return
      const users = provider.getAwarenessUsers()
      states.clear()
      for (const u of users) {
        let cid = fromUserToClient.get(u.userId)
        if (cid === undefined) {
          cid = ++nextRemoteId
          fromUserToClient.set(u.userId, cid)
        }
        states.set(cid, {
          user: { name: u.name, color: u.color },
          cursor: u.cursor,
          selection: u.selection,
        })
      }
      for (const cb of listeners) cb()
    }, 250)
  }

  function stopPolling() {
    if (intervalId !== null) {
      clearInterval(intervalId)
      intervalId = null
    }
  }

  return {
    clientID,
    setLocalStateField(field, value) {
      const provider = activeProvider
      if (!provider) return
      if (field === 'cursor') provider.setLocalCursor(value)
    },
    getStates() {
      return states
    },
    on(_event, handler) {
      listeners.add(handler)
      startPolling()
    },
    off(_event, handler) {
      listeners.delete(handler)
      if (listeners.size === 0) stopPolling()
    },
    attachProvider(p) {
      activeProvider = p
    },
    detachProvider() {
      activeProvider = null
      states.clear()
      stopPolling()
    },
  }
}
