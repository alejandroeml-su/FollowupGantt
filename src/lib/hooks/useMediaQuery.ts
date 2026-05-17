'use client'

import { useEffect, useState } from 'react'

/**
 * Wave R5E · Mobile-first refinements (2026-05-17)
 *
 * Suscripción reactiva a `window.matchMedia(query)`. Lo usamos para
 * decidir en runtime si renderizar variantes mobile (bottom-sheet,
 * gestos swipe, FAB, gantt-week-mode). Tailwind ya permite estilar por
 * breakpoint, pero hay decisiones de DOM (no de CSS) que requieren
 * conocer el viewport actual desde React.
 *
 * SSR-safe: durante el render del servidor `window` no existe, así que
 * el valor inicial es `false`. El primer effect cliente sincroniza el
 * estado real. Si el caller necesita estabilidad en SSR (evitar
 * hydration mismatch al renderizar variantes incompatibles), debe
 * gatear la rama mobile con un `mounted` propio.
 *
 * Patrón de uso:
 *   const isMobile = useMediaQuery('(max-width: 767px)')
 *   const isCoarse = useMediaQuery('(pointer: coarse)')
 */
export function useMediaQuery(query: string): boolean {
  // Inicializa en `false` para evitar mismatch SSR/CSR. El primer
  // effect sincroniza al valor real.
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(query)
    // Sync inicial (puede diferir del default `false`). El lint plugin
    // `react-hooks/set-state-in-effect` advierte sobre setState directo
    // en effect bodies por cascadas innecesarias — aquí el setState es
    // necesario para sincronizar con el media query del DOM (api externa),
    // que es justamente el patrón excepción documentado por el regla.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMatches(mql.matches)

    // Compat: Safari < 14 expone `addListener`/`removeListener` (legacy).
    // El resto soporta `addEventListener('change', ...)`. Modern TS lib.dom
    // ya incluye ambos, así que no necesitamos suprimir tipos.
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }
    type LegacyMQL = MediaQueryList & {
      addListener: (listener: (e: MediaQueryListEvent) => void) => void
      removeListener: (listener: (e: MediaQueryListEvent) => void) => void
    }
    const legacy = mql as LegacyMQL
    legacy.addListener(onChange)
    return () => {
      legacy.removeListener(onChange)
    }
  }, [query])

  return matches
}

/**
 * Helper específico: ¿el dispositivo apunta principalmente con un
 * puntero "coarse" (dedo en pantalla táctil)? Lo usamos para activar
 * gestos swipe sólo en touch, evitando que un mouse-drag accidental
 * en desktop dispare "archivar" en un kanban card.
 */
export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)')
}

/**
 * Helper: viewport < md (768px). Coincide con el breakpoint Tailwind
 * `md`, que es el corte estándar mobile/tablet del proyecto.
 */
export function useIsMobileViewport(): boolean {
  return useMediaQuery('(max-width: 767px)')
}
