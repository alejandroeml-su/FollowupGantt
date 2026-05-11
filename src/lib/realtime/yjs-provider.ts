'use client'

/**
 * R4-D · DocSpace + Real-time co-edit · Provider Yjs sobre Supabase Realtime.
 *
 * `SupabaseYjsProvider` conecta un `Y.Doc` (CRDT) a un Supabase Realtime
 * channel, usando `broadcast` para propagar updates entre peers y `presence`
 * para awareness (cursores, selecciones, identidad de cada usuario online).
 *
 * Diseño deliberado:
 *  - **CRDT (Yjs) > OT custom**: Yjs garantiza convergencia (todos los peers
 *    terminan con el mismo state independientemente del orden de los updates).
 *    Implementar OT correctamente requiere un servidor central que serialice;
 *    Yjs es peer-to-peer-friendly y encaja con el modelo "broadcast" de
 *    Supabase Realtime.
 *  - **Supabase Realtime como transport**: reusamos la infra ya desplegada
 *    en Wave P6 (`getBrowserClient`). No agregamos otro WebSocket.
 *  - **Updates binarios sobre base64**: `broadcast.payload` viaja como JSON;
 *    serializamos los `Uint8Array` que produce `Y.encodeStateAsUpdate` /
 *    `Y.applyUpdate` a base64 para travesarlo.
 *  - **No persiste**: la persistencia es responsabilidad del caller (server
 *    action `saveDocYjsState` / `saveWhiteboardYjsState`). Este provider
 *    sólo orquesta transporte + awareness.
 *  - **Initial sync**: al suscribirse, el provider envía un "syncStep1"
 *    (state vector) y los peers responden con un "syncStep2" (update con
 *    lo que falta). El primer cliente que entra a un room vacío no obtiene
 *    nada — depende del server para hidratar desde DB y aplicar `Y.applyUpdate`.
 *  - **Awareness via misma channel**: protocolo simplificado sobre `broadcast`
 *    para mantener un sólo channel por documento. Los hooks de cursor de
 *    Wave P16-A pueden coexistir en otro topic.
 *
 * No es un `y-websocket` provider completo (no maneja garbage collection
 * de updates antiguos, no firma mensajes). Es suficiente para co-edit MVP
 * dentro de una workspace privada.
 *
 * Convenciones:
 *  - Errores tipados `[R4D_YJS_*]` (ver `YjsProviderErrorCode`).
 *  - No usa `Date.now()` en render (sólo internamente en métodos de instancia
 *    invocados desde eventos / timers).
 */

import * as Y from 'yjs'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { getBrowserClient } from './supabase-client'

// ───────────────────────── Errores tipados ─────────────────────────

export type YjsProviderErrorCode =
  | 'R4D_YJS_NO_CLIENT'
  | 'R4D_YJS_NOT_CONNECTED'

// ───────────────────────── Tipos públicos ─────────────────────────

export type AwarenessUser = {
  /** Id del usuario (estable). */
  userId: string
  /** Nombre visible. */
  name: string
  /** Color hex (resuelto en cliente, p.ej. via `colorForUser`). */
  color: string
  /** Posición del cursor en formato libre (ej. caret offset o {x,y}). */
  cursor?: unknown
  /** Selección opcional (para editores con selección formal). */
  selection?: unknown
  /** Timestamp ISO de la última señal recibida. */
  lastSeenAt: string
}

export type SupabaseYjsProviderOptions = {
  /** El `Y.Doc` que se sincroniza. El caller lo construye + posee. */
  doc: Y.Doc
  /** Nombre del channel (ej. `doc:abc-123` o `whiteboard:xyz`). */
  channelName: string
  /** Identidad propia para awareness. Si null, no se publica presence. */
  identity?: { userId: string; name: string; color: string } | null
  /**
   * Override del cliente Supabase (tests). Si no se pasa, usa el singleton
   * compartido del navegador.
   */
  client?: SupabaseClient | null
  /** Callback cuando llega un update remoto aplicado. */
  onRemoteUpdate?: (update: Uint8Array, origin: unknown) => void
  /** Callback cuando cambia la lista de awareness users. */
  onAwarenessChange?: (users: AwarenessUser[]) => void
  /** Callback de cambio de status (conectado / desconectado). */
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected') => void
}

