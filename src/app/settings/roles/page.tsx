import prisma from '@/lib/prisma'
import RolesSettings from '@/components/interactions/RolesSettings'

export const dynamic = 'force-dynamic'

export default async function RolesPage() {
  const roles = await prisma.role.findMany({
    orderBy: { name: 'asc' }
  })

  return (
    <div className="flex-1 bg-background overflow-auto custom-scrollbar">
      <RolesSettings roles={roles} />
    </div>
  )
}
