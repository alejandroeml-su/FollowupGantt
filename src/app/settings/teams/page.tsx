import prisma from '@/lib/prisma'
import TeamsSettings from '@/components/interactions/TeamsSettings'

export const dynamic = 'force-dynamic'

export default async function TeamsPage() {
  const teams = await prisma.team.findMany({
    include: {
      members: {
        include: {
          user: true
        }
      }
    },
    orderBy: { name: 'asc' }
  })

  return (
    <div className="flex-1 bg-background overflow-auto custom-scrollbar">
      <TeamsSettings teams={teams} />
    </div>
  )
}
