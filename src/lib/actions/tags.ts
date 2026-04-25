'use server'

import prisma from '@/lib/prisma'

/**
 * Lista los tags más usados del proyecto (o globales si no se da `projectId`),
 * ordenados desc por frecuencia y truncados a `limit`.
 *
 * Datasource del autocomplete de `<TagChipInput>` en el formulario de tareas.
 *
 * Decisiones:
 *  - Canonicalizar a lowercase al contar para que el match en `TagChipInput`
 *    (que también guarda en lowercase) sea consistente con tags "legacy"
 *    capturados en mayúsculas/título.
 *  - Excluir tareas archivadas (`archivedAt: null`).
 *  - Cap de 1000 tareas leídas para no degradar bajo proyectos grandes; el
 *    autocomplete no necesita exhaustividad, sólo cobertura razonable de los
 *    tags más utilizados.
 */
export async function listProjectTags(
  projectId?: string,
  limit = 50,
): Promise<string[]> {
  const tasks = await prisma.task.findMany({
    where: { archivedAt: null, ...(projectId ? { projectId } : {}) },
    select: { tags: true },
    take: 1000,
  })

  const counts = new Map<string, number>()
  for (const t of tasks) {
    for (const raw of t.tags ?? []) {
      const tag = (raw ?? '').trim().toLowerCase()
      if (!tag) continue
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([t]) => t)
}