// ───────────────────────── Codificación binario⇄JSON ─────────────────────────

/**
 * Serializa `Uint8Array` a base64 ASCII. Supabase Realtime `broadcast.payload`
 * es JSON-encoded, así que necesitamos transportar bytes como string.
 *
 * Usa `Buffer` en Node (tests) y `btoa` en navegador. Mantenemos ambos sin
 * dependencia externa.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'))
  }
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ───────────────────────── Protocolo de mensajes ─────────────────────────

/**
 * Catálogo de mensajes que viajan en el channel. Usamos `event` distinto
 * por tipo para que el SDK los filtre nativamente sin parsear payload.
 */
const MSG_SYNC_STEP_1 = 'yjs:syncStep1' // state vector → peers
const MSG_SYNC_STEP_2 = 'yjs:syncStep2' // diff update ← peers
const MSG_UPDATE = 'yjs:update' // update incremental
const MSG_AWARENESS = 'yjs:awareness' // cursor/presence

type SyncStep1Payload = { senderId: string; sv: string /* base64 */ }
type SyncStep2Payload = { senderId: string; update: string /* base64 */ }
type UpdatePayload = { senderId: string; update: string /* base64 */ }
type AwarenessPayload = AwarenessUser & { senderId: string }

// ───────────────────────── Provider ─────────────────────────

/**
 * Provider singleton-por-channel: el caller crea uno por documento y lo
 * destruye al desmontar. Si se crean dos providers para el mismo channel,
 * cada uno mantiene su propia conexión — no comparten (es responsabilidad
 * del caller deduplicar).
 */
export class SupabaseYjsProvider {
  readonly doc: Y.Doc
  readonly channelName: string
  readonly identity: { userId: string; name: string; color: string } | null

  private client: SupabaseClient | null
  private channel: RealtimeChannel | null = null
  private connected = false
  /** Id efímero del cliente — distinto por instancia para filtrar eco. */
  private readonly localOrigin: symbol
  private readonly senderId: string
  /** Cache de awareness por userId. */
  private awareness = new Map<string, AwarenessUser>()
  /** Timestamp del último heartbeat de awareness emitido (ms). */
  private lastAwarenessEmitAt = 0

  private readonly onRemoteUpdate?: (
    update: Uint8Array,
    origin: unknown,
  ) => void
  private readonly onAwarenessChange?: (users: AwarenessUser[]) => void
  private readonly onStatusChange?: (
    status: 'connecting' | 'connected' | 'disconnected',
  ) => void

  /**
   * Handler bound del update local. Lo guardamos para poder hacer `off` en
   * `destroy`. Si no lo separamos, no podríamos desuscribir y filtraríamos
   * memory leak en tests rápidos.
   */
  private readonly handleLocalUpdate: (
    update: Uint8Array,
    origin: unknown,
  ) => void

  constructor(opts: SupabaseYjsProviderOptions) {
    this.doc = opts.doc
    this.channelName = opts.channelName
    this.identity = opts.identity ?? null
    this.client = opts.client !== undefined ? opts.client : getBrowserClient()
    this.onRemoteUpdate = opts.onRemoteUpdate
    this.onAwarenessChange = opts.onAwarenessChange
    this.onStatusChange = opts.onStatusChange
    this.localOrigin = Symbol('SupabaseYjsProvider.local')
    // senderId aleatorio por instancia. NO es el userId — un usuario puede
    // tener dos tabs abiertas y necesitamos distinguirlas para no aplicar
    // updates propios (eco).
    this.senderId = `${(this.identity?.userId ?? 'anon').slice(0, 8)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`

    this.handleLocalUpdate = (update: Uint8Array, origin: unknown) => {
      // Si el origin es nuestro mismo símbolo (lo asignamos al aplicar
      // updates remotos), no lo retransmitimos — evita loops infinitos.
      if (origin === this.localOrigin) return
      this.broadcastUpdate(update).catch(() => {
        // Swallow: el caller no necesita saber. El SDK reintenta WS solo.
      })
    }
  }

