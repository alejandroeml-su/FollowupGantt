import 'server-only'

/**
 * P3-3 · Restore full de proyecto desde ZIP.
 *
 * Lee un ZIP generado por `exportProjectFullToZip`, valida el manifest
 * con zod (schemaVersion 1) y crea un proyecto NUEVO en BD con todas
 * las dependencias resueltas y UUIDs regenerados. La ejecución entera
 * está envuelta en `prisma.$transaction` (all-or-nothing).
 *
 * Reglas:
 *   - No overwrite: el proyecto importado es siempre nuevo (UUID nuevo).
 *   - Si el manifest referencia un email de assignee/comentarista que no
 *     existe en la BD destino, se ignora la asignación (warning).
 *   - Calendar/Manager se omiten (P3-3 importa data del proyecto, no
 *     reasigna ownership/calendar; el usuario lo configura post-import).
 *
 * Errores tipados:
 *   - `[INVALID_ZIP]` ZIP corrupto o sin manifest.json.
 *   - `[MANIFEST_VERSION]` schemaVersion no soportado.
 *   - `[INVALID_MANIFEST]` manifest no pasa validación zod.
 *   - `[FILE_TOO_LARGE]` ZIP > 50MB.
 *   - `[IMPORT_FAILED]` error genérico envolviendo cualquier otro fallo.
 */

import JSZip from 'jszip'
import {
  MANIFEST_FILENAME,
  ZIP_SIZE_LIMIT_BYTES,
  ZIP_SIZE_LIMIT_MB,
  isSupportedSchemaVersion,
  manifestSchema,
  type Manifest,
} from './manifest-schema'

// ───────────────────────── Tipos del prisma-like ─────────────────────────

/**
 * Subset del PrismaClient que requiere el motor de import. Inyectable
 * para tests; en producción se pasa el singleton real.
 */
export interface PrismaLikeForImport {
  user: {
    findMany: (args: { where: unknown; select: unknown }) => Promise<
      Array<{ id: string; email: string }>
    >
  }
  $transaction: <T>(
    cb: (tx: ImportTransaction) => Promise<T>,
    opts?: unknown,
  ) => Promise<T>
}

/**
 * Subset de `Prisma.TransactionClient` consumido por el pipeline. Cada
 * método `create` recibe `data` con los IDs ya regenerados.
 */
export interface ImportTransaction {
  project: { create: (args: { data: unknown }) => Promise<{ id: string }> }
  phase: { create: (args: { data: unknown }) => Promise<unknown> }
  sprint: { create: (args: { data: unknown }) => Promise<unknown> }
  boardColumn: { create: (args: { data: unknown }) => Promise<unknown> }
  task: { create: (args: { data: unknown }) => Promise<unknown> }
  taskDependency: { create: (args: { data: unknown }) => Promise<unknown> }
  baseline: { create: (args: { data: unknown }) => Promise<unknown> }
  comment: { create: (args: { data: unknown }) => Promise<unknown> }
  attachment: { create: (args: { data: unknown }) => Promise<unknown> }
  customFieldDef: { create: (args: { data: unknown }) => Promise<unknown> }
  customFieldValue: { create: (args: { data: unknown }) => Promise<unknown> }
  mindMap: { create: (args: { data: unknown }) => Promise<{ id: string }> }
  mindMapNode: { create: (args: { data: unknown }) => Promise<unknown> }
  mindMapEdge: { create: (args: { data: unknown }) => Promise<unknown> }
}

// ───────────────────────── Resultado público ─────────────────────────

export interface ImportFullResult {
  projectId: string
  warnings: string[]
}

// ───────────────────────── Decode + validate ─────────────────────────

/**
 * Decodifica un ZIP base64 y devuelve el manifest validado. Lanza
 * errores tipados; consumidores deben capturar y mapear a la respuesta
 * de la server action.
 */
