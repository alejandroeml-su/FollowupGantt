/**
 * HU-04 (2026-05-14) · Reconocimiento de formas geométricas a partir
 * de un trazo a mano alzada.
 *
 * Algoritmo heurístico (sin ML — todo geometría plana):
 *
 *   1. Si el path está cerrado (start ≈ end) y aspect ratio ≈ 1 y la
 *      curvatura promedio es alta → círculo.
 *   2. Si el path simplificado tiene exactamente 4 vértices con ángulos
 *      ≈ 90° → cuadrado/rectángulo.
 *   3. Si el path simplificado tiene exactamente 3 vértices → triángulo.
 *   4. Si el path es abierto y los dos últimos segmentos forman una
 *      "punta" (ángulos pronunciados respecto al cuerpo principal) →
 *      flecha. NOTA: en esta fase MVP la flecha se aproxima a un
 *      conector lineal con head al último punto.
 *   5. Si nada matchea, devuelve null y el caller mantiene el FREEHAND.
 *
 * El caller (canvas) decide cuándo invocar el reconocedor: típicamente
 * al detectar "hold-on-release" (el usuario detuvo el cursor antes de
 * soltar el botón) — UX que coincide con Apple Freeform / Notion / Miro.
 */

import type { ShapeVariant } from './types'

type Point = { x: number; y: number }

export type RecognizedShape =
  | {
      variant: ShapeVariant
      bbox: { x: number; y: number; width: number; height: number }
    }
  | {
      variant: 'arrow'
      from: Point
      to: Point
    }

/**
 * Distancia euclidiana entre dos puntos.
 */
function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Bounding box mínimo del conjunto de puntos.
 */
function bbox(points: Point[]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Simplifica un path con Ramer–Douglas–Peucker. `epsilon` controla qué
 * tan agresiva es la reducción — más alto = menos vértices.
 */
function simplifyRDP(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points.slice()

  function perpDist(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x
    const dy = b.y - a.y
    if (dx === 0 && dy === 0) return distance(p, a)
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)
    const tClamped = Math.max(0, Math.min(1, t))
    const cx = a.x + tClamped * dx
    const cy = a.y + tClamped * dy
    return Math.hypot(p.x - cx, p.y - cy)
  }

  function rdp(idxA: number, idxB: number, out: number[]): void {
    let maxDist = 0
    let maxIdx = -1
    for (let i = idxA + 1; i < idxB; i++) {
      const d = perpDist(points[i], points[idxA], points[idxB])
      if (d > maxDist) {
        maxDist = d
        maxIdx = i
      }
    }
    if (maxDist > epsilon && maxIdx !== -1) {
      rdp(idxA, maxIdx, out)
      out.push(maxIdx)
      rdp(maxIdx, idxB, out)
    }
  }

  const keep: number[] = [0]
  rdp(0, points.length - 1, keep)
  keep.push(points.length - 1)
  // Dedup mantener orden
  const seen = new Set<number>()
  const result: Point[] = []
  for (const idx of keep) {
    if (seen.has(idx)) continue
    seen.add(idx)
    result.push(points[idx])
  }
  return result
}

/**
 * Ángulo (en grados) del vértice formado por `prev → vertex → next`.
 * 180° = colineal, 90° = recto, 0° = retroceso.
 */
function angleDeg(prev: Point, vertex: Point, next: Point): number {
  const ax = prev.x - vertex.x
  const ay = prev.y - vertex.y
  const bx = next.x - vertex.x
  const by = next.y - vertex.y
  const dot = ax * bx + ay * by
  const magA = Math.hypot(ax, ay)
  const magB = Math.hypot(bx, by)
  if (magA === 0 || magB === 0) return 180
  const cos = Math.max(-1, Math.min(1, dot / (magA * magB)))
  return (Math.acos(cos) * 180) / Math.PI
}

/**
 * Reconoce una forma geométrica a partir de un trazo libre.
 *
 * @param points puntos del trazo en coordenadas absolutas (no relativas)
 * @returns descripción de la forma reconocida o `null` si no hay match
 */
export function recognizeShape(points: Point[]): RecognizedShape | null {
  if (points.length < 8) return null // muy pocos puntos para inferir forma

  const b = bbox(points)
  const diag = Math.hypot(b.width, b.height)
  if (diag < 20) return null // trazo demasiado pequeño

  const startEndDist = distance(points[0], points[points.length - 1])
  const closed = startEndDist / diag < 0.2 // 20% de la diagonal → considerado cerrado

  // Simplificar con épsilon proporcional al tamaño (3% de la diagonal).
  const eps = diag * 0.03
  const simplified = simplifyRDP(points, eps)

  // ─── Círculo ──────────────────────────────────────────────────────
  // Heurística: cerrado + aspect ratio ≈ 1 + varianza baja de la
  // distancia de cada punto al centro del bbox respecto al radio promedio.
  if (closed) {
    const cx = b.x + b.width / 2
    const cy = b.y + b.height / 2
    const distances = points.map((p) => Math.hypot(p.x - cx, p.y - cy))
    const avgR = distances.reduce((a, c) => a + c, 0) / distances.length
    const variance =
      distances.reduce((a, d) => a + (d - avgR) ** 2, 0) / distances.length
    const stdDev = Math.sqrt(variance)
    const aspectRatio = b.width / Math.max(1, b.height)
    const aspectScore = Math.abs(aspectRatio - 1) // 0 si perfecto
    if (aspectScore < 0.35 && stdDev / avgR < 0.2) {
      return { variant: 'circle', bbox: b }
    }
  }

  // ─── Cuadrado/rectángulo ──────────────────────────────────────────
  // 4 vértices significativos con ángulos cerca de 90° (entre 65° y 115°).
  if (closed && simplified.length >= 4 && simplified.length <= 6) {
    // Tomar los 4 vértices con ángulos más cercanos a 90°.
    const innerVertices = simplified.slice(1, -1)
    const angles = innerVertices
      .map((v, i) => {
        const prev = simplified[i]
        const next = simplified[i + 2]
        return { i, deg: angleDeg(prev, v, next) }
      })
      .sort((a, b2) => Math.abs(a.deg - 90) - Math.abs(b2.deg - 90))
      .slice(0, 4)
    const allRight = angles.every((a) => Math.abs(a.deg - 90) < 25)
    if (angles.length === 4 && allRight) {
      return { variant: 'rectangle', bbox: b }
    }
  }

  // ─── Triángulo ────────────────────────────────────────────────────
  // Simplificado a 3 vértices (4 incluyendo start≈end si cerrado).
  if (
    closed &&
    (simplified.length === 4 || simplified.length === 3)
  ) {
    return { variant: 'triangle', bbox: b }
  }

  // ─── Flecha ───────────────────────────────────────────────────────
  // Path abierto + bbox alargado + último tramo forma "punta" pronunciada.
  if (!closed && simplified.length >= 3) {
    const last = simplified[simplified.length - 1]
    const prev = simplified[simplified.length - 2]
    const prevPrev = simplified[simplified.length - 3]
    const angle = angleDeg(prevPrev, prev, last)
    // Punta de flecha = ángulo agudo en el penúltimo vértice (entre 20° y 80°).
    if (angle > 20 && angle < 80) {
      return {
        variant: 'arrow',
        from: simplified[0],
        to: last,
      }
    }
  }

  return null
}
