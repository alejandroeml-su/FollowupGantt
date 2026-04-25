'use server'

import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'

// =============================================
// CRUD: MindMap (contenedor)
// =============================================

export async function createMindMap(formData: FormData) {
  const title = (formData.get('title') as string)?.trim()
  const description = (formData.get('description') as string) || null
  const projectId = (formData.get('projectId') as string) || null
  const ownerId = (formData.get('ownerId') as string) || null

  if (!title) throw new Error('[INVALID_INPUT] El título es requerido')

  const mindMap = await prisma.mindMap.create({
    data: {
      title,
      description,
      projectId,
      ownerId,
      // Nodo raíz por defecto en el centro del viewport
      nodes: {
        create: {
          label: title,
          isRoot: true,
          x: 0,
          y: 0,
        },
      },
    },
  })

  revalidatePath('/mindmaps')
  return mindMap
}

export async function renameMindMap(formData: FormData) {
  const id = formData.get('id') as string
  const title = (formData.get('title') as string)?.trim()
  const description = formData.get('description') as string | null

  if (!id || !title) throw new Error('[INVALID_INPUT] id y título son requeridos')

  await prisma.mindMap.update({
    where: { id },
    data: { title, description },
  })

  revalidatePath('/mindmaps')
  revalidatePath(`/mindmaps/${id}`)
}

export async function deleteMindMap(formData: FormData) {
  const id = formData.get('id') as string
  if (!id) throw new Error('[INVALID_INPUT] id requerido')

  await prisma.mindMap.delete({ where: { id } })
  revalidatePath('/mindmaps')
}

// =============================================
// CRUD: MindMapNode
// =============================================

type NodeCreateInput = {
  mindMapId: string
  label?: string
  x: number
  y: number
  color?: string | null
  taskId?: string | null
  parentId?: string | null // crea edge desde parentId → nuevo nodo
}

export async function createMindMapNode(input: NodeCreateInput) {
  if (!input.mindMapId) throw new Error('[INVALID_INPUT] mindMapId requerido')

  const node = await prisma.mindMapNode.create({
    data: {
      mindMapId: input.mindMapId,
      label: input.label?.trim() || 'Nuevo nodo',
      x: input.x,
      y: input.y,
      color: input.color ?? null,
      taskId: input.taskId ?? null,
    },
  })

  if (input.parentId) {
    await prisma.mindMapEdge.create({
      data: {
        mindMapId: input.mindMapId,
        sourceId: input.parentId,
        targetId: node.id,
      },
    }).catch(() => {
      // edge duplicada (unique [sourceId, targetId]) — ignorar silenciosamente
    })
  }

  revalidatePath(`/mindmaps/${input.mindMapId}`)
  return node
}

type NodeUpdateInput = {
  id: string
  label?: string
  note?: string | null
  x?: number
  y?: number
  color?: string | null
  taskId?: string | null
}

export async function updateMindMapNode(input: NodeUpdateInput) {
  if (!input.id) throw new Error('[INVALID_INPUT] id requerido')

  const node = await prisma.mindMapNode.update({
    where: { id: input.id },
    data: {
      ...(input.label !== undefined ? { label: input.label.trim() || 'Nuevo nodo' } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.x !== undefined ? { x: input.x } : {}),
      ...(input.y !== undefined ? { y: input.y } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
    },
  })

  revalidatePath(`/mindmaps/${node.mindMapId}`)
  return node
}

export async function deleteMindMapNode(formData: FormData) {
  const id = formData.get('id') as string
  if (!id) throw new Error('[INVALID_INPUT] id requerido')

  const node = await prisma.mindMapNode.findUnique({
    where: { id },
    select: { mindMapId: true, isRoot: true },
  })
  if (!node) throw new Error('[NOT_FOUND] nodo no existe')
  if (node.isRoot) throw new Error('[INVALID_OPERATION] el nodo raíz no se puede eliminar')

  await prisma.mindMapNode.delete({ where: { id } })
  revalidatePath(`/mindmaps/${node.mindMapId}`)
}

// =============================================
// CRUD: MindMapEdge
// =============================================

type EdgeCreateInput = {
  mindMapId: string
  sourceId: string
  targetId: string
  label?: string | null
}

export async function createMindMapEdge(input: EdgeCreateInput) {
  if (!input.mindMapId || !input.sourceId || !input.targetId) {
    throw new Error('[INVALID_INPUT] mindMapId, sourceId y targetId requeridos')
  }
  if (input.sourceId === input.targetId) {
    throw new Error('[INVALID_OPERATION] un nodo no puede conectarse a sí mismo')
  }

  const edge = await prisma.mindMapEdge.upsert({
    where: { sourceId_targetId: { sourceId: input.sourceId, targetId: input.targetId } },
    update: { label: input.label ?? null },
    create: {
      mindMapId: input.mindMapId,
      sourceId: input.sourceId,
      targetId: input.targetId,
      label: input.label ?? null,
    },
  })

  revalidatePath(`/mindmaps/${input.mindMapId}`)
  return edge
}

export async function deleteMindMapEdge(formData: FormData) {
  const id = formData.get('id') as string
  if (!id) throw new Error('[INVALID_INPUT] id requerido')

  const edge = await prisma.mindMapEdge.findUnique({
    where: { id },
    select: { mindMapId: true },
  })
  if (!edge) throw new Error('[NOT_FOUND] edge no existe')

  await prisma.mindMapEdge.delete({ where: { id } })
  revalidatePath(`/mindmaps/${edge.mindMapId}`)
}

// =============================================
// Sync en lote: posiciones (debounced desde el cliente)
// =============================================

export async function syncNodePositions(
  mindMapId: string,
  positions: { id: string; x: number; y: number }[],
) {
  if (!mindMapId || positions.length === 0) return

  await prisma.$transaction(
    positions.map((p) =>
      prisma.mindMapNode.update({
        where: { id: p.id },
        data: { x: p.x, y: p.y },
      }),
    ),
  )

  revalidatePath(`/mindmaps/${mindMapId}`)
}

// =============================================
// Lecturas
// =============================================

export async function getMindMapList() {
  return prisma.mindMap.findMany({
    orderBy: { updatedAt: 'desc' },
    include: {
      project: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
      _count: { select: { nodes: true } },
    },
  })
}

export async function getMindMapById(id: string) {
  return prisma.mindMap.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
      nodes: {
        include: {
          task: { select: { id: true, mnemonic: true, title: true } },
        },
      },
      edges: true,
    },
  })
}