export async function readManifestFromZipBase64(
  zipBase64: string,
): Promise<Manifest> {
  let buffer: Buffer
  try {
    buffer = Buffer.from(zipBase64, 'base64')
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`[INVALID_ZIP] base64 inválido: ${detail}`)
  }

  if (buffer.byteLength === 0) {
    throw new Error('[INVALID_ZIP] payload vacío')
  }
  if (buffer.byteLength > ZIP_SIZE_LIMIT_BYTES) {
    throw new Error(
      `[FILE_TOO_LARGE] el ZIP supera ${ZIP_SIZE_LIMIT_MB} MB`,
    )
  }

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`[INVALID_ZIP] no se pudo abrir el archivo: ${detail}`)
  }

  const manifestEntry = zip.file(MANIFEST_FILENAME)
  if (!manifestEntry) {
    throw new Error(
      `[INVALID_ZIP] el archivo no contiene ${MANIFEST_FILENAME}`,
    )
  }

  const manifestText = await manifestEntry.async('string')
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(manifestText)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`[INVALID_ZIP] manifest.json no es JSON válido: ${detail}`)
  }

  // schemaVersion check antes de zod para devolver el error más útil.
  const rawVersion = (parsedJson as { schemaVersion?: unknown } | null)
    ?.schemaVersion
  if (!isSupportedSchemaVersion(rawVersion)) {
    throw new Error(
      `[MANIFEST_VERSION] schemaVersion=${String(rawVersion)} no soportado`,
    )
  }

  const result = manifestSchema.safeParse(parsedJson)
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    throw new Error(`[INVALID_MANIFEST] ${issues}`)
  }
  return result.data
}

// ───────────────────────── Import principal ─────────────────────────

/**
 * Ejecuta el restore completo dentro de una transacción Prisma.
 * Devuelve el ID del proyecto recién creado y la lista de warnings
 * (referencias huérfanas). Lanza errores tipados al fallar.
 */
