/**
 * Ola P1 · Equipo 3 — Página de admin de Custom Fields por proyecto.
 *
 * Server Component: lee el proyecto y sus definiciones desde Prisma,
 * serializa lo necesario y delega la UI interactiva a
 * `<ProjectFieldsAdmin/>`. `dynamic = 'force-dynamic'` para no servir
 * snapshots stale tras `revalidatePath`.
 *
 * Convención del repo (Next 16): los `params` son Promise; hay que
 * `await`earlos antes de leer. Ver
 * `node_modules/next/dist/docs/...` (App Router upgrade guide).
 */

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Settings } from 'lucide-react'
import prisma from '@/lib/prisma'
import { getFieldDefsForProject } from '@/lib/actions/custom-fields'
import { ProjectFieldsAdmin } from '@/components/custom-fields/ProjectFieldsAdmin'
import type {
  FieldDefDraft,
  FieldType,
  FieldOption,
} from '@/components/custom-fields/FieldDefForm'
import type { FieldDefRow } from '@/components/custom-fields/FieldsList'

export const dynamic = 'force-dynamic'

type Params = Promise<{ id: string }>

export default async function ProjectFieldsPage({ params }: { params: Params }) {
  const { id: projectId } = await params

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  })
  if (!project) notFound()

  const defs = await getFieldDefsForProject(projectId)

  // Vista plana para FieldsList.
  const fieldRows: FieldDefRow[] = defs.map((d) => ({
    id: d.id,
    key: d.key,
    label: d.label,
    type: d.type,
    required: d.required,
    position: d.position,
  }))

  // Drafts pre-poblados para el modal de edición. Las options vienen como
  // Prisma.JsonValue; las normalizamos al shape `{ value, label }`.
  const drafts: Record<string, FieldDefDraft> = {}
  for (const d of defs) {
    const rawOptions = d.options as unknown
    const options: FieldOption[] = Array.isArray(rawOptions)
      ? rawOptions
          .map((o) => {
            if (o && typeof o === 'object' && 'value' in o && 'label' in o) {
              return {
                value: String((o as { value: unknown }).value ?? ''),
                label: String((o as { label: unknown }).label ?? ''),
              }
            }
            return null
          })
          .filter((o): o is FieldOption => o !== null)
      : []
    drafts[d.id] = {
      id: d.id,
      key: d.key,
      label: d.label,
      type: d.type as FieldType,
      required: d.required,
      options,
    }
  }

  return (
    <div className="flex h-full flex-col bg-background overflow-hidden">
      <header className="flex-shrink-0 border-b border-border bg-card px-8 py-5">
        <div className="mb-2 flex items-center gap-3 text-sm text-muted-foreground">
          <Link
            href={`/projects/${projectId}`}
            className="inline-flex items-center gap-1 hover:text-indigo-400 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Volver al proyecto
          </Link>
          <span>/</span>
          <span>{project.name}</span>
        </div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Settings className="h-6 w-6 text-indigo-400" />
          Configuración de campos
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        <ProjectFieldsAdmin
          projectId={projectId}
          initialFields={fieldRows}
          initialDrafts={drafts}
        />
      </div>
    </div>
  )
}
