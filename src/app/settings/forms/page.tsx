/**
 * Ola P5 · Equipo P5-5 — Listado admin de formularios públicos.
 *
 * Server component que carga los PublicForm y delega el render al
 * FormsAdmin (client). Toggle, copy URL, navegación al editor.
 */

import { listForms } from '@/lib/actions/forms'
import { FormsAdmin } from '@/components/forms/FormsAdmin'

export const dynamic = 'force-dynamic'

export default async function SettingsFormsPage() {
  let forms: Awaited<ReturnType<typeof listForms>> = []
  try {
    forms = await listForms()
  } catch {
    forms = []
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8 bg-subtle/50">
        <div>
          <h1 className="text-xl font-semibold text-white">Formularios públicos</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Captura externa de tickets/requerimientos sin requerir cuenta.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl">
          <FormsAdmin
            initialForms={forms.map((f) => ({
              id: f.id,
              slug: f.slug,
              title: f.title,
              description: f.description,
              isActive: f.isActive,
              project: f.project,
              _count: f._count,
              createdAt: f.createdAt,
            }))}
          />
        </div>
      </div>
    </div>
  )
}
