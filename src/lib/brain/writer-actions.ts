'use server'

import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import {
  WriterImprovedDescriptionSchema,
  type WriterImprovedDescription,
  type WriterFilterOptions,
} from './writer-types'

// NOTA: Schema y type viven en writer-types.ts. NO re-exportar desde aquí —
// Turbopack rompe `export const`/`export type {}` en archivos 'use server'.

// ─── Server actions ───────────────────────────────────────────────

export async function listTasksForWriter(): Promise<
  Array<{ id: string; mnemonic: string | null; title: string; project: string | null }>
> {
  const tasks = await prisma.task.findMany({
    where: { archivedAt: null },
    take: 200,
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      mnemonic: true,
      title: true,
      project: { select: { name: true } },
    },
  })
  return tasks.map((t) => ({
    id: t.id,
    mnemonic: t.mnemonic,
    title: t.title,
    project: t.project?.name ?? null,
  }))
}

export async function listWriterFilterOptions(): Promise<WriterFilterOptions> {
  const [projects, epics, sprints, userStories] = await Promise.all([
    prisma.project.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.epic.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, projectId: true },
    }),
    prisma.sprint.findMany({
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
      select: { id: true, name: true, projectId: true, status: true },
    }),
    prisma.task.findMany({
      where: { archivedAt: null, type: 'AGILE_STORY' },
      take: 500,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        mnemonic: true,
        title: true,
        projectId: true,
        epicId: true,
        sprintId: true,
      },
    }),
  ])
  return {
    projects,
    epics,
    sprints: sprints.map((s) => ({ ...s, status: String(s.status) })),
    userStories,
  }
}

export async function improveTaskDescription(input: {
  rawText: string
  taskId?: string
}): Promise<WriterImprovedDescription> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY no está configurada en el servidor.')
  }
  if (!input.rawText.trim()) {
    throw new Error('El texto a mejorar no puede estar vacío.')
  }

  let context: { taskTitle?: string; project?: string } = {}
  if (input.taskId) {
    const task = await prisma.task.findUnique({
      where: { id: input.taskId },
      select: { title: true, project: { select: { name: true } } },
    })
    if (task) {
      context = { taskTitle: task.title, project: task.project?.name }
    }
  }

  const { object } = await generateObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: WriterImprovedDescriptionSchema,
    system: `Eres Avante Brain Writer, asistente de redacción técnica para FollowupGantt (gestión PMI/Agile/ITIL).

Recibes texto coloquial de un PM o colaborador y lo conviertes en una historia de usuario / tarea profesional con título preciso, descripción clara y criterios de aceptación verificables. Respondes en español (es-GT).

Reglas:
- Título activo y específico. Evita "hacer X" — usa "Implementar X", "Configurar X", "Validar X".
- La descripción usa el patrón "Como [rol], quiero [acción], para [beneficio]" cuando se trate de una historia de usuario funcional. Para tareas técnicas, usa formato libre profesional con contexto, alcance y consideraciones.
- Los criterios de aceptación son **binarios y verificables**, no aspiracionales. Cada uno debe poder marcarse "pasa" o "no pasa".
- **No inventes** detalles que no estén en el texto del usuario. Si falta información, escribe en \`rationale\` qué supuestos hiciste.
- No incluyas comentarios en bloque de código si no aplican. Markdown limpio.`,
    prompt: `Texto coloquial original:\n"""${input.rawText.trim()}"""${
      context.taskTitle ? `\n\nTítulo actual de la tarea: ${context.taskTitle}` : ''
    }${context.project ? `\nProyecto: ${context.project}` : ''}\n\nReescríbelo según las reglas.`,
  })
  return object
}

export async function applyImprovedDescription(input: {
  taskId: string
  title: string
  description: string
}): Promise<{ ok: true }> {
  if (!input.taskId) throw new Error('taskId es requerido.')
  if (!input.title.trim()) throw new Error('title no puede estar vacío.')
  await prisma.task.update({
    where: { id: input.taskId },
    data: {
      title: input.title.trim(),
      description: input.description,
    },
  })
  revalidatePath('/list')
  revalidatePath('/kanban')
  revalidatePath('/gantt')
  revalidatePath('/table')
  revalidatePath('/brain')
  return { ok: true }
}
