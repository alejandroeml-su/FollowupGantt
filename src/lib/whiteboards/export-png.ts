/**
 * Ola P5 · Equipo P5-1 — Render simple de la pizarra a PNG vía Canvas
 * 2D nativo (sin librerías externas, requisito P5-1).
 *
 * Diseño:
 *   - El editor mantiene los elementos como objetos JS posicionados.
 *   - Para exportar PNG creamos un `<canvas>` off-screen del tamaño del
 *     `unionBounds` con padding, dibujamos cada elemento según su tipo y
 *     lo serializamos con `toDataURL('image/png')`.
 *
 * Esta función NO toca el DOM real (excepto crear el canvas off-screen);
 * por eso es testeable con jsdom (`HTMLCanvasElement` es stubeado por
 * `@testing-library/jest-dom`).
 */

import { unionBounds } from './geometry'
import type { WhiteboardElement } from './types'

const PADDING = 40

export type ExportPngOptions = {
  background?: string
  scale?: number
}

/**
 * Renderiza los elementos en un canvas off-screen y devuelve un dataURL
 * `image/png`. El consumidor puede usarlo para descargar (`<a download>`).
 */
export function exportElementsToPng(
  elements: WhiteboardElement[],
  options: ExportPngOptions = {},
): string {
  const scale = options.scale ?? 1
  const background = options.background ?? '#0f172a'

  const bounds = unionBounds(
    elements.map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height })),
  )
  const width = Math.max(1, Math.ceil((bounds.width + PADDING * 2) * scale))
  const height = Math.max(1, Math.ceil((bounds.height + PADDING * 2) * scale))

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? (new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement)
      : (typeof document !== 'undefined' ? document.createElement('canvas') : null)
  if (!canvas) {
    throw new Error('[EXPORT_FAILED] Canvas API no disponible en este entorno')
  }
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | null
  if (!ctx) {
    throw new Error('[EXPORT_FAILED] No se pudo obtener contexto 2D')
  }

  ctx.fillStyle = background
  ctx.fillRect(0, 0, width, height)
  ctx.scale(scale, scale)
  ctx.translate(PADDING - bounds.x, PADDING - bounds.y)

  for (const el of [...elements].sort((a, b) => a.zIndex - b.zIndex)) {
    drawElement(ctx, el)
  }

  // OffscreenCanvas no soporta toDataURL; HTMLCanvasElement sí. Usamos
  // typeof guard para ramificar.
  if (typeof (canvas as HTMLCanvasElement).toDataURL === 'function') {
    return (canvas as HTMLCanvasElement).toDataURL('image/png')
  }
  // Fallback (no usado en MVP — OffscreenCanvas requiere convertToBlob).
  throw new Error('[EXPORT_FAILED] toDataURL no disponible')
}

function drawElement(ctx: CanvasRenderingContext2D, el: WhiteboardElement): void {
  ctx.save()
  ctx.translate(el.x, el.y)
  if (el.rotation) {
    ctx.translate(el.width / 2, el.height / 2)
    ctx.rotate((el.rotation * Math.PI) / 180)
    ctx.translate(-el.width / 2, -el.height / 2)
  }
  switch (el.type) {
    case 'STICKY': {
      const data = el.data as { color: string; text: string }
      ctx.fillStyle = data.color
      ctx.fillRect(0, 0, el.width, el.height)
      ctx.fillStyle = '#0f172a'
      ctx.font = '14px sans-serif'
      ctx.textBaseline = 'top'
      wrapText(ctx, data.text ?? '', 8, 8, el.width - 16, 18)
      break
    }
    case 'SHAPE': {
      const data = el.data as { variant: string; fill: string; stroke: string; text?: string }
      ctx.fillStyle = data.fill
      ctx.strokeStyle = data.stroke
      ctx.lineWidth = 2
      if (data.variant === 'circle') {
        ctx.beginPath()
        ctx.ellipse(el.width / 2, el.height / 2, el.width / 2, el.height / 2, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      } else if (data.variant === 'triangle') {
        ctx.beginPath()
        ctx.moveTo(el.width / 2, 0)
        ctx.lineTo(0, el.height)
        ctx.lineTo(el.width, el.height)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      } else {
        ctx.fillRect(0, 0, el.width, el.height)
        ctx.strokeRect(0, 0, el.width, el.height)
      }
      if (data.text) {
        ctx.fillStyle = '#f8fafc'
        ctx.font = '14px sans-serif'
        wrapText(ctx, data.text, 8, 8, el.width - 16, 18)
      }
      break
    }
    case 'CONNECTOR': {
      const data = el.data as { points: { x: number; y: number }[]; stroke: string }
      ctx.strokeStyle = data.stroke
      ctx.lineWidth = 2
      ctx.beginPath()
      const [head, ...rest] = data.points
      if (head) {
        ctx.moveTo(head.x, head.y)
        for (const p of rest) ctx.lineTo(p.x, p.y)
      }
      ctx.stroke()
      break
    }
    case 'TEXT': {
      const data = el.data as { text: string; color: string; fontSize: number }
      ctx.fillStyle = data.color
      ctx.font = `${data.fontSize}px sans-serif`
      ctx.textBaseline = 'top'
      wrapText(ctx, data.text, 0, 0, el.width, data.fontSize * 1.2)
      break
    }
    case 'IMAGE': {
      // En MVP solo dibujamos el bbox; la imagen real requeriría
      // pre-cargar el `Image` y esperar `onload` (asincrónico). Lo dejamos
      // para iteración futura.
      ctx.fillStyle = '#1e293b'
      ctx.fillRect(0, 0, el.width, el.height)
      ctx.strokeStyle = '#475569'
      ctx.strokeRect(0, 0, el.width, el.height)
      ctx.fillStyle = '#94a3b8'
      ctx.font = '12px sans-serif'
      ctx.fillText('imagen', 8, 16)
      break
    }
  }
  ctx.restore()
}

/**
 * Ajusta texto a un ancho. Helper interno simple — split por palabras.
 * Suficiente para stickies del MVP.
 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = text.split(/\s+/)
  let line = ''
  let yy = y
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    const metrics = ctx.measureText(test)
    if (metrics.width > maxWidth && line) {
      ctx.fillText(line, x, yy)
      line = w
      yy += lineHeight
    } else {
      line = test
    }
  }
  if (line) ctx.fillText(line, x, yy)
}

/**
 * Helper para descargar el dataURL como archivo PNG. Separado del
 * renderer para poder testear `exportElementsToPng` sin tocar el DOM
 * de descarga.
 */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  if (typeof document === 'undefined') return
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