export async function importProjectFromZipBase64(
  prismaLike: PrismaLikeForImport,
  zipBase64: string,
): Promise<ImportFullResult> {
  const manifest = await readManifestFromZipBase64(zipBase64)

  const warnings: string[] = []

  // ───── Resolver assignees (email → User.id) en una sola query ─────
  const emails = collectAllEmails(manifest)
  const dbUsers =
    emails.length === 0
      ? []
      : await prismaLike.user.findMany({
          where: { email: { in: emails } },
          select: { id: true, email: true },
        })
  const emailToUserId = new Map<string, string>(
    dbUsers.map((u) => [u.email, u.id]),
  )

  // ───── Generar mapas de re-mapeo de UUIDs ─────
  const idMaps = buildIdMaps(manifest)
  const newProjectId = idMaps.projectId

  try {
    await prismaLike.$transaction(async (tx) => {
      // 1. Project.
      await tx.project.create({
        data: {
          id: newProjectId,
          name: manifest.project.name,
          description: manifest.project.description ?? null,
          status: manifest.project.status,
          cpi: manifest.project.cpi ?? null,
          spi: manifest.project.spi ?? null,
        },
      })

      // 2. Phases / Sprints / BoardColumns (referencian solo project).
      for (const p of manifest.phases) {
        await tx.phase.create({
          data: {
            id: idMaps.phaseId.get(p.id)!,
            name: p.name,
            order: p.order,
            projectId: newProjectId,
          },
        })
      }
      for (const s of manifest.sprints) {
        await tx.sprint.create({
          data: {
            id: idMaps.sprintId.get(s.id)!,
            name: s.name,
            goal: s.goal ?? null,
            startDate: s.startDate,
            endDate: s.endDate,
            status: s.status,
            projectId: newProjectId,
          },
        })
      }
      for (const c of manifest.columns) {
        await tx.boardColumn.create({
          data: {
            id: idMaps.columnId.get(c.id)!,
            name: c.name,
            order: c.order,
            wipLimit: c.wipLimit ?? null,
            projectId: newProjectId,
          },
        })
      }

      // 3. Tasks: parents primero (topo sort por parentId).
      const sortedTasks = topoSortTasks(manifest.tasks)
      for (const t of sortedTasks) {
        const newId = idMaps.taskId.get(t.id)!
        const newParentId = t.parentId
          ? (idMaps.taskId.get(t.parentId) ?? null)
          : null
        const newPhaseId = t.phaseId
          ? (idMaps.phaseId.get(t.phaseId) ?? null)
          : null
        const newSprintId = t.sprintId
          ? (idMaps.sprintId.get(t.sprintId) ?? null)
          : null
        const newColumnId = t.columnId
          ? (idMaps.columnId.get(t.columnId) ?? null)
          : null
        const assigneeId = t.assigneeEmail
          ? (emailToUserId.get(t.assigneeEmail) ?? null)
          : null
        if (t.assigneeEmail && !assigneeId) {
          warnings.push(
            `assignee "${t.assigneeEmail}" no existe; tarea "${t.title}" se importó sin asignar`,
          )
        }

        await tx.task.create({
          data: {
            id: newId,
            mnemonic: t.mnemonic ?? null,
            title: t.title,
            description: t.description ?? null,
            type: t.type,
            status: t.status,
            priority: t.priority,
            parentId: newParentId,
            projectId: newProjectId,
            phaseId: newPhaseId,
            sprintId: newSprintId,
            columnId: newColumnId,
            assigneeId,
            startDate: t.startDate ?? null,
            endDate: t.endDate ?? null,
            progress: t.progress,
            isMilestone: t.isMilestone,
            slaResponseLimit: t.slaResponseLimit ?? null,
            slaResolutionLimit: t.slaResolutionLimit ?? null,
            isEscalated: t.isEscalated,
            plannedValue: t.plannedValue ?? null,
            actualCost: t.actualCost ?? null,
            earnedValue: t.earnedValue ?? null,
            position: t.position,
            archivedAt: t.archivedAt ?? null,
            tags: t.tags,
            referenceUrl: t.referenceUrl ?? null,
          },
        })
      }

      // 4. Dependencias.
      for (const d of manifest.dependencies) {
        const predId = idMaps.taskId.get(d.predecessorId)
        const succId = idMaps.taskId.get(d.successorId)
        if (!predId || !succId) {
          warnings.push(
            `dependencia ${d.id} omitida: predecesor o sucesor inexistente`,
          )
          continue
        }
        await tx.taskDependency.create({
          data: {
            id: idMaps.dependencyId.get(d.id)!,
            predecessorId: predId,
            successorId: succId,
            type: d.type,
            lagDays: d.lagDays,
          },
        })
      }

      // 5. Baselines (snapshotData se guarda tal cual).
      for (const b of manifest.baselines) {
        await tx.baseline.create({
          data: {
            id: idMaps.baselineId.get(b.id)!,
            version: b.version,
            label: b.label ?? null,
            snapshotData: b.snapshotData as object,
            projectId: newProjectId,
            createdAt: b.createdAt,
          },
        })
      }

      // 6. Comments.
      for (const c of manifest.comments) {
        const taskId = idMaps.taskId.get(c.taskId)
        if (!taskId) continue
        const authorId = c.authorEmail
          ? (emailToUserId.get(c.authorEmail) ?? null)
          : null
        await tx.comment.create({
          data: {
            id: idMaps.commentId.get(c.id)!,
            content: c.content,
            isInternal: c.isInternal,
            taskId,
            authorId,
            createdAt: c.createdAt,
          },
        })
      }

      // 7. Attachments (solo metadata; binarios viven en almacenamiento
      // externo con la URL guardada).
      for (const a of manifest.attachments) {
        const taskId = idMaps.taskId.get(a.taskId)
        if (!taskId) continue
        const userId = a.uploaderEmail
          ? (emailToUserId.get(a.uploaderEmail) ?? null)
          : null
        await tx.attachment.create({
          data: {
            id: idMaps.attachmentId.get(a.id)!,
            filename: a.filename,
            url: a.url,
            size: a.size ?? null,
            mimetype: a.mimetype ?? null,
            taskId,
            userId,
            createdAt: a.createdAt,
          },
        })
      }

      // 8. Custom Fields (defs primero, luego values).
      for (const def of manifest.customFieldDefs) {
        await tx.customFieldDef.create({
          data: {
            id: idMaps.customFieldDefId.get(def.id)!,
            projectId: newProjectId,
            key: def.key,
            label: def.label,
            type: def.type,
            required: def.required,
            defaultValue: (def.defaultValue ?? null) as object | null,
            options: (def.options ?? null) as object | null,
            position: def.position,
          },
        })
      }
      for (const v of manifest.customFieldValues) {
        const fieldId = idMaps.customFieldDefId.get(v.fieldId)
        const taskId = idMaps.taskId.get(v.taskId)
        if (!fieldId || !taskId) continue
        await tx.customFieldValue.create({
          data: {
            id: idMaps.customFieldValueId.get(v.id)!,
            fieldId,
            taskId,
            value: v.value as object,
          },
        })
      }

      // 9. Mind maps con nodes/edges (re-mapear taskId opcional).
      for (const mm of manifest.mindMaps) {
        const newMindMapId = idMaps.mindMapId.get(mm.id)!
        const ownerId = mm.ownerEmail
          ? (emailToUserId.get(mm.ownerEmail) ?? null)
          : null
        await tx.mindMap.create({
          data: {
            id: newMindMapId,
            title: mm.title,
            description: mm.description ?? null,
            projectId: newProjectId,
            ownerId,
          },
        })
        // Nodes.
        for (const n of mm.nodes) {
          const newNodeId = idMaps.mindMapNodeId.get(n.id)!
          const nodeTaskId = n.taskId
            ? (idMaps.taskId.get(n.taskId) ?? null)
            : null
          await tx.mindMapNode.create({
            data: {
              id: newNodeId,
              mindMapId: newMindMapId,
              label: n.label,
              note: n.note ?? null,
              x: n.x,
              y: n.y,
              color: n.color ?? null,
              isRoot: n.isRoot,
              taskId: nodeTaskId,
            },
          })
        }
        // Edges (referencian nodes).
        for (const e of mm.edges) {
          const sourceId = idMaps.mindMapNodeId.get(e.sourceId)
          const targetId = idMaps.mindMapNodeId.get(e.targetId)
          if (!sourceId || !targetId) {
            warnings.push(
              `mindmap edge ${e.id} omitido: nodo origen/destino faltante`,
            )
            continue
          }
          await tx.mindMapEdge.create({
            data: {
              id: idMaps.mindMapEdgeId.get(e.id)!,
              mindMapId: newMindMapId,
              sourceId,
              targetId,
              label: e.label ?? null,
            },
          })
        }
      }

      // 10. Time entries (placeholder — schema aún no incluye el modelo).
      if (manifest.timeEntries.length > 0) {
        warnings.push(
          `timeEntries=${manifest.timeEntries.length} ignorados: el modelo TimeEntry aún no existe en este entorno`,
        )
      }
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    // Re-raise tipado pero conservando el mensaje original detrás del prefijo.
    if (detail.startsWith('[')) throw err
    throw new Error(`[IMPORT_FAILED] ${detail}`)
  }

  return { projectId: newProjectId, warnings }
}

// ───────────────────────── Helpers ─────────────────────────

/**
 * Recolecta todos los emails referenciados en el manifest. Se usan para
 * resolver `assigneeId/authorId/userId/ownerId` de una sola query.
 */
function collectAllEmails(manifest: Manifest): string[] {
  const set = new Set<string>()
  for (const t of manifest.tasks) {
    if (t.assigneeEmail) set.add(t.assigneeEmail)
  }
  for (const c of manifest.comments) {
    if (c.authorEmail) set.add(c.authorEmail)
  }
  for (const a of manifest.attachments) {
    if (a.uploaderEmail) set.add(a.uploaderEmail)
  }
  for (const m of manifest.mindMaps) {
    if (m.ownerEmail) set.add(m.ownerEmail)
  }
  for (const te of manifest.timeEntries) {
    if (te.userEmail) set.add(te.userEmail)
  }
  return Array.from(set)
}

interface IdMaps {
  projectId: string
  phaseId: Map<string, string>
  sprintId: Map<string, string>
  columnId: Map<string, string>
  taskId: Map<string, string>
  dependencyId: Map<string, string>
  baselineId: Map<string, string>
  commentId: Map<string, string>
  attachmentId: Map<string, string>
  customFieldDefId: Map<string, string>
  customFieldValueId: Map<string, string>
  mindMapId: Map<string, string>
  mindMapNodeId: Map<string, string>
  mindMapEdgeId: Map<string, string>
}

/**
 * Genera nuevos UUIDs para todas las entidades del manifest. Los maps
 * permiten resolver referencias internas (parentId, taskId, etc.) en
 * memoria sin tocar BD.
 */
function buildIdMaps(manifest: Manifest): IdMaps {
  const newId = (): string =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : fallbackUuid()

  const remap = <T extends { id: string }>(arr: T[]): Map<string, string> => {
    const m = new Map<string, string>()
    for (const x of arr) m.set(x.id, newId())
    return m
  }

  const allMindMapNodes = manifest.mindMaps.flatMap((m) => m.nodes)
  const allMindMapEdges = manifest.mindMaps.flatMap((m) => m.edges)

  return {
    projectId: newId(),
    phaseId: remap(manifest.phases),
    sprintId: remap(manifest.sprints),
    columnId: remap(manifest.columns),
    taskId: remap(manifest.tasks),
    dependencyId: remap(manifest.dependencies),
    baselineId: remap(manifest.baselines),
    commentId: remap(manifest.comments),
    attachmentId: remap(manifest.attachments),
    customFieldDefId: remap(manifest.customFieldDefs),
    customFieldValueId: remap(manifest.customFieldValues),
    mindMapId: remap(manifest.mindMaps),
    mindMapNodeId: remap(allMindMapNodes),
    mindMapEdgeId: remap(allMindMapEdges),
  }
}

/**
 * Fallback determinista cuando `crypto.randomUUID` no esté disponible
 * (entornos antiguos). Se basa en `Math.random` — suficiente para
 * unicidad de un import de proyecto pero NO para crypto.
 */
function fallbackUuid(): string {
  const hex = (n: number) => Math.floor(Math.random() * n).toString(16)
  return `${hex(0xffffffff).padStart(8, '0')}-${hex(0xffff).padStart(4, '0')}-4${hex(0xfff).padStart(3, '0')}-a${hex(0xfff).padStart(3, '0')}-${hex(0xffffffffffff).padStart(12, '0')}`
}

/**
 * Topo sort por `parentId` para insertar parents antes que children y
 * respetar la FK self-relation. Tareas sin parent o con parent inválido
 * se insertan al inicio.
 */
function topoSortTasks(
  tasks: Manifest['tasks'],
): Manifest['tasks'] {
  const byId = new Map<string, Manifest['tasks'][number]>()
  for (const t of tasks) byId.set(t.id, t)
  const result: Manifest['tasks'] = []
  const inserted = new Set<string>()
  const visit = (t: Manifest['tasks'][number]): void => {
    if (inserted.has(t.id)) return
    if (t.parentId && byId.has(t.parentId)) {
      visit(byId.get(t.parentId)!)
    }
    inserted.add(t.id)
    result.push(t)
  }
  for (const t of tasks) visit(t)
  return result
}
