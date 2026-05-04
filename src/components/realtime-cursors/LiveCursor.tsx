'use client'

import type { CSSProperties } from 'react'

type Props = {
  /** Posición x en píxeles relativos al contenedor padre. */
  x: number
  /** Posición y en píxeles relativos al contenedor padre. */
  y: number
  /** Nombre mostrado en la etiqueta debajo del cursor. */
  name: string
  /** Color hex (#rrggbb) para el cursor y la etiqueta. */
  color: string
  /**
   * userId de quien emite — sólo se usa para `data-user-id` (testing).
   * No es necesario para el render visual.
   */
  userId?: string
}

/**
 * Cursor remoto: SVG con forma de puntero clásico + etiqueta con el
 * nombre del usuario debajo. Se posiciona absolutamente y suaviza el
 * movimiento con una transición CSS muy corta (50 ms) — alineada con
 * el throttle del broadcast — para que el desplazamiento se vea fluido
 * en lugar de saltón.
 *
 * `pointer-events: none` para que NUNCA bloquee el mouse local.
 */
export function LiveCursor({ x, y, name, color, userId }: Props) {
  const style: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    transform: `translate3d(${x}px, ${y}px, 0)`,
    transition: 'transform 0.05s linear',
    pointerEvents: 'none',
    willChange: 'transform',
  }

  return (
    <div
      data-testid="live-cursor"
      data-user-id={userId}
      style={style}
      aria-hidden="true"
    >
      {/* SVG cursor — apuntando arriba-izquierda. 24x24 viewBox. */}
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: 'block', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))' }}
      >
        <path
          d="M4 2 L4 18 L9 14 L12 21 L15 19 L12 13 L19 13 Z"
          fill={color}
          stroke="white"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>

      {/* Etiqueta de nombre */}
      <span
        data-testid="live-cursor-label"
        style={{
          position: 'absolute',
          left: 18,
          top: 18,
          backgroundColor: color,
          color: 'white',
          fontSize: 11,
          fontWeight: 600,
          padding: '2px 6px',
          borderRadius: 4,
          whiteSpace: 'nowrap',
          maxWidth: 160,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          boxShadow: '0 1px 2px rgba(0,0,0,0.35)',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
        title={name}
      >
        {name}
      </span>
    </div>
  )
}
