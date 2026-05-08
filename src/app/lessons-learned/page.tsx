import { BookOpen } from 'lucide-react'
import prisma from '@/lib/prisma'
import { LessonsLearnedClient } from '@/components/lessons-learned/LessonsLearnedClient'
import {
  getLessonCategoryStats,
  listLessons,
} from '@/lib/actions/lessons'
import { getCurrentUserPresence } from '@/lib/auth/get-current-user-presence'

export const dynamic = 'force-dynamic'

export default async function GlobalLessonsLearnedPage() {
  const [lessons, stats, projects, currentUser] = await Promise.all([
    listLessons({ limit: 200 }),
    getLessonCategoryStats({}),
    prisma.project.findMany({
      where: { OR: [{ status: 'ACTIVE' }, { status: 'PLANNING' }] },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    getCurrentUserPresence(),
  ])

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <h1 className="inline-flex items-center gap-2 text-xl font-bold text-foreground">
            <BookOpen className="h-5 w-5 text-amber-400" />
            Lessons Learned · Repositorio organizacional
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            PMBOK 7 · Knowledge Management
          </p>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <LessonsLearnedClient
          scope="global"
          projectId={null}
          workspaceId={null}
          lessons={lessons}
          categoryStats={stats.byCategory}
          total={stats.total}
          currentUser={
            currentUser
              ? { id: currentUser.userId, name: currentUser.name }
              : null
          }
          selectableProjects={projects}
        />
      </div>
    </div>
  )
}
