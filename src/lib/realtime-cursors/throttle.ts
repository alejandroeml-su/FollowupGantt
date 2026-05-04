/**
 * Throttle utilitario standalone para uso en hooks de cursores en vivo.
 *
 * Política aplicada (trailing-edge):
 *   1. La primera invocación se ejecuta inmediatamente (leading edge).
 *   2. Si llegan más invocaciones dentro de la ventana `ms`, se queda
 *      la última pendiente y se ejecuta exactamente al cumplirse el
 *      `ms` desde la última ejecución real.
 *   3. `cancel()` descarta la pendiente y resetea el reloj.
 *
 * Diseñado para mensajes broadcast: queremos enviar el primer movimiento
 * sin retraso (UX viva) y limitar la frecuencia subsiguiente, pero NO
 * perder la última posición (de lo contrario el cursor remoto se queda
 * "atrás" del puntero real al detenerse el ratón).
 */
export type ThrottledFn<TArgs extends unknown[]> = ((...args: TArgs) => void) & {
  cancel: () => void
  flush: () => void
}

export function throttle<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  ms: number,
): ThrottledFn<TArgs> {
  let lastCallAt = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingArgs: TArgs | null = null

  const invoke = (args: TArgs) => {
    lastCallAt = Date.now()
    pendingArgs = null
    fn(...args)
  }

  const throttled = ((...args: TArgs) => {
    const now = Date.now()
    const elapsed = now - lastCallAt

    // Primera llamada o ventana ya cumplida → ejecución inmediata.
    if (lastCallAt === 0 || elapsed >= ms) {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      invoke(args)
      return
    }

    // Dentro de la ventana → queda pendiente la última.
    pendingArgs = args
    if (timer) return
    const wait = ms - elapsed
    timer = setTimeout(() => {
      timer = null
      if (pendingArgs) invoke(pendingArgs)
    }, wait)
  }) as ThrottledFn<TArgs>

  throttled.cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    pendingArgs = null
    lastCallAt = 0
  }

  throttled.flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (pendingArgs) invoke(pendingArgs)
  }

  return throttled
}
