'use client'

import { Printer } from 'lucide-react'

/**
 * Ola P5 · Equipo P5-3.
 *
 * Botón "Imprimir" que dispara `window.print()`. Tiene clase `no-print`
 * para que no aparezca en el PDF resultante. Diseñado para vivir dentro
 * de un `.report-toolbar`.
 */
export function PrintButton({ label = 'Imprimir' }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print"
      data-print-hide="true"
      aria-label={label}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
        <Printer size={14} aria-hidden />
        {label}
      </span>
    </button>
  )
}
