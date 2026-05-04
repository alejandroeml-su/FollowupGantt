'use server'

/**
 * Ola P2 · Equipo P2-5 — Server actions de Docs / Wikis.
 *
 * Implementa CRUD jerárquico de `Doc` con versionado automático en cada
 * `updateDoc`, soft-delete (archivar/restaurar), reordenamiento en árbol
 * con detección de ciclos y búsqueda full-text simple sobre `title` +
 * `content`.
 *
 * Convenciones del repo aplicadas:
 *   - Errores tipados `[CODE] detalle`. Códigos:
 *     `DOC_NOT_FOUND`, `VERSION_NOT_FOUND`, `INVALID_PARENT`,
 *     `INVALID_INPUT`, `UNAUTHORIZED`.
 *   - Validación zod en cada entrada.
 *   - `revalidatePath('/docs')` tras cualquier mutación.
 *   - `requireUser()` del módulo Auth (Ola P1) para autoría.
 *
 * Decisiones autónomas (documentadas para revisión):
 *   D-DOC-A1: `updateDoc` versiona SIEMPRE que el contenido cambie. No
 *             versiona cambios de title-only (ruido) — el title se persiste
 *             pero no genera DocVersion. Si el caller necesita histórico
 *             del título, puede usar `changeNote`.
 *   D-DOC-A2: `restoreDocVersion` crea una NUEVA versión con el contenido
 *             restaurado (no muta histórico). Esto preserva auditoría
 *             completa: nunca se pierde una versión anterior.
 *   D-DOC-A3: `getDocsTree` retorna sólo docs no archivados por defecto.
 *             Pasar `{ includeArchived: true }` para incluirlos (uso
 *             futuro: papelera).
 *   D-DOC-A4: `searchDocs` usa `LIKE` case-insensitive — suficiente para
 *             un MVP con docs propias. Cuando el corpus crezca podemos
 *             migrar a `to_tsvector` (Postgres FTS) sin tocar el contrato.
 *   D-DOC-A5: `moveDoc` detecta ciclo recorriendo ancestros del newParent
 *             (sin recursive CTE) — coste O(profundidad) que en práctica
 *             es <10 niveles. Si crece, migrar a `WITH RECURSIVE`.
 *   D-DOC-A6: `deleteDoc` es soft (`isArchived=true`). Hard delete no se
 *             expone en MVP — si Edwin lo pide, agregamos `purgeDoc()`
 *             gated a SUPER_ADMIN.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { requireUser } from '@/lib/auth'

// ───────────────────────── Errores tipados ─────────────────────────

export type DocsErrorCode =
  | 'INVALID_INPUT'
  | 'DOC_NOT_FOUND'
  | 'VERSION_NOT_FOUND'
  | 'INVALID_PARENT'
  | 'UNAUTHORIZED'

function actionError(code: DocsErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Schemas ─────────────────────────

const MAX_CONTENT_BYTES = 200_000 // 200 KB

const docCreateSchema = z.object({
  title: z.string().trim().min(1, 'El título es obligatorio').max(200),
  content: z
    .string()
    .max(MAX_CONTENT_BYTES, 'El contenido excede el límite (200 KB)')
    .optional()
    .default(''),
  parentId: z.string().min(1).nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
  taskId: z.string().min(1).nullable().optional(),
})

export type CreateDocInput = z.input<typeof docCreateSchema>

const docUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z
    .string()
    .max(MAX_CONTENT_BYTES, 'El contenido excede el límite (200 KB)')
    .optional(),
  changeNote: z.string().trim().max(200).nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
  taskId: z.string().min(1).nullable().optional(),
  isPublic: z.boolean().optional(),
})

export type UpdateDocInput = z.input<typeof docUpdateSchema>

// ───────────────────────── Helpers ─────────────────────────

function revalidateDocsRoutes(): void {
  revalidatePath('/docs')
}

async function ensureDocExists(id: string): Promise<{ id: string; isArchived: boolean }> {
  const d = await prisma.doc.findUnique({
    where: { id },
    select: { id: true, isArchived: true },
  })
  if (!d) actionError('DOC_NOT_FOUND', `Documento ${id} no existe`)
  return d
}

/**
 * Sube por la cadena de ancestros del candidato `parentId` para detectar
 * si `selfId` aparece — eso indicaría un ciclo (self-reference o
 * bisabuelo de sí mismo).
 *
 * Profundidad máxima en la práctica < 10 (D-DOC-A5). Si excede 50 abortamos
 * defensivamente para evitar loops por datos corruptos.
 */
