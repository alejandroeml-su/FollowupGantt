import { PocGanttClient } from './PocGanttClient'

export const dynamic = 'force-static'

/**
 * Página privada de POC para validar visualmente la capa de dependencias
 * (Ola P0). No está enlazada en el sidebar y usa datos hardcoded —
 * 10 tareas + 5 dependencias FS — para reducir el alcance.
 *
 * Acceso: navegar manualmente a /poc-gantt.
 */
export default function PocGanttPage() {
  return (
    <div className="flex h-full flex-col bg-background p-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">
          POC · Capa de dependencias Gantt (Ola P0)
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          10 tareas hardcoded + 5 dependencias Finish-to-Start. Las flechas
          rojas marcan la ruta crítica calculada por el módulo CPM.
        </p>
      </header>
      <PocGanttClient />
    </div>
  )
}
