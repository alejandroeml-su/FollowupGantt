/**
 * Ola P7 · Equipo P7-4 · Daily Standup — Tests del builder de contexto.
 *
 * Stubea Prisma (sólo `task`, `comment`, `project`) para que el builder
 * funcione sin BD real. Cubre:
 *   - Bucketing yesterday / today / blockers.
 *   - Reasons NO_ASSIGNEE, OVERDUE, BROKEN_DEPENDENCY, STALE.
 *   - Hitos próximos en today.
 *   - Sort estable por endDate.
 *   - User scope con collaborators.
 *   - Validación de input.
 */

import { describe, it, expect } from 'vitest'
import {
  buildProjectStandupContext,
  buildUserStandupContext,
  type StandupTaskSnapshot,
} from '@/lib/ai/standup/build-standup-context'

const NOW = new Date('2026-05-04T12:00:00Z')
const YESTERDAY = new Date('2026-05-03T20:00:00Z')
const TWO_DAYS_AGO = new Date('2026-05-02T08:00:00Z')
const TEN_DAYS_AGO = new Date('2026-04-24T12:00:00Z')
const TOMORROW = new Date('2026-05-05T12:00:00Z')
const NEXT_WEEK = new Date('2026-05-08T12:00:00Z')

interface Project {
  id: string
  name: string
}
interface User {
  id: string
  name: string | null
  email: string | null
}
interface RawTask {
  id: string
  title: string
  status: 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE'
  progress: number
  endDate: Date | null
  isMilestone: boolean
  archivedAt: Date | null
  assigneeId: string | null
  updatedAt: Date
  projectId: string
  predecessors: Array<{
    predecessor: {
      id: string
      status: 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE'
      endDate: Date | null
    }
  }>
  collaborators?: Array<{ userId: string }>
}

function makeStub({
  projects,
  users,
  tasks,
  comments = [],
}: {
  projects: Project[]
  users: User[]
  tasks: RawTask[]
  comments?: Array<{
    id: string
    createdAt: Date
    authorId: string | null
    taskId: string
  }>
}) {
  function findUser(id: string | null): User | null {
    if (!id) return null
    return users.find((u) => u.id === id) ?? null
  }
  function findProject(id: string): Project | null {
    return projects.find((p) => p.id === id) ?? null
  }
  function buildIncluded(t: RawTask): Record<string, unknown> {
    const assignee = findUser(t.assigneeId)
    const project = findProject(t.projectId)
    return {
      ...t,
      assignee: assignee
        ? { id: assignee.id, name: assignee.name, email: assignee.email }
        : null,
      project: project ? { id: project.id, name: project.name } : null,
    }
  }

  return {
    project: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        return findProject(where.id)
      },
    },
    task: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        let filtered = tasks.filter((t) => t.archivedAt === null)
        if (where.projectId) {
          filtered = filtered.filter((t) => t.projectId === where.projectId)
        }
        if (where.OR) {
          const or = where.OR as Array<Record<string, unknown>>
          filtered = filtered.filter((t) =>
            or.some((cond) => {
              if ('assigneeId' in cond) return t.assigneeId === cond.assigneeId
              if (cond.collaborators) {
                const collabFilter = cond.collaborators as {
                  some: { userId: string }
                }
                return (t.collaborators ?? []).some(
                  (c) => c.userId === collabFilter.some.userId,
                )
              }
              return false
            }),
          )
        }
        return filtered.map(buildIncluded)
      },
    },
    comment: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        const since = (where.createdAt as { gte: Date } | undefined)?.gte
        let filtered = comments
        if (since) filtered = filtered.filter((c) => c.createdAt >= since)
        if (where.authorId) {
          filtered = filtered.filter((c) => c.authorId === where.authorId)
        }
        if (where.task) {
          const tw = where.task as { projectId?: string }
          if (tw.projectId) {
            const taskIds = new Set(
              tasks.filter((t) => t.projectId === tw.projectId).map((t) => t.id),
            )
            filtered = filtered.filter((c) => taskIds.has(c.taskId))
          }
        }
        return filtered.map((c) => {
          const task = tasks.find((t) => t.id === c.taskId)
          const author = findUser(c.authorId)
          return {
            id: c.id,
            createdAt: c.createdAt,
            author: author
              ? { name: author.name, email: author.email }
              : null,
            task: { id: c.taskId, title: task?.title ?? '?' },
          }
        })
      },
    },
  }
}