async function detectsCycle(selfId: string, parentId: string): Promise<boolean> {
  if (selfId === parentId) return true
  let cursor: string | null = parentId
  for (let depth = 0; depth < 50; depth++) {
    if (!cursor) return false
    if (cursor === selfId) return true
    const node: { parentId: string | null } | null = await prisma.doc.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    })
    if (!node) return false
    cursor = node.parentId
  }
  // Defensa: profundidad anormal ⇒ tratamos como ciclo para evitar romper.
  return true
}

// ───────────────────────── Server actions ─────────────────────────

export async function createDoc(input: CreateDocInput): Promise<{ id: string }> {
  const user = await requireUser()
  const parsed = docCreateSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const data = parsed.data

  if (data.parentId) {
    const parent = await prisma.doc.findUnique({
      where: { id: data.parentId },
      select: { id: true, isArchived: true },
    })
    if (!parent) actionError('INVALID_PARENT', `Parent ${data.parentId} no existe`)
    if (parent.isArchived) {
      actionError('INVALID_PARENT', 'No se puede colgar un doc de un padre archivado')
    }
  }

  // position = max+1 entre hermanos del mismo nivel.
  const last = await prisma.doc.findFirst({
    where: { parentId: data.parentId ?? null, isArchived: false },
    orderBy: { position: 'desc' },
    select: { position: true },
  })
  const nextPosition = (last?.position ?? 0) + 1

  const created = await prisma.doc.create({
    data: {
      title: data.title,
      content: data.content ?? '',
      parentId: data.parentId ?? null,
      projectId: data.projectId ?? null,
      taskId: data.taskId ?? null,
      position: nextPosition,
      authorId: user.id,
      lastEditorId: null,
    },
    select: { id: true },
  })

  // Versión inicial: si el doc nace con contenido, lo guardamos como v1.
  if ((data.content ?? '').length > 0) {
    await prisma.docVersion.create({
      data: {
        docId: created.id,
        content: data.content ?? '',
        authorId: user.id,
        changeNote: 'Versión inicial',
      },
    })
  }

  revalidateDocsRoutes()
  return created
}

/**
 * Actualiza title / content / vinculaciones. Versiona automáticamente
 * cuando `content` cambia (D-DOC-A1).
 */
export async function updateDoc(
  id: string,
  patch: UpdateDocInput,
): Promise<void> {
  if (!id) actionError('INVALID_INPUT', 'id es obligatorio')
  const user = await requireUser()
  const parsed = docUpdateSchema.safeParse(patch)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const p = parsed.data

  const current = await prisma.doc.findUnique({
    where: { id },
    select: { id: true, content: true, isArchived: true },
  })
  if (!current) actionError('DOC_NOT_FOUND', `Documento ${id} no existe`)
  if (current.isArchived) {
    actionError('INVALID_INPUT', 'No se puede editar un doc archivado')
  }

  const data: Prisma.DocUpdateInput = {}
  if (p.title !== undefined) data.title = p.title
  if (p.content !== undefined) data.content = p.content
  if (p.projectId !== undefined) {
    data.project = p.projectId
      ? { connect: { id: p.projectId } }
      : { disconnect: true }
  }
  if (p.taskId !== undefined) {
    data.task = p.taskId ? { connect: { id: p.taskId } } : { disconnect: true }
  }
  if (p.isPublic !== undefined) data.isPublic = p.isPublic
  if (p.content !== undefined && p.content !== current.content) {
    data.lastEditor = { connect: { id: user.id } }
  }

  await prisma.doc.update({ where: { id }, data })

  // Versionar sólo si el contenido cambió (D-DOC-A1).
  if (p.content !== undefined && p.content !== current.content) {
    await prisma.docVersion.create({
      data: {
        docId: id,
        content: p.content,
        authorId: user.id,
        changeNote: p.changeNote ?? null,
      },
    })
  }

  revalidateDocsRoutes()
}

/** Soft-delete (D-DOC-2): marca `isArchived=true`. Idempotente. */
export async function deleteDoc(id: string): Promise<void> {
  if (!id) actionError('INVALID_INPUT', 'id es obligatorio')
  await requireUser()
  await ensureDocExists(id)
  await prisma.doc.update({
    where: { id },
    data: { isArchived: true },
  })
  revalidateDocsRoutes()
}

/** Inverso de `deleteDoc`: re-activa un doc archivado. Idempotente. */
export async function restoreDoc(id: string): Promise<void> {
  if (!id) actionError('INVALID_INPUT', 'id es obligatorio')
  await requireUser()
  await ensureDocExists(id)
  await prisma.doc.update({
    where: { id },
    data: { isArchived: false },
  })
  revalidateDocsRoutes()
}

/**
 * Mueve un doc a un nuevo padre dentro del árbol. Detecta ciclo (no se
 * puede colgar un doc de uno de sus descendientes — ni de sí mismo).
 * Reasigna `position` al final del nuevo nivel.
 */
