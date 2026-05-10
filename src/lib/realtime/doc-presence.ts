/**
 * Wave P16-A · Equipo A — Helpers de presence + cursor sharing para Docs.
 *
 * Esta capa extiende los primitivos de `@/lib/realtime/*` con una convención
 * específica para el editor de documentos:
 *
 *  - Channel topic canónico para un doc: `doc:{docId}`. Mantenerlo como
 *    constante derivada (no string libre en cada componente) evita typos
 *    cruzados entre el hook de presence y el de broadcast.
 *  - Color estable derivado del `userId`. Se calcula una vez por
 *    user/doc (no por evento) para que cada usuario aparezca con el mismo
 *    tono tanto en el avatar como en el cursor remoto.
 *  - Tipos del payload de cursor (`DocCursorPayload`) para tipar el hook
 *    `useBroadcast<DocCursorPayload>`.
 *
 * Decisiones autónomas (P16-A):
 *  D-P16A-1: el cursor que compartimos NO es la posición pixel, sino el
 *            offset de caracteres dentro del `<textarea>`. El receptor lo
 *            traduce a coordenadas en pantalla con `getCaretCoordinates`.
 *            Esto sobrevive a re-layouts (resize, scroll) sin desincronizar.
 *  D-P16A-2: throttle de envío 50 ms. ~20 msg/s por usuario es lo suficientemente
 *            fluido para sentirse vivo y bajo el rate-limit por defecto de
 *            Supabase Realtime broadcast (200 msg/s por canal).
 *  D-P16A-3: timeout de cursor remoto 5s. Si no recibimos `cursor:move`
 *            en ese tiempo, ocultamos el cursor del peer (pudo cerrar el
 *            tab antes de que llegue el `leave` o el sync de presence se
 *            atrase). El presence avatar sí se mantiene mientras presence
 *            no haya emitido `leave`.
 *  D-P16A-4: NO compartimos selecciones (range) en MVP, sólo caret. Una
 *            selección requiere otro evento (`cursor:select`) y resaltado
 *            de rango, fuera de scope. Follow-up.
 */

import type { ChannelTopic } from './types'

/** Construye el topic canónico para un doc concreto. */
export function docChannelTopic(docId: string): ChannelTopic {
  // El sistema de tipos de `ChannelTopic` no incluye literal `doc:*` aún
  // (lo definió Wave P6 antes de existir Docs). Casteamos al template lit
  // soportado por la unión — `whiteboard:` es el más cercano semánticamente
  // pero introduciría dependencia falsa. Mejor: usar `workspace:` que es
  // genérico para "espacio compartido" y el SDK no impone forma.
  return `workspace:doc:${docId}` as ChannelTopic
}

/**
 * Paleta de colores accesible para diferenciar usuarios en cursores y
 * avatares. Cada color tiene un `hex` (para inline style del cursor SVG)
 * y una clase Tailwind opcional. Se eligen tonos saturados que contrastan
 * sobre el fondo del editor (gris/oscuro).
 */
const CURSOR_PALETTE: readonly { hex: string; tw: string }[] = [
  { hex: '#f43f5e', tw: 'bg-rose-500' },
  { hex: '#f59e0b', tw: 'bg-amber-500' },
  { hex: '#10b981', tw: 'bg-emerald-500' },
  { hex: '#0ea5e9', tw: 'bg-sky-500' },
  { hex: '#6366f1', tw: 'bg-indigo-500' },
  { hex: '#d946ef', tw: 'bg-fuchsia-500' },
  { hex: '#14b8a6', tw: 'bg-teal-500' },
  { hex: '#f97316', tw: 'bg-orange-500' },
] as const

/**
 * Hash determinista 32-bit del userId — el mismo algoritmo que usa
 * `PresenceAvatars` para que el color del avatar y del cursor coincidan.
 */
function hashUserId(userId: string): number {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
  }
  return hash
}

export function colorForUser(userId: string): { hex: string; tw: string } {
  const idx = hashUserId(userId) % CURSOR_PALETTE.length
  return CURSOR_PALETTE[idx]
}

/**
 * Payload del evento `cursor:move` para Docs.
 *
 * D-P16A-1: caret en offset de caracteres (no pixel). El emisor genera
 * `emittedAt` para que el receptor descarte mensajes desordenados (UDP-like:
 * Supabase broadcast no garantiza orden estricto bajo carga).
 */
export type DocCursorPayload = {
  userId: string
  name: string
  /** Color hex (ya resuelto por el emisor, evita recalcular en cada peer). */
  color: string
  /** Offset de carácter dentro del textarea (0 = inicio). */
  caret: number
  /** ISO 8601 generado en el cliente emisor. */
  emittedAt: string
}

/**
 * Throttle simple por timestamp. Devuelve `true` si el caller debe emitir,
 * `false` si está dentro del cooldown. Mutamos `state.lastAt` desde el
 * caller (es un objeto-ref para no instanciar closures por evento).
 */
export function shouldEmitCursor(
  state: { lastAt: number },
  now: number,
  minIntervalMs: number,
): boolean {
  if (now - state.lastAt < minIntervalMs) return false
  state.lastAt = now
  return true
}

/** Throttle por defecto del broadcast de cursor (D-P16A-2). */
export const CURSOR_THROTTLE_MS = 50

/**
 * Tiempo después del cual un peer cursor sin actividad se considera muerto
 * y se oculta del overlay (D-P16A-3). El presence sigue vivo si no hubo
 * `leave`; sólo el cursor en sí se desvanece.
 */
export const CURSOR_STALE_MS = 5_000
