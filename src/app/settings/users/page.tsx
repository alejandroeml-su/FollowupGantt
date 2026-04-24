import { getAllUsersWithRoles, getAllRoles } from '@/lib/user-actions'
import UsersSettings from '@/components/interactions/UsersSettings'

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const [users, roles] = await Promise.all([
    getAllUsersWithRoles(),
    getAllRoles()
  ])

  return (
    <div className="flex-1 bg-background overflow-auto custom-scrollbar">
      <UsersSettings initialUsers={users} roles={roles} />
    </div>
  )
}