const ALICE = { id: 'u-alice', name: 'Alice', email: 'alice@x.com' }
const BOB = { id: 'u-bob', name: 'Bob', email: 'bob@x.com' }
const PROJECT = { id: 'p1', name: 'Operación X' }

function task(partial: Partial<RawTask>): RawTask {
  return {
    id: partial.id ?? 't',
    title: partial.title ?? 'Task',
    status: partial.status ?? 'TODO',
    progress: partial.progress ?? 0,
    endDate: partial.endDate ?? null,
    isMilestone: partial.isMilestone ?? false,
    archivedAt: partial.archivedAt ?? null,
    assigneeId: partial.assigneeId ?? null,
    updatedAt: partial.updatedAt ?? NOW,
    projectId: partial.projectId ?? 'p1',
    predecessors: partial.predecessors ?? [],
    collaborators: partial.collaborators,
  }
}

function names(snapshots: StandupTaskSnapshot[]): string[] {
  return snapshots.map((s) => s.title)
}

// ────────────────────────── Tests ──────────────────────────────────────

describe('buildProjectStandupContext · bucketing', () => {
  it('coloca DONE updated en últimas 24h en yesterday', async () => {
    const stub = makeStub({
      projects: [PROJECT],
      users: [ALICE],
      tasks: [
        task({
          id: 't1',
          title: 'Cerrar QA',
          status: 'DONE',
          assigneeId: 'u-alice',
          updatedAt: YESTERDAY,
        }),
      ],
    })
    const ctx = await buildProjectStandupContext('p1', { now: NOW, prisma: stub as never })
    expect(names(ctx.yesterday)).toEqual(['Cerrar QA'])
    expect(ctx.today).toEqual([])
    expect(ctx.blockers).toEqual([])
  })

  it('coloca IN_PROGRESS en today con assignee', async () => {
    const stub = makeStub({
      projects: [PROJECT],
      users: [ALICE],
      tasks: [
        task({
          id: 't2',
          title: 'Implementar API',
          status: 'IN_PROGRESS',
          assigneeId: 'u-alice',
          endDate: NEXT_WEEK,
        }),
      ],
    })
    const ctx = await buildProjectStandupContext('p1', { now: NOW, prisma: stub as never })
    expect(names(ctx.today)).toEqual(['Implementar API'])
    expect(ctx.blockers).toEqual([])
  })

  it('detecta NO_ASSIGNEE como blocker antes que OVERDUE', async () => {
    const stub = makeStub({
      projects: [PROJECT],
      users: [ALICE],
      tasks: [
        task({
          id: 't3',
          title: 'Sin dueño',
          status: 'TODO',
          assigneeId: null,
          endDate: TWO_DAYS_AGO,
        }),
      ],
    })
    const ctx = await buildProjectStandupContext('p1', { now: NOW, prisma: stub as never })
    expect(ctx.blockers).toHaveLength(1)
    expect(ctx.blockers[0].blockerReason).toBe('NO_ASSIGNEE')
  })

  it('detecta OVERDUE para task con assignee y endDate pasado', async () => {
    const stub = makeStub({
      projects: [PROJECT],
      users: [ALICE],
      tasks: [
        task({
          id: 't4',
          title: 'Tarea atrasada',
          status: 'IN_PROGRESS',
          assigneeId: 'u-alice',
          endDate: TWO_DAYS_AGO,
        }),
      ],
    })
    const ctx = await buildProjectStandupContext('p1', { now: NOW, prisma: stub as never })
    expect(ctx.blockers).toHaveLength(1)
    expect(ctx.blockers[0].blockerReason).toBe('OVERDUE')
  })

  it('detecta BROKEN_DEPENDENCY cuando un predecessor no DONE ya venció', async () => {
    const stub = makeStub({
      projects: [PROJECT],
      users: [ALICE],
      tasks: [
        task({
          id: 't5',
          title: 'Sucesor',
          status: 'IN_PROGRESS',
          assigneeId: 'u-alice',
          endDate: NEXT_WEEK,
          predecessors: [
            {
              predecessor: {
                id: 'pred',
                status: 'IN_PROGRESS',
                endDate: TWO_DAYS_AGO,
              },
            },
          ],
        }),
      ],
    })
    const ctx = await buildProjectStandupContext('p1', { now: NOW, prisma: stub as never })
    expect(ctx.blockers).toHaveLength(1)
    expect(ctx.blockers[0].blockerReason).toBe('BROKEN_DEPENDENCY')
  })

  it('detecta STALE para IN_PROGRESS sin updates en 7+ días', async () => {
    const stub = makeStub({
      projects: [PROJECT],
      users: [ALICE],
      tasks: [
        task({
          id: 't6',
          title: 'Olvidada',
          status: 'IN_PROGRESS',
          assigneeId: 'u-alice',
          endDate: NEXT_WEEK,
          updatedAt: TEN_DAYS_AGO,
        }),
      ],
    })
    const ctx = await buildProjectStandupContext('p1', { now: NOW, prisma: stub as never })
    expect(ctx.blockers).toHaveLength(1)
    expect(ctx.blockers[0].blockerReason).toBe('STALE')
  })

  it('mete hito próximo (TODO) en today + upcomingMilestones', async () => {
    const stub = makeStub({
      projects: [PROJECT],
      users: [ALICE],
      tasks: [
        task({
          id: 't7',
          title: 'Cierre fase 1',
          status: 'TODO',
          assigneeId: 'u-alice',
          endDate: TOMORROW,
          isMilestone: true,
        }),
      ],
    })
    const ctx = await buildProjectStandupContext('p1', { now: NOW, prisma: stub as never })
    expect(names(ctx.today)).toEqual(['Cierre fase 1'])
    expect(ctx.meta.upcomingMilestones).toHaveLength(1)
    expect(ctx.meta.upcomingMilestones[0].title).toBe('Cierre fase 1')
  })

  it('excluye archived y proyectos distintos', async () => {
    const stub = makeStub({
      projects: [PROJECT, { id: 'p2', name: 'Otro' }],
      users: [ALICE],
      tasks: [
        task({
          id: 'a',
          title: 'Archivada',
          status: 'IN_PROGRESS',
          assigneeId: 'u-alice',
          archivedAt: NOW,
        }),
        task({
          id: 'b',
          title: 'Otro proyecto',
          status: 'IN_PROGRESS',
          assigneeId: 'u-alice',
          projectId: 'p2',
        }),
      ],
    })
    const ctx = await buildProjectStandupContext('p1', { now: NOW, prisma: stub as never })
    expect(ctx.today).toEqual([])
    expect(ctx.blockers).toEqual([])
  })

  it('ordena tasks por endDate ASC con desempate por título', async () => {
    const stub = makeStub({
      projects: [PROJECT],
      users: [ALICE],
      tasks: [
        task({
          id: 'b',
          title: 'Beta',
          status: 'IN_PROGRESS',
          assigneeId: 'u-alice',
          endDate: new Date('2026-05-10T00:00:00Z'),
        }),
        task({
          id: 'a',
          title: 'Alpha',
          status: 'IN_PROGRESS',
          assigneeId: 'u-alice',
          endDate: new Date('2026-05-06T00:00:00Z'),
        }),
        task({
          id: 'c',
          title: 'Gamma',
          status: 'IN_PROGRESS',
          assigneeId: 'u-alice',
          endDate: new Date('2026-05-06T00:00:00Z'),
        }),
      ],
    })
    const ctx = await buildProjectStandupContext('p1', { now: NOW, prisma: stub as never })
    expect(names(ctx.today)).toEqual(['Alpha', 'Gamma', 'Beta'])
  })

  it('captura participantes únicos a partir de assignees', async () => {
    const stub = makeStub({
      projects: [PROJECT],
      users: [ALICE, BOB],
      tasks: [
        task({
          id: '1',
          status: 'IN_PROGRESS',
          assigneeId: 'u-alice',
        }),
        task({
          id: '2',
          status: 'IN_PROGRESS',
          assigneeId: 'u-bob',
        }),
        task({
          id: '3',
          status: 'IN_PROGRESS',
          assigneeId: 'u-alice',
        }),
      ],
    })
    const ctx = await buildProjectStandupContext('p1', { now: NOW, prisma: stub as never })
    expect(ctx.meta.participants.sort()).toEqual(['Alice', 'Bob'])
  })

  it('lanza [NOT_FOUND] si el proyecto no existe', async () => {
    const stub = makeStub({ projects: [], users: [], tasks: [] })
    await expect(
      buildProjectStandupContext('missing', { now: NOW, prisma: stub as never }),
    ).rejects.toThrow(/\[NOT_FOUND\]/)
  })

  it('lanza [INVALID_INPUT] si projectId vacío', async () => {
    await expect(buildProjectStandupContext('')).rejects.toThrow(
      /\[INVALID_INPUT\]/,
    )
  })

  it('expone recentComments dentro de la ventana', async () => {
    const stub = makeStub({
      projects: [PROJECT],
      users: [ALICE],
      tasks: [task({ id: 't1', title: 'Tarea con comentario', status: 'IN_PROGRESS', assigneeId: 'u-alice' })],
      comments: [
        { id: 'c1', createdAt: YESTERDAY, authorId: 'u-alice', taskId: 't1' },
        // Fuera de ventana (hace 3 días).
        { id: 'c2', createdAt: new Date('2026-05-01T00:00:00Z'), authorId: 'u-alice', taskId: 't1' },
      ],
    })
    const ctx = await buildProjectStandupContext('p1', { now: NOW, prisma: stub as never })
    expect(ctx.recentComments).toHaveLength(1)
    expect(ctx.recentComments[0].id).toBe('c1')
  })
})

