/**
 * Ola P4 · Equipo P4-1 — Slot server-rendered del WorkspaceSwitcher.
 *
 * Encapsula la carga de `listMyWorkspaces` + cookie para que el layout
 * (server) sólo tenga que renderizar `<WorkspaceSwitcherSlot/>`. Si no
 * hay sesión devuelve `null` (el sidebar simplemente oculta el slot).
 */

import { getCurrentUser } from '@/lib/auth/get-current-user'
import {
  listMyWorkspaces,
  getActiveWorkspaceId,
} from '@/lib/actions/workspaces'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

export default async function WorkspaceSwitcherSlot({
  collapsed = false,
}: {
  collapsed?: boolean
}) {
  const user = await getCurrentUser()
  if (!user) return null

  const [workspaces, activeId] = await Promise.all([
    listMyWorkspaces(),
    getActiveWorkspaceId(),
  ])

  return (
    <WorkspaceSwitcher
      workspaces={workspaces}
      activeWorkspaceId={activeId}
      collapsed={collapsed}
    />
  )
}
