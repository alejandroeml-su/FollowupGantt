import { Presentation, AlertTriangle, Database } from 'lucide-react'
import prisma from '@/lib/prisma'
import { WhiteboardListClient } from '@/components/whiteboards/WhiteboardListClient'
import { getWhiteboardList } from '@/lib/actions/whiteboards'
import type { WhiteboardListItem } from '@/lib/whiteboards/types'

export const dynamic = 'force-dynamic'

/**
 * Ola P5 · Equipo P5-1 — `/whiteboards` (server component).
 *
 * Carga defensiva: si la migración aún no se aplicó en la BD (ej. tras
 * merge sin db push) mostramos un banner de setup en lugar de tumbar la
 * página, igual que `/mindmaps`.
 */
export default async function WhiteboardsPage() {
  let whiteboards: WhiteboardListItem[] = []
  let projects: { id: string; name: string }[] = []
  try {
    const [wbs, prjs] = await Promise.all([
      getWhiteboardList(),
      prisma.project.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ])
    whiteboards = wbs
    projects = prjs
  } catch (err) {
    return <SetupPending error={err instanceof Error ? err.message : 'Error desconocido'} />
  }

  return (
    <div className="p-8 space-y-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Presentation className="h-6 w-6 text-primary" />
            Pizarras
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Espacios colaborativos visuales con sticky notes, formas, conectores y zoom infinito.
          </p>
        </div>
      </header>

      <WhiteboardListClient whiteboards={whiteboards} projects={projects} />
    </div>
  )
}

function SetupPending({ error }: { error: string }) {
  const isMissingTable = /does not exist|relation .* does not exist|P2021|UNAUTHORIZED/i.test(error)
  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Presentation className="h-6 w-6 text-primary" />
          Pizarras
        </h1>
      </header>

      <div className="rounded-2xl border-2 border-dashed border-amber-500/40 bg-amber-500/5 p-8 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-6 w-6 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-base font-semibold text-foreground">
              Módulo pendiente de configuración
            </p>
            <p className="text-sm text-muted-foreground">
              {isMissingTable ? (
                <>
                  Las tablas <code>Whiteboard</code> y <code>WhiteboardElement</code> aún no
                  existen en la base de datos, o no hay sesión activa. Aplica la migración o
                  inicia sesión para continuar.
                </>
              ) : (
                <>No se pudo conectar con la base de datos para cargar las pizarras.</>
              )}
            </p>
          </div>
        </div>

        {isMissingTable && (
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-primary" />
              Para resolverlo (administrador)
            </p>
            <ol className="list-decimal pl-5 space-y-1 text-xs text-muted-foreground">
              <li>
                Aplicar la migración SQL en Supabase:
                <code className="ml-1 block bg-background border border-border rounded px-2 py-1 mt-1 text-foreground/90 font-mono">
                  prisma/migrations/20260503_whiteboards/migration.sql
                </code>
              </li>
              <li>
                O ejecutar <code className="font-mono">npx prisma db push</code> apuntando a la BD
                de producción.
              </li>
              <li>Recargar esta página.</li>
            </ol>
          </div>
        )}

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">Detalle técnico</summary>
          <pre className="mt-2 bg-card border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
            {error}
          </pre>
        </details>
      </div>
    </div>
  )
}
