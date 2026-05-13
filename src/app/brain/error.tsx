'use client'

/**
 * Brain AI · error boundary local.
 *
 * Reportado por Edwin 2026-05-13: la página /brain crasheaba con React
 * error #482 ("use() called with non-Promise") mostrando la pantalla
 * genérica de Next.js "This page couldn't load" — sin detalle del
 * componente fuente. Este error.tsx captura el fallo en el segmento
 * /brain, deja la app navegable, y muestra el stack para poder
 * diagnosticar la causa raíz sin recompilación.
 *
 * Convención Next.js 16:
 *   - 'use client' obligatorio.
 *   - Recibe `error` (Error con .digest opcional) y `reset` (función
 *     que vuelve a montar el árbol del segmento).
 *   - Errores en server actions disparados desde un client component
 *     NO caen aquí — usa try/catch local en el caller para esos.
 */

import { useEffect } from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'
import Link from 'next/link'

export default function BrainError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Loguea en consola del cliente con detalle expandido para que
    // DevTools (y la heurística de Chrome AI) tengan más contexto.
    // En producción los stacks vienen minificados; el `digest` es la
    // referencia opaca de Next.js para correlacionar con server logs.
    console.error('[brain] error caught by /brain/error.tsx', {
      message: error.message,
      stack: error.stack,
      digest: error.digest,
    })
  }, [error])

  return (
    <div className="flex h-full flex-col items-center justify-center bg-background px-8 text-center">
      <div className="mx-auto max-w-xl space-y-4">
        <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full border border-rose-500/40 bg-rose-500/10">
          <AlertTriangle className="h-7 w-7 text-rose-300" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">
          Avante Brain AI no se pudo cargar
        </h1>
        <p className="text-sm text-muted-foreground">
          Ocurrió un error al renderizar esta sección. La app sigue
          funcionando — usa el menú lateral para ir a otra pantalla.
        </p>
        {error.message && (
          <pre className="mx-auto max-w-full overflow-x-auto rounded-md border border-border bg-card p-3 text-left text-xs text-rose-200">
            {error.message}
            {error.digest ? `\n\ndigest: ${error.digest}` : ''}
          </pre>
        )}
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            <RefreshCw className="h-4 w-4" /> Reintentar
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary"
          >
            <Home className="h-4 w-4" /> Ir al Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
