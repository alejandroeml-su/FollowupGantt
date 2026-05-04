import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { throttle } from '@/lib/realtime-cursors/throttle'

describe('throttle (live-cursors)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('llama de inmediato a la primera invocación (leading edge)', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 50)
    throttled('a')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('a')
  })

  it('colapsa llamadas dentro de la ventana y emite la última al cumplirse ms', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 50)
    throttled(1)
    expect(fn).toHaveBeenCalledTimes(1)
    throttled(2)
    throttled(3)
    throttled(4)
    expect(fn).toHaveBeenCalledTimes(1) // todavía dentro de la ventana
    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith(4)
  })

  it('no programa más de un timer si llegan muchas llamadas seguidas', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 50)
    throttled(1)
    for (let i = 0; i < 10; i++) throttled(i)
    // Sólo 1 ejecución inmediata; ningún timer adicional la dispara antes de ms.
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(49)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith(9)
  })

  it('cancel() descarta llamada pendiente y resetea el reloj', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 50)
    throttled('a')
    throttled('b')
    throttled.cancel()
    vi.advanceTimersByTime(200)
    expect(fn).toHaveBeenCalledTimes(1) // sólo la inicial
    // Tras cancel, la siguiente vuelve a ser leading-edge inmediata.
    throttled('c')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith('c')
  })

  it('flush() ejecuta la pendiente sin esperar', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 100)
    throttled(1)
    throttled(2)
    throttled.flush()
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith(2)
  })

  it('respeta la ventana real y permite nueva ejecución leading tras esperar', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 50)
    throttled('a')
    vi.advanceTimersByTime(60)
    throttled('b')
    // Después de la ventana cumplida, "b" entra como leading sin esperar.
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith('b')
  })

  it('preserva los argumentos múltiples', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 50)
    throttled(10, 20)
    expect(fn).toHaveBeenCalledWith(10, 20)
    throttled(30, 40)
    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenLastCalledWith(30, 40)
  })

  it('flush() sin pendiente es no-op', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 50)
    throttled.flush()
    expect(fn).not.toHaveBeenCalled()
    throttled('x')
    expect(fn).toHaveBeenCalledTimes(1)
    throttled.flush() // no hay pendiente porque "x" se ejecutó leading
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
