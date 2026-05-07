import Link from 'next/link'
import { ArrowLeft, Calendar as CalendarIcon } from 'lucide-react'
import prisma from '@/lib/prisma'
import { CalendarManagerClient } from '@/components/calendar/CalendarManagerClient'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function ProjectCalendarPage({ params }: PageProps) {
  const { id: projectId } = await params

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      calendarId: true,
      calendar: {
        select: {
          id: true,
          name: true,
          workdays: true,
          workdayHours: true,
          holidays: {
            orderBy: { date: 'asc' },
            select: {
              id: true,
              date: true,
              name: true,
              recurring: true,
            },
          },
        },
      },
    },
  })

  if (!project) notFound()

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const inThreeMonths = new Date(today)
  inThreeMonths.setUTCMonth(inThreeMonths.getUTCMonth() + 3)

  const team = await prisma.user.findMany({
    where: {
      OR: [
        { tasks: { some: { projectId } } },
        { projectAssignments: { some: { projectId } } },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      availabilities: {
        where: {
          endDate: { gte: today },
          startDate: { lte: inThreeMonths },
        },
        orderBy: { startDate: 'asc' },
        select: {
          id: true,
          startDate: true,
          endDate: true,
          reason: true,
          reducedHoursPercent: true,
          notes: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <Link
            href={`/projects/${project.id}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> {project.name}
          </Link>
          <h1 className="mt-1 inline-flex items-center gap-2 text-xl font-bold text-foreground">
            <CalendarIcon className="h-5 w-5 text-indigo-400" />
            Calendario laboral
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Holidays del proyecto + agenda de no-disponibilidad del equipo
            (vacaciones, training, jornadas reducidas).
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <CalendarManagerClient
          projectId={project.id}
          calendar={
            project.calendar
              ? {
                  id: project.calendar.id,
                  name: project.calendar.name,
                  workdays: project.calendar.workdays,
                  workdayHours: Number(project.calendar.workdayHours),
                  holidays: project.calendar.holidays.map((h) => ({
                    id: h.id,
                    date: h.date.toISOString(),
                    name: h.name,
                    recurring: h.recurring,
                  })),
                }
              : null
          }
          team={team.map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            availabilities: u.availabilities.map((a) => ({
              id: a.id,
              startDate: a.startDate.toISOString(),
              endDate: a.endDate.toISOString(),
              reason: a.reason,
              reducedHoursPercent: a.reducedHoursPercent,
              notes: a.notes,
            })),
          }))}
        />
      </div>
    </div>
  )
}