describe('buildUserStandupContext', () => {
  it('agrega tasks como assignee', async () => {
    const stub = makeStub({
      projects: [PROJECT],
      users: [ALICE],
      tasks: [
        task({
          id: 't1',
          title: 'Mía',
          status: 'IN_PROGRESS',
          assigneeId: 'u-alice',
        }),
      ],
    })
    const ctx = await buildUserStandupContext('u-alice', {
      now: NOW,
      prisma: stub as never,
    })
    expect(ctx.scope).toBe('user')
    expect(names(ctx.today)).toEqual(['Mía'])
  })

  it('incluye tasks como collaborator', async () => {
    const stub = makeStub({
      projects: [PROJECT],
      users: [ALICE, BOB],
      tasks: [
        task({
          id: 't2',
          title: 'Compartida',
          status: 'IN_PROGRESS',
          assigneeId: 'u-bob',
          collaborators: [{ userId: 'u-alice' }],
        }),
      ],
    })
    const ctx = await buildUserStandupContext('u-alice', {
      now: NOW,
      prisma: stub as never,
    })
    expect(names(ctx.today)).toEqual(['Compartida'])
  })

  it('lanza [INVALID_INPUT] si userId vacío', async () => {
    await expect(buildUserStandupContext('')).rejects.toThrow(
      /\[INVALID_INPUT\]/,
    )
  })
})
