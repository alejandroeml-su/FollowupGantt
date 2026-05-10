'use client'

/**
 * Wave P16-C · Equipo C — Tour interactivo de bienvenida.
 *
 * 5 pasos guiados con overlay tipo "driver.js" pero IMPLEMENTADO A MANO
 * (sin dependencias nuevas). Cada step puede:
 *   - resaltar un elemento DOM (vía `data-tour-target` o id),
 *   - mostrar un tooltip flotante anclado al elemento,
 *   - o renderizarse centrado (welcome / completed) sin anchor.
 *
 * Persistencia: `localStorage` con la key `sync.onboarding-tour-completed-v1`.
 * El versionado en la key permite re-disparar el tour cuando se agreguen
 * pasos nuevos en una futura wave (bump → `-v2`).
 *
 * Auto-trigger: si la key NO existe en localStorage, abrimos el tour la
 * primera vez que el componente se monte tras la hidratación. El usuario
 * puede saltarlo (Skip) o terminarlo; ambos casos persisten la key.
 *
 * Reiniciar: cualquier consumidor puede llamar `resetOnboardingTour()`
 * (helper exportado) para borrar la key y forzar el auto-trigger en la
 * próxima carga. La página `/settings/profile` expone ese botón.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useUIStore } from '@/lib/stores/ui'

const STORAGE_KEY = 'sync.onboarding-tour-completed-v1'

type Step = {
  id: string
  title: string
  body: string
  /**
   * Selector CSS o id (con o sin `#`) del elemento a resaltar. Si no se
   * encuentra, el step se renderiza centrado igual.
   */
  target?: string
  /** Posición del tooltip respecto al target. */
  placement?: 'right' | 'bottom' | 'left' | 'top' | 'center'
}

const STEPS: ReadonlyArray<Step> = [
  {
    id: 'welcome',
    title: 'Bienvenido a Sync',
    body: 'Plataforma PMI + Agile + ITIL para gestionar tus proyectos. Te guiamos en 5 pasos para que conozcas lo esencial.',
    placement: 'center',
  },
  {
    id: 'sidebar',
    title: 'Sidebar de navegación',
    body: 'Accede a Tareas, Gantt, Kanban, Portfolio, Agile y más. Los grupos colapsan para mantener el espacio limpio.',
    target: '[data-testid="sidebar-nav"]',
    placement: 'right',
  },
  {
    id: 'create-project',
    title: 'Crea tu primer proyecto',
    body: 'Desde la sección Proyectos puedes crear nuevos proyectos. Cada proyecto agrupa tareas, sprints y artefactos PMI.',
    target: '[data-tour-target="new-project"]',
    placement: 'bottom',
  },
  {
    id: 'brain',
    title: 'Avante Brain AI',
    body: 'Tu asistente IA para resumen ejecutivo, generación de WBS y análisis de riesgos. Pregúntale cualquier cosa sobre tu portafolio.',
    target: '[data-tour-target="brain-link"]',
    placement: 'right',
  },
  {
    id: 'profile',
    title: 'Configura tu perfil',
    body: 'Click en tu avatar para gestionar notificaciones push, idioma y preferencias personales.',
    target: '[data-tour-target="user-avatar"]',
    placement: 'right',
  },
] as const

const STEP_COUNT = STEPS.length

type Rect = {
  top: number
  left: number
  width: number
  height: number
}

function readCompleted(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return true
  }
}

function writeCompleted() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // localStorage puede fallar en modo privado; el tour seguirá saliendo
    // hasta que el usuario lo termine en una sesión normal — aceptable.
  }
}

/**
 * Helper exportado: borra la key del localStorage y abre el tour.
 * Usado por `<RestartTourButton>` en la página de perfil.
 */
export function resetOnboardingTour() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
  useUIStore.getState().toggleOnboardingTour(true)
}

