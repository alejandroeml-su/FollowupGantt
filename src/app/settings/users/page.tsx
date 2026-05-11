import {
  getAllUsersWithRoles,
  getAllRoles,
  getGerenciasWithCurrentManager,
} from '@/lib/user-actions'
import UsersSettings from '@/components/interactions/UsersSettings'

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const [users, roles, gerencias] = await Promise.all([
    getAllUsersWithRoles(),
    getAllRoles(),
    getGerenciasWithCurrentManager(),
  ])

  return (
    <div className="flex-1 bg-background overflow-auto custom-scrollbar">
      <UsersSettings
        initialUsers={users}
        roles={roles}
        gerencias={gerencias}
      />
    </div>
  )
}
