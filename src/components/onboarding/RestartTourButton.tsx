'use client'

/**
 * Wave P16-C · Equipo C — Botón "Reiniciar tour" para `/settings/profile`.
 * Borra la key de localStorage y abre el tour inmediatamente.
 */

import { Sparkles } from 'lucide-react'
import { resetOnboardingTour } from './OnboardingTour'

export function RestartTourButton() {
  return (
    <button
      type="button"
      onClick={() => resetOnboardingTour()}
      data-testid="restart-tour-button"
      className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
    >
      <Sparkles className="h-4 w-4 text-primary" aria-hidden />
      Reiniciar tour
    </button>
  )
}
