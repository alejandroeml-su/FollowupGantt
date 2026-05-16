'use client'

/**
 * US-7.5 · Proofing (R4) — Canvas con overlay SVG para anotaciones ancladas.
 *
 * Responsabilidades:
 *   - Renderiza el asset (imagen via `<img>` o PDF página 1 via `<iframe>`).
 *   - Captura clicks → coordenadas normalizadas (x, y) ∈ [0..1] respecto al
 *     bounding-box del contenedor.
 *   - Pinta markers numerados (1, 2, 3…) ordenados por createdAt.
 *   - Muestra popover inline con el `<textarea>` para el comentario nuevo.
 *
 * Decisiones autónomas (D-PC-1 … D-PC-4):
 *   D-PC-1 · NO usamos `react-pdf` ni `pdfjs-dist` para el PDF. El navegador
 *            ya renderiza PDF nativo via `<iframe>` y el overlay SVG queda
 *            posicionado encima con z-index. Esto evita 200KB+ de bundle por
 *            una sola página. Multi-page se difiere a una próxima iteración.
 *   D-PC-2 · `pointer-events` se gobierna: el overlay captura clicks en zonas
 *            vacías para crear markers, pero los markers individuales tienen
 *            `pointer-events: auto` para abrir su propio popover.
 *   D-PC-3 · Para PDFs el iframe captura sus propios eventos (scroll/zoom
 *            internos del visor). Para crear una anotación el usuario debe
 *            clickear FUERA del PDF (sobre el overlay) — UX trade-off; con
 *            pdfjs-dist tendríamos click directo en el canvas. Documentado
 *            como deuda en el PR.
 *   D-PC-4 · Solo página 1 por ahora (`pageNumber` siempre NULL desde UI).
 */

import { useMemo, useRef, useState } from 'react'
import { CheckCircle2, Circle, AlertTriangle, Send, X } from 'lucide-react'
import type { ProofingAnnotationDTO } from '@/lib/actions/proofing'

export interface ProofingCanvasProps {
  /** URL firmada del asset (imagen o pdf). */
  signedUrl: string
  /** MIME type del asset (image/* o application/pdf). */
  mimeType: string | null
  /** Filename (alt text del img + title del iframe). */
  filename: string
  /** Anotaciones ya existentes (incluye replies; el overlay sólo pinta raíces). */
  annotations: ProofingAnnotationDTO[]
  /** Llama el server action al confirmar el comentario nuevo. */
  onCreate: (input: { x: number; y: number; text: string }) => Promise<void>
  /** Cuando hay un marker seleccionado, lo pintamos con halo. */
  selectedAnnotationId?: string | null
  /** Click sobre marker (informativo — el panel lateral lo aprovecha). */
  onSelectAnnotation?: (annotationId: string) => void
  /** Filtro aplicado para decidir qué markers renderizar. */
  statusFilter?: 'ALL' | 'OPEN' | 'RESOLVED' | 'CHANGES_REQUESTED'
  /** Cuando true, se deshabilita la creación de anotaciones (modo lectura). */
  readOnly?: boolean
}

type PendingMarker = {
  /** Coordenada normalizada [0..1]. */
  x: number
  y: number
  text: string
}

/**
 * Filtra anotaciones según el status del filtro activo. `ALL` o `undefined`
 * = no filtra. Siempre excluimos replies del overlay (los markers son por
 * "thread raíz").
 */
function filterAnnotations(
  list: ProofingAnnotationDTO[],
  filter: ProofingCanvasProps['statusFilter'],
): ProofingAnnotationDTO[] {
  const onlyRoots = list.filter((a) => a.parentAnnotationId === null)
  if (!filter || filter === 'ALL') return onlyRoots
  return onlyRoots.filter((a) => a.status === filter)
}

