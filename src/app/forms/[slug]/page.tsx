/**
 * Ola P5 · Equipo P5-5 — Página pública del formulario `/forms/<slug>`.
 *
 * No requiere auth. Renderiza el shape del PublicForm. Si el form no existe
 * o está inactivo, muestra un mensaje neutral (no expone existencia para
 * dificultar enumeración de slugs por bots).
 */

import { notFound } from 'next/navigation'
import { getFormBySlug } from '@/lib/actions/forms'
import { safeParseFormSchema } from '@/lib/forms/schema'
import { PublicFormView } from '@/components/forms/PublicFormView'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function PublicFormPage({ params }: PageProps) {
  const { slug } = await params
  const form = await getFormBySlug(slug)

  if (!form || !form.isActive) {
    notFound()
  }

  const parsed = safeParseFormSchema(form.schema)
  if (!parsed.success) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-xl w-full rounded-xl border border-border bg-card p-8 text-center">
          <h1 className="text-xl font-semibold text-white">Formulario no disponible</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Hay un problema con la configuración del formulario. Contacta al administrador.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-2xl w-full">
        <PublicFormView
          slug={form.slug}
          title={form.title}
          description={form.description}
          fields={parsed.data}
        />
        <p className="mt-4 text-center text-xs text-muted-foreground/70">
          Formulario público · FollowupGantt
        </p>
      </div>
    </main>
  )
}