export async function moveDoc(
  id: string,
  newParentId: string | null,
): Promise<void> {
  if (!id) actionError('INVALID_INPUT', 'id es obligatorio')
  await requireUser()
  await ensureDocExists(id)

  if (newParentId) {
    if (newParentId === id) {
      actionError('INVALID_PARENT', 'Un doc no puede ser su propio padre')
    }
    const parent = await prisma.doc.findUnique({
      where: { id: newParentId },
      select: { id: true, isArchived: true },
    })
    if (!parent) actionError('INVALID_PARENT', `Parent ${newParentId} no existe`)
    if (parent.isArchived) {
      actionError('INVALID_PARENT', 'No se puede mover bajo un padre archivado')
    }
    if (await detectsCycle(id, newParentId)) {
      actionError(
        'INVALID_PARENT',
        'Operación crearía un ciclo: el padre destino es descendiente del doc',
      )
    }
  }

  const last = await prisma.doc.findFirst({
    where: { parentId: newParentId ?? null, isArchived: false },
    orderBy: { position: 'desc' },
    select: { position: true },
  })
  const nextPosition = (last?.position ?? 0) + 1

  await prisma.doc.update({
    where: { id },
    data: {
      parent: newParentId
        ? { connect: { id: newParentId } }
        : { disconnect: true },
      position: nextPosition,
    },
  })
  revalidateDocsRoutes()
}

// ───────────────────────── Queries ─────────────────────────

export type DocTreeNode = {
  id: string
  title: string
  parentId: string | null
  position: number
  isArchived: boolean
  projectId: string | null
  taskId: string | null
  authorId: string
  authorName: string
  updatedAt: string
  children: DocTreeNode[]
}

/**
 * Devuelve el árbol completo de docs (no archivados por defecto).
 * Construye la jerarquía en memoria a partir de un solo `findMany` plano —
 * O(n). Para cantidades > 10k habría que pagiar; en MVP basta.
 *
 * @param rootId - Si se provee, sólo retorna el sub-árbol bajo ese id.
 *                 Útil para focalizar la sidebar (ver futuro permalink).
 * @param opts.includeArchived - Si true, también retorna docs archivados
 *                               (uso: papelera).
 */
export async function getDocsTree(
  rootId?: string | null,
  opts: { includeArchived?: boolean } = {},
): Promise<DocTreeNode[]> {
  const where: Prisma.DocWhereInput = {}
  if (!opts.includeArchived) where.isArchived = false

  const rows = await prisma.doc.findMany({
    where,
    orderBy: [{ parentId: 'asc' }, { position: 'asc' }],
    include: { author: { select: { id: true, name: true } } },
  })

  const byId = new Map<string, DocTreeNode>()
  rows.forEach((d) => {
    byId.set(d.id, {
      id: d.id,
      title: d.title,
      parentId: d.parentId,
      position: d.position,
      isArchived: d.isArchived,
      projectId: d.projectId,
      taskId: d.taskId,
      authorId: d.authorId,
      authorName: d.author.name,
      updatedAt: d.updatedAt.toISOString(),
      children: [],
    })
  })

  const roots: DocTreeNode[] = []
  byId.forEach((node) => {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  })

  // Ordena hijos por position (Prisma ya ordena, pero al construir el map
  // perdemos el orden si parents vienen después que children).
  const sortChildren = (n: DocTreeNode) => {
    n.children.sort((a, b) => a.position - b.position)
    n.children.forEach(sortChildren)
  }
  roots.sort((a, b) => a.position - b.position)
  roots.forEach(sortChildren)

  if (rootId) {
    // Filtrar al sub-árbol solicitado.
    const target = byId.get(rootId)
    return target ? [target] : []
  }
  return roots
}

export type SerializedDoc = {
  id: string
  title: string
  content: string
  parentId: string | null
  position: number
  projectId: string | null
  projectName: string | null
  taskId: string | null
  taskTitle: string | null
  authorId: string
  authorName: string
  lastEditorId: string | null
  lastEditorName: string | null
  isArchived: boolean
  isPublic: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Carga un doc completo con joins (project, task, autores). Throw si no
 * existe.
 */
export async function getDoc(id: string): Promise<SerializedDoc> {
  if (!id) actionError('INVALID_INPUT', 'id es obligatorio')
  const d = await prisma.doc.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, name: true } },
      lastEditor: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      task: { select: { id: true, title: true } },
    },
  })
  if (!d) actionError('DOC_NOT_FOUND', `Documento ${id} no existe`)
  return {
    id: d.id,
    title: d.title,
    content: d.content,
    parentId: d.parentId,
    position: d.position,
    projectId: d.projectId,
    projectName: d.project?.name ?? null,
    taskId: d.taskId,
    taskTitle: d.task?.title ?? null,
    authorId: d.authorId,
    authorName: d.author.name,
    lastEditorId: d.lastEditorId,
    lastEditorName: d.lastEditor?.name ?? null,
    isArchived: d.isArchived,
    isPublic: d.isPublic,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  }
}

