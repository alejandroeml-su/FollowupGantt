'use client'

/**
 * Wave P16-A · Equipo A — Overlay de cursores remotos sobre el textarea.
 *
 * Renderiza un cursor con el nombre del peer cada vez que recibimos un
 * `cursor:move` por broadcast. Cómo:
 *
 *  1. El emisor envía el `caret` como offset de carácter dentro del
 *     textarea (D-P16A-1) — robusto a resize/scroll.
 *  2. El overlay traduce ese offset a coordenadas (x, y) usando un "mirror
 *     div" que copia los estilos relevantes del textarea y mide la posición
 *     del último char con un `<span>` en su interior. Es la técnica estándar
 *     y ligera (sin `Selection` API que no funciona en textareas off-focus).
 *  3. Limpieza: si no hay `cursor:move` de un peer en `CURSOR_STALE_MS`,
 *     ocultamos su cursor (D-P16A-3) — su avatar sigue visible mientras
 *     presence no haya emitido `leave`.
 *
 * Notas:
 *  - El overlay vive en un wrapper `position: relative` del textarea. Los
 *    cursores son `position: absolute` sobre ese wrapper. NO bloqueamos
 *    el pointer (`pointer-events: none` en cada cursor) para que el usuario
 *    siga editando libremente debajo.
 *  - El receptor descarta su propio eco (`payload.userId === me.userId`)
 *    aunque `useBroadcast` ya pasa `self: false`.
 *  - El layout del editor cambia cuando se hace scroll dentro del textarea —
 *    re-medimos en `scroll` y `input` para que los cursores remotos se
 *    desplacen con el texto.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CURSOR_STALE_MS, type DocCursorPayload } from '@/lib/realtime/doc-presence'

type Props = {
  /** Ref viva al textarea cuyo caret estamos rastreando. */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  /** El último mensaje broadcast recibido (o `null` si aún no hay). */
  latest: DocCursorPayload | null
  /** userId del usuario actual — para descartar eco propio. */
  myUserId: string | null
}

type ResolvedCursor = DocCursorPayload & {
  /** Pixel-x relativo al wrapper del textarea. */
  x: number
  /** Pixel-y relativo al wrapper del textarea. */
  y: number
  /** Altura de línea — alto del cursor visual. */
  lineHeight: number
}

/** Estilos del textarea que el mirror debe replicar para medir igual. */
const MIRRORED_PROPS = [
  'boxSizing',
  'width',
  'height',
  'overflowX',
  'overflowY',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontSizeAdjust',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'textDecoration',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
] as const

/**
 * Mide la posición (x, y) del char en `caretOffset` dentro del textarea.
 * Implementación clásica del "mirror div": construimos un div invisible con
 * idéntico layout, replicamos el contenido hasta el caret y medimos el
 * bounding rect de un `<span>` final.
 *
 * Devuelve `null` si el textarea no está montado o si los estilos aún no
 * están disponibles.
 */
function measureCaret(
  textarea: HTMLTextAreaElement,
  caretOffset: number,
): { x: number; y: number; lineHeight: number } | null {
  const style = window.getComputedStyle(textarea)
  if (!style) return null

  const div = document.createElement('div')
  for (const prop of MIRRORED_PROPS) {
    // CSSStyleDeclaration es indexable por nombre; tipamos via cast para
    // evitar fricción con el tipo `string | number` del DOM.
    ;(div.style as unknown as Record<string, string>)[prop] = style[prop]
  }
  div.style.position = 'absolute'
  div.style.visibility = 'hidden'
  div.style.whiteSpace = 'pre-wrap'
  div.style.wordWrap = 'break-word'
  div.style.top = '0'
  div.style.left = '0'

  // Truncamos al máximo del valor para evitar fallos cuando el peer reporta
  // un offset mayor al contenido local (latencia, edits desincronizados).
  const value = textarea.value
  const safeOffset = Math.max(0, Math.min(caretOffset, value.length))
  const before = value.slice(0, safeOffset)

  // Sustituimos el espacio final por un nbsp para que el navegador no lo
  // colapse; sin esto el caret tras "hola " se ubica en columna 5 en vez de 6.
  const beforeNormalized =
    before.endsWith(' ') ? before.slice(0, -1) + ' ' : before
  div.textContent = beforeNormalized

  const marker = document.createElement('span')
  // El `​` (zero-width space) garantiza que el span ocupe una posición
  // medible incluso al final del contenido sin afectar al layout visible.
  marker.textContent = '​'
  div.appendChild(marker)

  document.body.appendChild(div)
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 16

  // Coordenadas del marker dentro del mirror.
  const localX = marker.offsetLeft
  const localY = marker.offsetTop

  document.body.removeChild(div)

  // Restamos el scroll del textarea para mover los cursores cuando el user
  // hace scroll vertical/horizontal dentro del editor.
  const x = localX - textarea.scrollLeft
  const y = localY - textarea.scrollTop

  return { x, y, lineHeight }
}

