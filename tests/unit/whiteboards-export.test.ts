import { describe, it, expect, vi } from 'vitest'
import { exportElementsToPng, downloadDataUrl } from '@/lib/whiteboards/export-png'
import { defaultDataFor, defaultGeometry } from '@/lib/whiteboards/factories'
import type { WhiteboardElement } from '@/lib/whiteboards/types'

/**
 * jsdom no implementa el contexto 2D real; stubeamos `getContext` por
 * defecto para que `exportElementsToPng` no truene durante el render.
 */
function stubCanvasContext() {
  if (typeof HTMLCanvasElement === 'undefined') return
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    fillRect: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 50 })),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    ellipse: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    set font(_v: string) {},
    set textBaseline(_v: string) {},
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext

  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,STUB')
}

describe('whiteboards/factories', () => {
  it('defaultGeometry STICKY → 160x160', () => {
    expect(defaultGeometry('STICKY')).toEqual({ width: 160, height: 160 })
  })

  it('defaultGeometry CONNECTOR → 120x60', () => {
    expect(defaultGeometry('CONNECTOR')).toEqual({ width: 120, height: 60 })
  })

  it('defaultDataFor STICKY produce kind=sticky con color', () => {
    const d = defaultDataFor('STICKY') as { kind: string; color: string }
    expect(d.kind).toBe('sticky')
    expect(d.color).toMatch(/^#?[A-Za-z0-9]+$/)
  })

  it('defaultDataFor SHAPE produce variant=rectangle por defecto', () => {
    const d = defaultDataFor('SHAPE') as { kind: string; variant: string }
    expect(d.kind).toBe('shape')
    expect(d.variant).toBe('rectangle')
  })

  it('defaultDataFor TEXT incluye fontSize numérico', () => {
    const d = defaultDataFor('TEXT') as { fontSize: number }
    expect(typeof d.fontSize).toBe('number')
  })
})

describe('whiteboards/export-png', () => {
  it('exporta data URL PNG vía canvas stub', () => {
    stubCanvasContext()
    const els: WhiteboardElement[] = [
      {
        id: 'el-1',
        whiteboardId: 'wb-1',
        type: 'STICKY',
        x: 0,
        y: 0,
        width: 160,
        height: 160,
        rotation: 0,
        zIndex: 1,
        data: { kind: 'sticky', color: '#FEF08A', text: 'hola' },
      },
    ]
    const url = exportElementsToPng(els)
    expect(url).toMatch(/^data:image\/png/)
  })

  it('downloadDataUrl no lanza con DOM presente', () => {
    expect(() => downloadDataUrl('data:image/png;base64,xxx', 'test.png')).not.toThrow()
  })

  it('exporta vacío sin throw', () => {
    stubCanvasContext()
    const url = exportElementsToPng([])
    expect(url).toMatch(/^data:image\/png/)
  })
})