export function ProofingCanvas({
  signedUrl,
  mimeType,
  filename,
  annotations,
  onCreate,
  selectedAnnotationId = null,
  onSelectAnnotation,
  statusFilter = 'ALL',
  readOnly = false,
}: ProofingCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [pending, setPending] = useState<PendingMarker | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const visibleMarkers = useMemo(
    () => filterAnnotations(annotations, statusFilter),
    [annotations, statusFilter],
  )

  // Ordenamos por createdAt asc para que el N visible sea consistente entre
  // canvas y lista lateral (mismo orden de aparición).
  const numberedMarkers = useMemo(() => {
    return [...visibleMarkers]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((m, i) => ({ ...m, displayIndex: i + 1 }))
  }, [visibleMarkers])

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (readOnly) return
    // Si se hace click sobre un marker o sobre el popover de pending, no
    // creamos uno nuevo (el evento ya fue manejado por su handler).
    const target = e.target as HTMLElement
    if (target.closest('[data-proofing-marker]')) return
    if (target.closest('[data-proofing-popover]')) return
    if (!containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    if (x < 0 || x > 1 || y < 0 || y > 1) return
    setPending({ x, y, text: '' })
    setError(null)
  }

  async function handleSubmit() {
    if (!pending) return
    const text = pending.text.trim()
    if (!text) {
      setError('El comentario no puede estar vacío')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onCreate({ x: pending.x, y: pending.y, text })
      setPending(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar anotación')
    } finally {
      setSubmitting(false)
    }
  }

  function cancelPending() {
    setPending(null)
    setError(null)
  }

  const isImage = (mimeType ?? '').toLowerCase().startsWith('image/')
  const isPdf = (mimeType ?? '').toLowerCase() === 'application/pdf'

  return (
    <div
      ref={containerRef}
      data-testid="proofing-canvas"
      data-status-filter={statusFilter}
      className="relative w-full select-none overflow-hidden rounded border border-border bg-muted/10"
      onClick={handleOverlayClick}
      style={{ minHeight: 360 }}
    >
      {/* Asset layer */}
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          data-testid="proofing-canvas-image"
          src={signedUrl}
          alt={filename}
          draggable={false}
          className="block max-h-[640px] w-full object-contain"
        />
      ) : isPdf ? (
        <iframe
          data-testid="proofing-canvas-pdf"
          src={`${signedUrl}#page=1`}
          title={filename}
          className="block w-full"
          style={{ height: 640 }}
        />
      ) : (
        <div className="flex h-64 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          El tipo {mimeType ?? 'desconocido'} no soporta proofing visual.
        </div>
      )}

      {/* Overlay SVG con markers */}
      <svg
        data-testid="proofing-canvas-overlay"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="false"
        role="img"
        aria-label="Capa de anotaciones de proofing"
      >
        {numberedMarkers.map((m) => {
          const selected = m.id === selectedAnnotationId
          const cx = m.x * 100
          const cy = m.y * 100
          const StatusIcon =
            m.status === 'RESOLVED'
              ? CheckCircle2
              : m.status === 'CHANGES_REQUESTED'
                ? AlertTriangle
                : Circle
          return (
            <g
              key={m.id}
              data-proofing-marker
              data-status={m.status}
              data-marker-id={m.id}
              className="pointer-events-auto cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                onSelectAnnotation?.(m.id)
              }}
              aria-label={`Anotación ${m.displayIndex} — estado ${m.status}`}
            >
              {/* Halo cuando seleccionado */}
              {selected ? (
                <circle
                  cx={cx}
                  cy={cy}
                  r={4.2}
                  fill="rgba(59,130,246,0.25)"
                  stroke="rgba(59,130,246,0.7)"
                  strokeWidth={0.4}
                />
              ) : null}
              <circle
                cx={cx}
                cy={cy}
                r={2.4}
                fill={
                  m.status === 'RESOLVED'
                    ? '#16a34a'
                    : m.status === 'CHANGES_REQUESTED'
                      ? '#f59e0b'
                      : '#2563eb'
                }
                stroke="#ffffff"
                strokeWidth={0.5}
              />
              <text
                x={cx}
                y={cy + 0.9}
                textAnchor="middle"
                fontSize={2.2}
                fontWeight={600}
                fill="#ffffff"
                style={{ pointerEvents: 'none' }}
              >
                {m.displayIndex}
              </text>
              {/* Icono de estado oculto visualmente; el data-status sirve a tests */}
              <StatusIcon style={{ display: 'none' }} aria-hidden />
            </g>
          )
        })}

        {/* Marker pending (gris) */}
        {pending ? (
          <g data-testid="proofing-canvas-pending-marker">
            <circle
              cx={pending.x * 100}
              cy={pending.y * 100}
              r={2.4}
              fill="#94a3b8"
              stroke="#ffffff"
              strokeWidth={0.5}
            />
          </g>
        ) : null}
      </svg>

      {/* Popover de pending */}
      {pending ? (
        <div
          data-proofing-popover
          data-testid="proofing-canvas-popover"
          role="dialog"
          aria-label="Nuevo comentario"
          className="absolute z-10 w-72 rounded-md border border-border bg-background p-2 shadow-lg"
          // Posicionamos en coordenadas absolutas relativas al contenedor.
          // Clampeamos a 0..70% para que no se salga del borde derecho.
          style={{
            left: `${Math.min(pending.x * 100, 70)}%`,
            top: `${Math.min(pending.y * 100 + 3, 85)}%`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Nuevo comentario
            </span>
            <button
              type="button"
              aria-label="Cancelar"
              onClick={cancelPending}
              className="rounded p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </div>
          <textarea
            data-testid="proofing-canvas-popover-input"
            autoFocus
            value={pending.text}
            onChange={(e) =>
              setPending((p) => (p ? { ...p, text: e.target.value } : p))
            }
            className="h-20 w-full resize-none rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Describe el cambio…"
            disabled={submitting}
          />
          {error ? (
            <p
              role="alert"
              data-testid="proofing-canvas-popover-error"
              className="mt-1 text-xs text-destructive"
            >
              {error}
            </p>
          ) : null}
          <div className="mt-2 flex justify-end gap-1">
            <button
              type="button"
              onClick={cancelPending}
              disabled={submitting}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              data-testid="proofing-canvas-popover-submit"
              onClick={handleSubmit}
              disabled={submitting || pending.text.trim().length === 0}
              className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Send className="h-3 w-3" aria-hidden />
              {submitting ? 'Guardando…' : 'Comentar'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
