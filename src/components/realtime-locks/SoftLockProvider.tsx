'use client'

/**
 * Wave P6 · Equipo A5 — `SoftLockProvider`.
 *
 * Context wrapper que un form/section usa para entrar en **modo solo lectura**
 * cuando otro peer está editando. Provee:
 *
 *   - `isLocked`: booleano consultable por hijos vía `useSoftLock()`.
 *   - `setReadOnly(value)`: imperativa para que el caller cambie el estado.
 *   - Un `<div>` envoltorio que aplica `aria-disabled="true"` y
 *     `pointer-events-none` cuando `isLocked` es true. Esto deshabilita
 *     visualmente todos los inputs hijos sin tener que tocar cada uno.
 *
 * Uso típico:
 *
 *     <SoftLockProvider isLocked={isLockedByOther && !overrideTaken}>
 *       <TaskDrawerForm ... />
 *     </SoftLockProvider>
 *
 * No es un *hard lock*: la BD sigue siendo last-write-wins. Cuando el peer
 * "fuerza edición" (`useEditPresence.forceOverride()`), `isLocked` debería
 * pasar a `false` por la página dueña.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { clsx } from 'clsx'

type SoftLockContextValue = {
  isLocked: boolean
  setReadOnly: (value: boolean) => void
}

const SoftLockContext = createContext<SoftLockContextValue | null>(null)

type Props = {
  /**
   * Estado controlado opcional. Si se pasa, el provider lo respeta y
   * `setReadOnly` actúa como callback hacia el caller.
   */
  isLocked?: boolean
  /** Callback opcional cuando el caller quiere observar cambios internos. */
  onReadOnlyChange?: (value: boolean) => void
  /** Estado inicial cuando se usa modo no-controlado. Default `false`. */
  defaultLocked?: boolean
  /** Clase opcional aplicada al `<div>` envoltorio. */
  className?: string
  /** Si `true`, no renderiza el `<div>` envoltorio (solo el context). */
  unwrap?: boolean
  children: ReactNode
}

export function SoftLockProvider({
  isLocked: controlledLocked,
  onReadOnlyChange,
  defaultLocked = false,
  className,
  unwrap = false,
  children,
}: Props) {
  const [internalLocked, setInternalLocked] = useState(defaultLocked)
  const isControlled = controlledLocked !== undefined
  const isLocked = isControlled ? controlledLocked : internalLocked

  const setReadOnly = useCallback(
    (value: boolean) => {
      if (!isControlled) setInternalLocked(value)
      onReadOnlyChange?.(value)
    },
    [isControlled, onReadOnlyChange],
  )

  const ctx = useMemo<SoftLockContextValue>(
    () => ({ isLocked, setReadOnly }),
    [isLocked, setReadOnly],
  )

  if (unwrap) {
    return (
      <SoftLockContext.Provider value={ctx}>{children}</SoftLockContext.Provider>
    )
  }

  return (
    <SoftLockContext.Provider value={ctx}>
      <div
        data-testid="soft-lock-region"
        data-locked={isLocked ? 'true' : 'false'}
        aria-disabled={isLocked || undefined}
        // Cuando el lock está activo, deshabilitamos pointer-events para que
        // ningún input hijo capture clicks. Bajamos opacidad como pista visual
        // sin sobrecargar (el banner ya comunica el estado).
        className={clsx(
          isLocked && 'pointer-events-none select-none opacity-70',
          className,
        )}
      >
        {children}
      </div>
    </SoftLockContext.Provider>
  )
}

/**
 * Hook para consumidores hijos. Retorna `{ isLocked: false, setReadOnly: noop }`
 * cuando no hay provider, lo que permite usar componentes en contextos sin
 * locks sin romper.
 */
export function useSoftLock(): SoftLockContextValue {
  const ctx = useContext(SoftLockContext)
  if (!ctx) {
    return {
      isLocked: false,
      setReadOnly: () => {
        /* no-op — sin provider, no hay lock que cambiar */
      },
    }
  }
  return ctx
}
