import { notFound } from 'next/navigation'
import { getWhiteboardById } from '@/lib/actions/whiteboards'
import { WhiteboardEditor } from '@/components/whiteboards/WhiteboardEditor'
import prisma from '@/lib/prisma'
import type { WhiteboardElement } from '@/lib/whiteboards/types'
import { getCurrentUserPresence } from '@/lib/auth/get-current-user-presence'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
}

/**
 * Ola P5 · Equipo P5-1 — `/whiteboards/[id]` (server component shell).
 * Carga la pizarra y delega al editor cliente, manteniendo el bundle
 * inicial bajo (code splitting natural por boundary 'use client').
 */
export default async function WhiteboardEditorPage({ params }: PageProps) {
  const { id } = await params

  let payload: Awaited<ReturnType<typeof getWhiteboardById>>
  try {
    payload = await getWhiteboardById(id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (/\[NOT_FOUND\]/.test(msg)) return notFound()
    throw err
  }

  const projectName = payload.whiteboard.projectId
    ? (
        await prisma.project.findUnique({
          where: { id: payload.whiteboard.projectId },
          select: { name: true },
        })
      )?.name ?? null
    : null

  const initialElements: WhiteboardElement[] = payload.elements.map((el) => ({
    id: el.id,
    whiteboardId: el.whiteboardId,
    type: el.type,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    rotation: el.rotation,
    zIndex: el.zIndex,
    data: el.data as WhiteboardElement['data'],
  }))

  // Wave P6 · Equipo B1 — Carga la identidad del usuario en server para
  // pasarla al editor (presence/cursors). `null` = no hay sesión.
  const currentUser = await getCurrentUserPresence()

  return (
    <WhiteboardEditor
      whiteboard={{
        id: payload.whiteboard.id,
        title: payload.whiteboard.title,
        description: payload.whiteboard.description,
        projectName,
      }}
      initialElements={initialElements}
      currentUser={currentUser}
    />
  )
}