  // ───────────────────────── API pública ─────────────────────────

  /**
   * Conecta el provider al channel. Sub al `Y.Doc`. Idempotente: llamar dos
   * veces sin `destroy` entremedio es no-op.
   */
  connect(): void {
    if (this.channel) return
    if (!this.client) {
      // Realtime deshabilitado (env vars ausentes). El provider degrada a
      // local-only: las ediciones locales siguen mutando el `Y.Doc` y se
      // pueden persistir vía server actions, pero no se comparten en vivo.
      this.notifyStatus('disconnected')
      return
    }

    this.notifyStatus('connecting')
    this.doc.on('update', this.handleLocalUpdate)

    this.channel = this.client.channel(this.channelName, {
      config: { broadcast: { self: false, ack: false } },
    })

    this.channel
      .on('broadcast', { event: MSG_SYNC_STEP_1 }, (msg) => {
        const payload = msg.payload as SyncStep1Payload | undefined
        if (!payload || payload.senderId === this.senderId) return
        this.handleSyncStep1(payload)
      })
      .on('broadcast', { event: MSG_SYNC_STEP_2 }, (msg) => {
        const payload = msg.payload as SyncStep2Payload | undefined
        if (!payload || payload.senderId === this.senderId) return
        this.applyRemoteUpdate(base64ToBytes(payload.update))
      })
      .on('broadcast', { event: MSG_UPDATE }, (msg) => {
        const payload = msg.payload as UpdatePayload | undefined
        if (!payload || payload.senderId === this.senderId) return
        this.applyRemoteUpdate(base64ToBytes(payload.update))
      })
      .on('broadcast', { event: MSG_AWARENESS }, (msg) => {
        const payload = msg.payload as AwarenessPayload | undefined
        if (!payload || payload.senderId === this.senderId) return
        this.upsertAwareness(payload)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          this.connected = true
          this.notifyStatus('connected')
          // Inicia el sync handshake: anuncia mi state vector.
          void this.broadcastSyncStep1()
          // Anuncia mi awareness inmediatamente para que peers me vean.
          if (this.identity) this.broadcastAwareness()
        } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') {
          this.connected = false
          this.notifyStatus('disconnected')
        }
      })
  }

  /**
   * Aplica un update remoto al `Y.Doc` con origin propio para no retransmitirlo.
   * Expuesto para tests que simulan propagación sin ir a la red real.
   */
  applyRemoteUpdate(update: Uint8Array): void {
    Y.applyUpdate(this.doc, update, this.localOrigin)
    this.onRemoteUpdate?.(update, this.localOrigin)
  }

  /**
   * Emite cursor/selection propios al channel. Throttle suave: ignora
   * llamadas más rápidas que `minIntervalMs` (default 50ms).
   */
  setLocalCursor(cursor: unknown, selection?: unknown, minIntervalMs = 50): void {
    if (!this.identity) return
    const nowMs = this.now()
    if (nowMs - this.lastAwarenessEmitAt < minIntervalMs) return
    this.lastAwarenessEmitAt = nowMs
    this.broadcastAwareness(cursor, selection)
  }

  /**
   * Lista actual de usuarios online (incluye yo). Útil para renders sync;
   * para reactividad consumir `onAwarenessChange`.
   */
  getAwarenessUsers(): AwarenessUser[] {
    return Array.from(this.awareness.values())
  }

  isConnected(): boolean {
    return this.connected
  }

  /**
   * Helper: serializa el state completo del documento para persistir en BD.
   * El caller invoca este método y manda el `Uint8Array` a la server action.
   */
  encodeStateForPersist(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc)
  }

  /**
   * Hidrata el `Y.Doc` con un state previo cargado desde BD. Aplica el
   * update con origin propio para no retransmitirlo (otros peers también
   * lo cargaron desde BD).
   */
  hydrateFromPersist(state: Uint8Array): void {
    if (state.byteLength === 0) return
    Y.applyUpdate(this.doc, state, this.localOrigin)
  }

  /**
   * Desconecta y libera todos los listeners. Llamar en cleanup de React.
   */
  destroy(): void {
    this.doc.off('update', this.handleLocalUpdate)
    if (this.channel && this.client) {
      void this.client.removeChannel(this.channel)
    }
    this.channel = null
    this.connected = false
    this.awareness.clear()
    this.notifyStatus('disconnected')
  }

  // ───────────────────────── Internos ─────────────────────────

  /** `Date.now()` extraído como método para mockear en tests. */
  protected now(): number {
    return Date.now()
  }

  private async broadcastUpdate(update: Uint8Array): Promise<void> {
    if (!this.channel || !this.connected) return
    const payload: UpdatePayload = {
      senderId: this.senderId,
      update: bytesToBase64(update),
    }
    await this.channel.send({ type: 'broadcast', event: MSG_UPDATE, payload })
  }

  private async broadcastSyncStep1(): Promise<void> {
    if (!this.channel || !this.connected) return
    const sv = Y.encodeStateVector(this.doc)
    const payload: SyncStep1Payload = {
      senderId: this.senderId,
      sv: bytesToBase64(sv),
    }
    await this.channel.send({
      type: 'broadcast',
      event: MSG_SYNC_STEP_1,
      payload,
    })
  }

  private async handleSyncStep1(payload: SyncStep1Payload): Promise<void> {
    if (!this.channel || !this.connected) return
    // Calcula el diff que el peer no tiene.
    const remoteSv = base64ToBytes(payload.sv)
    const diff = Y.encodeStateAsUpdate(this.doc, remoteSv)
    const out: SyncStep2Payload = {
      senderId: this.senderId,
      update: bytesToBase64(diff),
    }
    await this.channel.send({
      type: 'broadcast',
      event: MSG_SYNC_STEP_2,
      payload: out,
    })
  }

  private upsertAwareness(payload: AwarenessPayload): void {
    const u: AwarenessUser = {
      userId: payload.userId,
      name: payload.name,
      color: payload.color,
      cursor: payload.cursor,
      selection: payload.selection,
      lastSeenAt: payload.lastSeenAt,
    }
    this.awareness.set(u.userId, u)
    this.onAwarenessChange?.(this.getAwarenessUsers())
  }

  private broadcastAwareness(cursor?: unknown, selection?: unknown): void {
    if (!this.channel || !this.connected || !this.identity) return
    const me: AwarenessPayload = {
      senderId: this.senderId,
      userId: this.identity.userId,
      name: this.identity.name,
      color: this.identity.color,
      cursor,
      selection,
      lastSeenAt: new Date(this.now()).toISOString(),
    }
    // Reflejamos localmente para que `getAwarenessUsers` incluya al usuario
    // local sin esperar al eco (que filtramos por senderId).
    this.awareness.set(me.userId, {
      userId: me.userId,
      name: me.name,
      color: me.color,
      cursor: me.cursor,
      selection: me.selection,
      lastSeenAt: me.lastSeenAt,
    })
    this.onAwarenessChange?.(this.getAwarenessUsers())
    void this.channel.send({
      type: 'broadcast',
      event: MSG_AWARENESS,
      payload: me,
    })
  }

  private notifyStatus(
    status: 'connecting' | 'connected' | 'disconnected',
  ): void {
    this.onStatusChange?.(status)
  }
}

// ───────────────────────── Helpers para tests ─────────────────────────

/**
 * Simula la propagación de un update entre dos providers en memoria
 * (sin Supabase). Útil para tests de convergencia CRDT donde no queremos
 * arrancar un WebSocket.
 */
export function relayUpdate(
  source: SupabaseYjsProvider,
  target: SupabaseYjsProvider,
  update: Uint8Array,
): void {
  // Marker para asegurar que no es el mismo origin que el local del target.
  if (source === target) return
  target.applyRemoteUpdate(update)
}
