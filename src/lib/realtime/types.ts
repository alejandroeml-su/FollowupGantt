/**
 * Tipos compartidos del módulo Realtime (Wave P6 · Equipo A1).
 *
 * Esta capa expone la nomenclatura "channel / presence / broadcast" del SDK
 * de Supabase pero abstrae detalles internos para que los hooks puedan
 * cambiar de provider en el futuro sin tocar componentes consumidores.
 */

// ──────────────────────────────────────────────────────────────────────────
// Channel naming
// ──────────────────────────────────────────────────────────────────────────

/**
 * Convención de nombres canónica para los topics. Mantenerla centralizada
 * evita typos cruzados entre equipos (A2 cursores, A3 chat, A4 whiteboard,
 * A5 notificaciones). Ver `docs/realtime/architecture.md`.
 */
export type ChannelTopic =
  | `project:${string}`
  | `task:${string}`
  | `whiteboard:${string}`
  | `workspace:${string}`
  | `user:${string}`

// ──────────────────────────────────────────────────────────────────────────
// Presence
// ──────────────────────────────────────────────────────────────────────────

/**
 * Estados visibles del usuario. `away` lo marca el cliente cuando el tab
 * pierde foco más de N segundos (lo decide cada vista, no este módulo).
 */
export type PresenceStatus = 'online' | 'away' | 'busy'

/**
 * Identidad pública mínima que se publica en el canal. NO incluir email,
 * teléfono o cualquier PII no destinada a ser visible. El nombre y avatar
 * SÍ son intencionalmente públicos (es la feature de "quién está viendo").
 */
export type PresenceUser = {
  userId: string
  name: string
  avatarUrl?: string
  status: PresenceStatus
  /** ISO 8601, lo setea el hook con `new Date().toISOString()`. */
  lastSeen: string
  /**
   * Color estable derivado del userId (calculado por la UI, no por el hook).
   * Lo dejamos opcional para que componentes que no necesiten color no
   * paguen el coste de calcularlo.
   */
  color?: string
}

/**
 * Identidad efímera con la que el hook `usePresence` arranca. El campo
 * `lastSeen` lo añade el hook, no el caller (single source of truth).
 */
export type PresenceIdentity = Omit<PresenceUser, 'lastSeen' | 'status'> & {
  status?: PresenceStatus
}

// ──────────────────────────────────────────────────────────────────────────
// Broadcast
// ──────────────────────────────────────────────────────────────────────────

/**
 * Catálogo de tipos de evento broadcast soportados oficialmente. Los
 * equipos pueden añadir más, pero registrarlos aquí evita colisiones de
 * nombres entre features.
 */
export type BroadcastEventType =
  | 'cursor:move'
  | 'cursor:click'
  | 'task:typing'
  | 'task:focus'
  | 'whiteboard:stroke'
  | 'chat:message'
  | 'notification:push'

/**
 * Sobre estándar. El payload concreto lo tipa el caller con un genérico
 * (e.g. `useBroadcast<CursorPayload>(...)`).
 */
export type BroadcastEvent<T = unknown> = {
  type: BroadcastEventType
  payload: T
  /** ISO 8601 generado por el remitente (no por el server). */
  emittedAt: string
  /** userId del emisor (para filtrar eco si self=true). */
  senderId?: string
}

// ──────────────────────────────────────────────────────────────────────────
// Hook return shapes
// ──────────────────────────────────────────────────────────────────────────

export type ChannelState = {
  /** El channel está suscrito y listo para enviar/recibir. */
  isReady: boolean
  /**
   * El SDK reporta conexión. Distinto de `isReady`: `isConnected=true` con
   * `isReady=false` indica que el WebSocket está vivo pero el channel
   * concreto aún no se subió (estado `joining`).
   */
  isConnected: boolean
  /** Último error capturado. Se limpia al re-suscribir. */
  error: Error | null
}

export type PresenceState = {
  users: PresenceUser[]
  /** Identidad propia ya enriquecida con `lastSeen`. */
  me: PresenceUser | null
  /** `true` cuando me he registrado (track) correctamente. */
  isOnline: boolean
}

export type BroadcastState<T> = {
  /** Buffer en memoria, máximo `BROADCAST_BUFFER_SIZE` mensajes. */
  messages: T[]
  /** Envía un mensaje. Resuelve cuando el server confirma o falla. */
  send: (payload: T) => Promise<void>
}

// ──────────────────────────────────────────────────────────────────────────
// Constantes operacionales
// ──────────────────────────────────────────────────────────────────────────

/** Heartbeat para refrescar `lastSeen` y mantener viva la sesión. */
export const PRESENCE_HEARTBEAT_MS = 30_000

/** Tamaño del buffer de mensajes broadcast en memoria. */
export const BROADCAST_BUFFER_SIZE = 50
