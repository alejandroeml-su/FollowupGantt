/**
 * Wave P6 · Equipo A5 — tipos compartidos del sistema de soft-lock + presence.
 *
 * Convenciones:
 *   - `channelName` sigue el patrón `<entity>:<id>:edit` (ej. `task:42:edit`).
 *   - El payload de presencia se transmite con `{ user, isEditing, since }`.
 *   - Los broadcasts usan eventos namespaced (`lock:override_requested`).
 *   - Todo el stack degrada a no-op si Supabase Realtime no está disponible.
 */

/**
 * Identidad mínima del usuario participante en una sesión de edición.
 * Lo más liviano posible para que se transmita por presence sin coste.
 */
export type EditingUser = {
  id: string
  name: string
  /** URL/data-URI de avatar opcional (no requerido). */
  avatarUrl?: string | null
  /** Color asignable al usuario para UI (hex/oklch); opcional. */
  color?: string | null
}

/**
 * Metadata que cada cliente sincroniza en el canal de presence.
 * Se publica con `track()` y se relee a través de `presenceState()`.
 */
export type EditingPresenceMeta = {
  user: EditingUser
  /**
   * `true` cuando el usuario marcó intent-to-edit (abrió el form / campo).
   * Mientras está en `false` el cliente sigue presente pero solo "viendo".
   */
  isEditing: boolean
  /** ISO timestamp del momento en que comenzó a editar. */
  since: string
  /** Heartbeat más reciente (ISO). Se actualiza cada `heartbeatIntervalMs`. */
  heartbeatAt: string
}

/**
 * Resultado expuesto por `useEditPresence` a sus consumidores.
 * Pensado para alimentar `<EditingByBanner>` y para que la UI controle el
 * `<SoftLockProvider>`.
 */
export type EditPresenceState = {
  /** Otros usuarios actualmente editando (excluye al currentUser). */
  editingUsers: EditingUser[]
  /**
   * `true` cuando hay al menos un otro usuario con `isEditing=true` y
   * el usuario actual aún no tomó el control.
   */
  isLockedByOther: boolean
  /** `true` mientras el usuario actual mantiene el lock activo. */
  isCurrentUserEditing: boolean
  /** Marca al usuario actual como "editando" y arranca heartbeat. */
  startEditing: () => void
  /** Libera el lock del usuario actual y publica `isEditing=false`. */
  stopEditing: () => void
  /**
   * Toma el control aún cuando otros estén editando: emite broadcast
   * `lock:override_requested` y arranca el lock local.
   */
  forceOverride: () => void
  /** Indica si el canal Realtime está disponible y sincronizado. */
  isRealtimeAvailable: boolean
}

/** Eventos de broadcast que circulan en un canal `<entity>:<id>:edit`. */
export type EditChannelBroadcast =
  | {
      event: 'lock:override_requested'
      payload: { from: EditingUser; at: string }
    }
  | {
      event: 'lock:released'
      payload: { from: EditingUser; at: string }
    }

/** Opciones de configuración para `useEditPresence`. */
export type UseEditPresenceOptions = {
  /** Cada cuántos ms re-publicar `heartbeatAt`. Default 5000. */
  heartbeatIntervalMs?: number
  /**
   * Si un peer no actualiza heartbeat en este margen, se considera muerto y
   * se filtra de `editingUsers`. Default 30000.
   */
  staleAfterMs?: number
  /**
   * Hook opcional que se invoca cuando llega un broadcast
   * `lock:override_requested` desde otro peer. Útil para mostrar toast.
   */
  onOverrideRequested?: (from: EditingUser) => void
}

/**
 * Tipo de la entidad cuya versión rastrea `useVersionCheck`. Mantenemos un
 * literal-union explícito para aprovechar autocompletar y restringir typos.
 */
export type VersionCheckEntityType =
  | 'task'
  | 'whiteboard'
  | 'doc'
  | 'goal'
  | 'sprint'

/** Resultado expuesto por `useVersionCheck`. */
export type VersionCheckState = {
  /**
   * `true` cuando llegó un UPDATE remoto cuyo `updatedAt` es más reciente que
   * el `currentVersion` que conocemos. Implica que un peer guardó después de
   * que cargamos los datos.
   */
  hasConflict: boolean
  /**
   * Versión más reciente vista en el postgres_changes stream. `null` si nunca
   * llegó un UPDATE.
   */
  remoteVersion: string | null
  /**
   * Identidad opcional del peer que disparó el UPDATE remoto, si Supabase la
   * incluye en el payload (`payload.new.updatedById`).
   */
  remoteAuthorId: string | null
  /**
   * Limpia el flag de conflicto. Se llama tras resolver (overwrite/accept).
   */
  acknowledge: () => void
}

/** Acciones soportadas por `<ConflictDialog onResolve />`. */
export type ConflictResolution = 'overwrite' | 'accept_remote' | 'cancel'