export function OnboardingTour() {
  const open = useUIStore((s) => s.onboardingTourOpen)
  const toggle = useUIStore((s) => s.toggleOnboardingTour)
  const [stepIdx, setStepIdx] = useState(0)
  const [mounted, setMounted] = useState(false)
  const [rect, setRect] = useState<Rect | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)

  // ── Auto-trigger en primer mount cliente ───────────────────────────
  // Usamos un setState dentro del effect (mounted=true) porque la única
  // forma de detectar "montado en cliente" en Next.js (SSR) es esa.
  // El toggle del store pasa por el callback diferido (setTimeout),
  // por lo que NO dispara render cascada — el lint flaggea de todos
  // modos por la línea `setMounted(true)`. Justificación documentada,
  // disable explícito.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setMounted(true)
    if (!readCompleted()) {
      // Pequeño delay para que el sidebar haya hidratado y los selectores
      // de target funcionen. 600ms es suficiente para Next.js + Zustand
      // persist sin sentirse lag para el usuario.
      const t = setTimeout(() => {
        toggle(true)
        setStepIdx(0)
      }, 600)
      return () => clearTimeout(t)
    }
    return undefined
  }, [toggle])
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── Reset al cerrar (next time arranca en welcome) ─────────────────
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) setStepIdx(0)
  }, [open])
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── Track del rect del target actual ───────────────────────────────
  const step = STEPS[stepIdx]

  const computeRect = useCallback(() => {
    if (!step?.target) {
      setRect(null)
      return
    }
    if (typeof document === 'undefined') return
    const el = document.querySelector(step.target) as HTMLElement | null
    if (!el) {
      setRect(null)
      return
    }
    const r = el.getBoundingClientRect()
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
  }, [step])

  // Justificación: `computeRect()` actualiza `rect` (setState) desde
  // dentro del effect — este es el caso clásico de "sincronizar con un
  // sistema externo" (geometría DOM del target). El lint marca falso
  // positivo porque no detecta que el cómputo proviene del DOM y no de
  // estado de React.
  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    if (!open) return undefined
    computeRect()
    window.addEventListener('resize', computeRect)
    window.addEventListener('scroll', computeRect, true)
    // Re-medir periódicamente los primeros 2s (sidebar puede animar al
    // expandirse/colapsarse). Suficientemente barato para no afectar perf.
    const interval = setInterval(computeRect, 250)
    const stop = setTimeout(() => clearInterval(interval), 2000)
    return () => {
      window.removeEventListener('resize', computeRect)
      window.removeEventListener('scroll', computeRect, true)
      clearInterval(interval)
      clearTimeout(stop)
    }
  }, [open, computeRect])
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── Handlers ───────────────────────────────────────────────────────
  const finish = useCallback(() => {
    writeCompleted()
    toggle(false)
  }, [toggle])

  const next = useCallback(() => {
    if (stepIdx >= STEP_COUNT - 1) {
      finish()
      return
    }
    setStepIdx((i) => Math.min(STEP_COUNT - 1, i + 1))
  }, [stepIdx, finish])

  const prev = useCallback(() => {
    setStepIdx((i) => Math.max(0, i - 1))
  }, [])

  const skip = useCallback(() => {
    finish()
  }, [finish])

  // Cerrar con Escape
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skip()
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, skip, next, prev])

  if (!mounted || !open || typeof document === 'undefined') return null

  // ── Posicionamiento del tooltip ────────────────────────────────────
  // Calculamos top/left absolutos basados en `rect` y `placement`.
  // Para `center` o cuando no hay rect, centramos en viewport.
  const placement = step.placement ?? 'bottom'
  const PADDING = 12
  const TOOLTIP_W = 360
  const TOOLTIP_OFFSET = 16

  let tooltipStyle: React.CSSProperties
  if (!rect || placement === 'center') {
    tooltipStyle = {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    }
  } else {
    let top = rect.top
    let left = rect.left
    switch (placement) {
      case 'right':
        top = rect.top + rect.height / 2
        left = rect.left + rect.width + TOOLTIP_OFFSET
        tooltipStyle = { top, left, transform: 'translateY(-50%)' }
        break
      case 'left':
        top = rect.top + rect.height / 2
        left = rect.left - TOOLTIP_OFFSET
        tooltipStyle = { top, left, transform: 'translate(-100%, -50%)' }
        break
      case 'top':
        top = rect.top - TOOLTIP_OFFSET
        left = rect.left + rect.width / 2
        tooltipStyle = { top, left, transform: 'translate(-50%, -100%)' }
        break
      case 'bottom':
      default:
        top = rect.top + rect.height + TOOLTIP_OFFSET
        left = rect.left + rect.width / 2
        tooltipStyle = { top, left, transform: 'translateX(-50%)' }
        break
    }
  }

  // En mobile (<640) ignoramos placement y centramos en bottom para no
  // salirnos de pantalla.
  const isMobile =
    typeof window !== 'undefined' && window.innerWidth < 640
  if (isMobile) {
    tooltipStyle = {
      bottom: 16,
      left: 16,
      right: 16,
      maxWidth: 'calc(100vw - 32px)',
    }
  }

  return createPortal(
    <div
      data-testid="onboarding-tour-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-tour-title"
      className="fixed inset-0 z-[60] pointer-events-none"
    >
      {/* Backdrop con "hueco" (clip-path simulando highlight). Usamos un
          box-shadow gigante en el spotlight para oscurecer todo lo demás
          en lugar de SVG mask, así el spotlight respeta el border-radius
          del target real. */}
      {rect && placement !== 'center' ? (
        <div
          aria-hidden
          className="pointer-events-auto absolute rounded-lg ring-2 ring-primary transition-all duration-300"
          style={{
            top: rect.top - PADDING,
            left: rect.left - PADDING,
            width: rect.width + PADDING * 2,
            height: rect.height + PADDING * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
          }}
          onClick={skip}
        />
      ) : (
        <div
          aria-hidden
          className="pointer-events-auto absolute inset-0 bg-black/55"
          onClick={skip}
        />
      )}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        data-testid={`onboarding-tour-step-${step.id}`}
        className="pointer-events-auto absolute w-[min(92vw,360px)] rounded-2xl border border-border bg-card p-5 shadow-2xl"
        style={{ ...tooltipStyle, width: isMobile ? undefined : TOOLTIP_W }}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Sparkles className="h-4 w-4" aria-hidden />
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Paso {stepIdx + 1} de {STEP_COUNT}
            </span>
          </div>
          <button
            type="button"
            onClick={skip}
            aria-label="Saltar tour"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <h2
          id="onboarding-tour-title"
          className="text-base font-semibold text-foreground"
        >
          {step.title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {step.body}
        </p>

        {/* Progreso visual */}
        <div className="mt-4 flex items-center gap-1.5" aria-hidden>
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= stepIdx ? 'bg-primary' : 'bg-secondary'
              }`}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={skip}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Saltar
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={prev}
              disabled={stepIdx === 0}
              className="flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Atrás
            </button>
            <button
              type="button"
              onClick={next}
              data-testid="onboarding-tour-next"
              className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
            >
              {stepIdx === STEP_COUNT - 1 ? 'Terminar' : 'Siguiente'}
              {stepIdx < STEP_COUNT - 1 && (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