export type DocVersionListItem = {
  id: string
  docId: string
  authorId: string
  authorName: string
  changeNote: string | null
  createdAt: string
  contentPreview: string
}

/**
 * Lista las versiones de un doc, ordenadas por fecha desc. El preview
 * trunca a 200 chars para evitar payloads grandes en la lista.
 */
export async function getDocVersions(docId: string): Promise<DocVersionListItem[]> {
  if (!docId) actionError('INVALID_INPUT', 'docId es obligatorio')
  await ensureDocExists(docId)
  const rows = await prisma.docVersion.findMany({
    where: { docId },
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { id: true, name: true } } },
  })
  return rows.map((v) => ({
    id: v.id,
    docId: v.docId,
    authorId: v.authorId,
    authorName: v.author.name,
    changeNote: v.changeNote,
    createdAt: v.createdAt.toISOString(),
    contentPreview: v.content.slice(0, 200),
  }))
}

/**
 * Restaura una versión histórica como el contenido actual. Crea una NUEVA
 * versión etiquetada para preservar el rastro de auditoría (D-DOC-A2).
 */
export async function restoreDocVersion(versionId: string): Promise<{ docId: string }> {
  if (!versionId) actionError('INVALID_INPUT', 'versionId es obligatorio')
  const user = await requireUser()
  const v = await prisma.docVersion.findUnique({
    where: { id: versionId },
    select: { id: true, docId: true, content: true, createdAt: true },
  })
  if (!v) actionError('VERSION_NOT_FOUND', `Versión ${versionId} no existe`)

  await prisma.doc.update({
    where: { id: v.docId },
    data: {
      content: v.content,
      lastEditor: { connect: { id: user.id } },
    },
  })
  await prisma.docVersion.create({
    data: {
      docId: v.docId,
      content: v.content,
      authorId: user.id,
      changeNote: `Restaurado desde ${v.createdAt.toISOString().slice(0, 16)}`,
    },
  })

  revalidateDocsRoutes()
  return { docId: v.docId }
}

export type DocSearchResult = {
  id: string
  title: string
  snippet: string
  projectId: string | null
  taskId: string | null
  updatedAt: string
}

/**
 * Búsqueda full-text simple sobre title + content. LIKE case-insensitive
 * (D-DOC-A4). Filtra docs archivados.
 *
 * `snippet` extrae 80 chars alrededor del primer match en `content` para
 * dar contexto al usuario.
 */
export async function searchDocs(query: string): Promise<DocSearchResult[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const rows = await prisma.doc.findMany({
    where: {
      isArchived: false,
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { content: { contains: q, mode: 'insensitive' } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take: 30,
    select: {
      id: true,
      title: true,
      content: true,
      projectId: true,
      taskId: true,
      updatedAt: true,
    },
  })

  const lq = q.toLowerCase()
  return rows.map((d) => {
    const lc = d.content.toLowerCase()
    const idx = lc.indexOf(lq)
    let snippet = ''
    if (idx >= 0) {
      const from = Math.max(0, idx - 30)
      const to = Math.min(d.content.length, idx + q.length + 50)
      snippet = (from > 0 ? '…' : '') + d.content.slice(from, to) + (to < d.content.length ? '…' : '')
    } else {
      snippet = d.content.slice(0, 100)
    }
    return {
      id: d.id,
      title: d.title,
      snippet,
      projectId: d.projectId,
      taskId: d.taskId,
      updatedAt: d.updatedAt.toISOString(),
    }
  })
}

/**
 * Lista plana de docs vinculados a una task. Usado por el TaskDrawer
 * (tab "Docs"). No incluye archivados.
 */
export async function getDocsForTask(taskId: string): Promise<
  Array<{ id: string; title: string; updatedAt: string }>
> {
  if (!taskId) return []
  const rows = await prisma.doc.findMany({
    where: { taskId, isArchived: false },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, updatedAt: true },
  })
  return rows.map((d) => ({
    id: d.id,
    title: d.title,
    updatedAt: d.updatedAt.toISOString(),
  }))
}

/**
 * Lista plana de docs vinculados a un project. Usado por la project page.
 * No incluye archivados.
 */
export async function getDocsForProject(projectId: string): Promise<
  Array<{ id: string; title: string; updatedAt: string }>
> {
  if (!projectId) return []
  const rows = await prisma.doc.findMany({
    where: { projectId, isArchived: false },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, updatedAt: true },
  })
  return rows.map((d) => ({
    id: d.id,
    title: d.title,
    updatedAt: d.updatedAt.toISOString(),
  }))
}