export default function DocCursorOverlay({ textareaRef, latest, myUserId }: Props) {
  // Mapa userId → último cursor (con coordenadas resueltas).
  const [cursors, setCursors] = useState<Record<string, ResolvedCursor>>({})

  // Buffer de los últimos payloads recibidos por usuario (raw, sin resolver
  // coordenadas). Lo separamos del estado renderizado para poder re-medir
  // en eventos de scroll/input sin volver a pasar por el broadcast.
  const rawByUserRef = useRef<Map<string, DocCursorPayload>>(new Map())

  const recompute = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    const next: Record<string, ResolvedCursor> = {}
    const now = Date.now()
    for (const [userId, p] of rawByUserRef.current.entries()) {
      const ts = Date.parse(p.emittedAt)
      if (Number.isFinite(ts) && now - ts > CURSOR_STALE_MS) continue
      const m = measureCaret(ta, p.caret)
      if (!m) continue
      next[userId] = { ...p, x: m.x, y: m.y, lineHeight: m.lineHeight }
    }
    setCursors(next)
  }, [textareaRef])

  // Cuando llega un payload nuevo, lo guardamos y re-medimos.
  useEffect(() => {
    if (!latest) return
    if (myUserId && latest.userId === myUserId) return // descarte de eco
    rawByUserRef.current.set(latest.userId, latest)
    recompute()
  }, [latest, myUserId, recompute])

  // Re-medir cuando el textarea hace scroll, recibe input o cambia tamaño.
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    const handler = () => recompute()
    ta.addEventListener('scroll', handler, { passive: true })
    ta.addEventListener('input', handler)
    window.addEventListener('resize', handler)
    return () => {
      ta.removeEventListener('scroll', handler)
      ta.removeEventListener('input', handler)
      window.removeEventListener('resize', handler)
    }
  }, [textareaRef, recompute])

  // GC periódico: limpia cursores stale aunque no llegue un payload nuevo.
  useEffect(() => {
    const id = setInterval(recompute, 1000)
    return () => clearInterval(id)
  }, [recompute])

  const list = useMemo(() => Object.values(cursors), [cursors])

  if (list.length === 0) return null

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
      data-testid="doc-cursor-overlay"
    >
      {list.map((c) => (
        <div
          key={c.userId}
          className="absolute will-change-transform"
          style={{
            transform: `translate(${c.x}px, ${c.y}px)`,
            transition: 'transform 80ms linear',
          }}
        >
          {/* Caret bar */}
          <div
            className="w-[2px] rounded-sm"
            style={{
              height: c.lineHeight,
              backgroundColor: c.color,
              boxShadow: `0 0 0 1px ${c.color}40`,
            }}
          />
          {/* Etiqueta con el nombre del peer */}
          <div
            className="absolute -top-[18px] left-0 whitespace-nowrap rounded px-1.5 py-[1px] text-[10px] font-semibold text-white shadow-sm"
            style={{ backgroundColor: c.color }}
          >
            {c.name}
          </div>
        </div>
      ))}
    </div>
  )
}
