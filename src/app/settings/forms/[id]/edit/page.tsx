/**
 * Ola P5 · Equipo P5-5 — Editor de un PublicForm.
 *
 * Carga el form por id, parsea su schema y monta el editor cliente.
 */

import { notFound } from 'next/navigation'
import { getFormById, listFormSubmissions } from '@/lib/actions/forms'
import { safeParseFormSchema } from '@/lib/forms/schema'
import { FormSchemaEditor } from '@/components/forms/FormSchemaEditor'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditFormPage({ params }: PageProps) {
  const { id } = await params
  let form: Awaited<ReturnType<typeof getFormById>> | null = null
  try {
    form = await getFormById(id)
  } catch {
    notFound()
  }
  if (!form) notFound()

  const parsed = safeParseFormSchema(form.schema)
  const fields = parsed.success ? parsed.data : []
  let submissionsCount = 0
  try {
    const subs = await listFormSubmissions(form.id)
    submissionsCount = subs.length
  } catch {
    submissionsCount = 0
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8 bg-subtle/50">
        <div>
          <h1 className="text-xl font-semibold text-white">
            Editar formulario · {form.title}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            URL pública: <code className="font-mono">/forms/{form.slug}</code> ·{' '}
            {submissionsCount} ejecuciones
          </p>
        </div>
        <a
          href={`/forms/${form.slug}`}
          target="_blank"
          rel="noopener"
          className="rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-secondary"
        >
          Ver formulario público
        </a>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl">
          <FormSchemaEditor
            formId={form.id}
            initialTitle={form.title}
            initialDescription={form.description}
            initialFields={fields}
            initialTemplate={form.targetTaskTitleTemplate}
          />
        </div>
      </div>
    </div>
  )
}
