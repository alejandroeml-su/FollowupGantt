import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * US-7.5 · Proofing — tests del ProofingCanvas.
 *
 * Cubren:
 *   - Click sobre el overlay setea coordenadas normalizadas en el popover
 *     (verificadas indirectamente porque al confirmar se llama onCreate
 *     con x/y en [0..1]).
 *   - Submit del popover llama onCreate.
 *   - Click sobre un marker existente dispara onSelectAnnotation y NO crea
 *     uno nuevo.
 *   - El filtro statusFilter oculta markers que no coincidan.
 */

import { ProofingCanvas } from '@/components/proofing/ProofingCanvas'
import type { ProofingAnnotationDTO } from '@/lib/actions/proofing'

function mkAnnotation(
  partial: Partial<ProofingAnnotationDTO> = {},
): ProofingAnnotationDTO {
  return {
    id: partial.id ?? 'a1',
    attachmentId: 'att1',
    attachmentVersionId: null,
    x: 0.25,
    y: 0.25,
    pageNumber: null,
    text: 'Demo',
    status: 'OPEN',
    parentAnnotationId: null,
    authorId: 'u1',
    authorName: 'User',
    resolvedAt: null,
    resolvedById: null,
    resolvedByName: null,
    createdAt: '2026-05-16T10:00:00.000Z',
    updatedAt: '2026-05-16T10:00:00.000Z',
    ...partial,
  }
}

// jsdom no calcula bounding rects realistas — los stubeamos para que el
// componente pueda traducir clientX/Y a coordenadas normalizadas.
function stubBoundingRect(width = 400, height = 400) {
  // Override SOLO en HTMLDivElement para no romper otros elementos.
  vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLDivElement) {
      return {
        width,
        height,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect
    },
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('<ProofingCanvas />', () => {
  it('renderiza el contenedor con data-status-filter', () => {
    render(
      <ProofingCanvas
        signedUrl="https://example.com/foo.png"
        mimeType="image/png"
        filename="foo.png"
        annotations={[]}
        onCreate={vi.fn()}
        statusFilter="OPEN"
      />,
    )
    const canvas = screen.getByTestId('proofing-canvas')
    expect(canvas).toBeInTheDocument()
    expect(canvas.getAttribute('data-status-filter')).toBe('OPEN')
  })

  it('click sobre el canvas abre el popover y normaliza las coordenadas', async () => {
    stubBoundingRect(400, 400)
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <ProofingCanvas
        signedUrl="https://example.com/foo.png"
        mimeType="image/png"
        filename="foo.png"
        annotations={[]}
        onCreate={onCreate}
      />,
    )

    const canvas = screen.getByTestId('proofing-canvas')
    // Click en (200, 100) sobre un canvas de 400x400 → (0.5, 0.25).
    fireEvent.click(canvas, { clientX: 200, clientY: 100 })

    const popover = await screen.findByTestId('proofing-canvas-popover')
    expect(popover).toBeInTheDocument()

    const input = screen.getByTestId(
      'proofing-canvas-popover-input',
    ) as HTMLTextAreaElement
    await user.type(input, 'Cambiar color')

    const submit = screen.getByTestId('proofing-canvas-popover-submit')
    await user.click(submit)

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledOnce()
    })
    const arg = onCreate.mock.calls[0][0] as {
      x: number
      y: number
      text: string
    }
    expect(arg.x).toBeCloseTo(0.5, 5)
    expect(arg.y).toBeCloseTo(0.25, 5)
    expect(arg.text).toBe('Cambiar color')
  })

  it('click sobre marker existente dispara onSelectAnnotation y NO abre popover', () => {
    stubBoundingRect(400, 400)
    const onSelect = vi.fn()
    const onCreate = vi.fn()
    render(
      <ProofingCanvas
        signedUrl="https://example.com/foo.png"
        mimeType="image/png"
        filename="foo.png"
        annotations={[mkAnnotation({ id: 'a1' })]}
        onCreate={onCreate}
        onSelectAnnotation={onSelect}
      />,
    )
    const marker = document.querySelector(
      '[data-proofing-marker][data-marker-id="a1"]',
    )!
    expect(marker).toBeTruthy()
    fireEvent.click(marker, { clientX: 100, clientY: 100 })

    expect(onSelect).toHaveBeenCalledWith('a1')
    expect(screen.queryByTestId('proofing-canvas-popover')).toBeNull()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('statusFilter=OPEN oculta markers en estado RESOLVED', () => {
    render(
      <ProofingCanvas
        signedUrl="https://example.com/foo.png"
        mimeType="image/png"
        filename="foo.png"
        annotations={[
          mkAnnotation({ id: 'a1', status: 'OPEN' }),
          mkAnnotation({ id: 'a2', status: 'RESOLVED' }),
        ]}
        onCreate={vi.fn()}
        statusFilter="OPEN"
      />,
    )
    expect(
      document.querySelector('[data-marker-id="a1"]'),
    ).toBeTruthy()
    expect(
      document.querySelector('[data-marker-id="a2"]'),
    ).toBeNull()
  })

  it('readOnly=true ignora clicks sobre el canvas', () => {
    stubBoundingRect(400, 400)
    const onCreate = vi.fn()
    render(
      <ProofingCanvas
        signedUrl="https://example.com/foo.png"
        mimeType="image/png"
        filename="foo.png"
        annotations={[]}
        onCreate={onCreate}
        readOnly
      />,
    )
    const canvas = screen.getByTestId('proofing-canvas')
    fireEvent.click(canvas, { clientX: 200, clientY: 200 })
    expect(screen.queryByTestId('proofing-canvas-popover')).toBeNull()
    expect(onCreate).not.toHaveBeenCalled()
  })
})
