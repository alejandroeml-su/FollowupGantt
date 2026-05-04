import { describe, it, expect } from 'vitest'
import {
  validateElementData,
  elementPositionPatchSchema,
  titleSchema,
} from '@/lib/whiteboards/validators'

describe('whiteboards/validators · validateElementData', () => {
  it('STICKY válido pasa la validación', () => {
    const out = validateElementData('STICKY', {
      kind: 'sticky',
      color: '#FEF08A',
      text: 'hola',
    })
    expect(out).toMatchObject({ kind: 'sticky', color: '#FEF08A', text: 'hola' })
  })

  it('STICKY con color inválido lanza [INVALID_INPUT]', () => {
    expect(() =>
      validateElementData('STICKY', { kind: 'sticky', color: '!!!notacolor!!', text: '' }),
    ).toThrow(/\[INVALID_INPUT\] sticky data inválida/)
  })

  it('SHAPE con variant fuera del enum lanza error', () => {
    expect(() =>
      validateElementData('SHAPE', {
        kind: 'shape',
        variant: 'pentagon',
        fill: '#000',
        stroke: '#fff',
      }),
    ).toThrow(/\[INVALID_INPUT\] shape data inválida/)
  })

  it('SHAPE con variant válido pasa', () => {
    const out = validateElementData('SHAPE', {
      kind: 'shape',
      variant: 'circle',
      fill: '#1e293b',
      stroke: '#94a3b8',
    })
    expect(out).toMatchObject({ kind: 'shape', variant: 'circle' })
  })

  it('CONNECTOR acepta puntos vacíos pero rechaza no-arrays', () => {
    const ok = validateElementData('CONNECTOR', {
      kind: 'connector',
      fromId: null,
      toId: null,
      points: [],
      stroke: '#999',
    })
    expect(ok).toMatchObject({ kind: 'connector' })

    expect(() =>
      validateElementData('CONNECTOR', {
        kind: 'connector',
        fromId: null,
        toId: null,
        points: 'oops',
        stroke: '#999',
      }),
    ).toThrow(/\[INVALID_INPUT\]/)
  })

  it('TEXT respeta límites de fontSize', () => {
    expect(() =>
      validateElementData('TEXT', { kind: 'text', text: '', color: '#fff', fontSize: 200 }),
    ).toThrow(/\[INVALID_INPUT\]/)

    const ok = validateElementData('TEXT', { kind: 'text', text: 'hi', color: '#fff', fontSize: 18 })
    expect(ok).toMatchObject({ fontSize: 18 })
  })

  it('IMAGE rechaza URL inválida', () => {
    expect(() =>
      validateElementData('IMAGE', { kind: 'image', url: 'not-a-url', alt: '' }),
    ).toThrow(/\[INVALID_INPUT\]/)
  })

  it('elementPositionPatchSchema acepta patch parcial', () => {
    const r = elementPositionPatchSchema.safeParse({ id: 'el-1', x: 10 })
    expect(r.success).toBe(true)
  })

  it('elementPositionPatchSchema rechaza dimensiones extremas', () => {
    const r = elementPositionPatchSchema.safeParse({ id: 'el-1', width: 99999 })
    expect(r.success).toBe(false)
  })

  it('titleSchema rechaza vacío', () => {
    const r = titleSchema.safeParse('   ')
    expect(r.success).toBe(false)
  })

  it('titleSchema acepta título normal', () => {
    const r = titleSchema.safeParse('Pizarra Q3')
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toBe('Pizarra Q3')
  })
})
