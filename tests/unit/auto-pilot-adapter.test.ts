/**
 * Wave P20-C · Tests del adapter apply/rollback del Brain Auto-Pilot.
 *
 * Validamos que:
 *   - cada `applyOp` correcta produce su `rollbackOp` inversa
 *   - rollbackOp aplicada revierte la mutación al estado original
 *   - transacciones inyectables permiten testear sin Prisma real
 *
 * Mock estilo "in-memory store" para simular el comportamiento de
 * findUnique/update/create de los modelos involucrados sin dependencia
 * de la base.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { applyProposal, rollbackProposal } from '@/lib/brain/auto-pilot/adapter'
import type {
  AutoPilotOp,
  AutoPilotProposal,
} from '@/lib/brain/auto-pilot/types'

type TaskRow = { id: string; sprintId: string | null; assigneeId: string | null }
type SprintRow = { id: string; endDate: Date }
type TemplateRow = { id: string; name: string; kind: string; payload: unknown; workspaceId: string | null }

interface Store {
  tasks: Map<string, TaskRow>
  sprints: Map<string, SprintRow>
  templates: Map<string, TemplateRow>
}

function makeMockPrisma(store: Store) {
  const txClient = {
    task: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        store.tasks.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<TaskRow> }) => {
        const row = store.tasks.get(where.id)
        if (!row) throw new Error('task not found')
        const updated = { ...row, ...data }
        store.tasks.set(where.id, updated as TaskRow)
        return updated
      },
    },
    sprint: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        store.sprints.get(where.id) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string }
        data: { endDate?: Date }
      }) => {
        const row = store.sprints.get(where.id)
        if (!row) throw new Error('sprint not found')
        const updated = { ...row, ...data }
        store.sprints.set(where.id, updated as SprintRow)
        return updated
      },
    },
    globalTemplate: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        store.templates.get(where.id) ?? null,
      create: async ({ data }: { data: TemplateRow }) => {
        store.templates.set(data.id, data)
        return data
      },
      deleteMany: async ({ where }: { where: { id: string } }) => {
        store.templates.delete(where.id)
        return { count: 1 }
      },
    },
  }

  return {
    $transaction: async <T>(fn: (tx: typeof txClient) => Promise<T>) => fn(txClient),
  } as unknown as Parameters<typeof applyProposal>[1]['prisma'] extends infer T ? T : never
}

function proposalFromOps(
  ops: AutoPilotOp[],
  kind: AutoPilotProposal['kind'] = 'SPRINT_REBALANCE',
): AutoPilotProposal {
  return {
    id: 'p-test',
    kind,
    severity: 'MEDIUM',
    summary: 'test proposal',
    rationale: 'test rationale',
    preview: { before: {}, after: {} },
    applyOps: ops,
    confidence: 0.8,
  }
}

describe('auto-pilot adapter', () => {
  let store: Store

  beforeEach(() => {
    store = {
      tasks: new Map([
        ['t1', { id: 't1', sprintId: 'sA', assigneeId: 'uOld' }],
      ]),
      sprints: new Map([
        ['sA', { id: 'sA', endDate: new Date('2026-02-14T00:00:00Z') }],
      ]),
      templates: new Map(),
    }
  })

  it('aplica task.update y produce rollback que restaura el estado original', async () => {
    const prisma = makeMockPrisma(store)
    const proposal = proposalFromOps([
      { type: 'task.update', targetId: 't1', patch: { sprintId: 'sB', assigneeId: 'uNew' } },
    ])

    const { rollbackOps } = await applyProposal(proposal, { prisma: prisma as never })
    expect(store.tasks.get('t1')).toMatchObject({ sprintId: 'sB', assigneeId: 'uNew' })
    expect(rollbackOps).toHaveLength(1)
    expect(rollbackOps[0]).toMatchObject({
      type: 'task.update',
      targetId: 't1',
      patch: { sprintId: 'sA', assigneeId: 'uOld' },
    })

    await rollbackProposal(rollbackOps, { prisma: prisma as never })
    expect(store.tasks.get('t1')).toMatchObject({ sprintId: 'sA', assigneeId: 'uOld' })
  })

  it('aplica sprint.update y rollback restaura endDate original', async () => {
    const prisma = makeMockPrisma(store)
    const newDate = '2026-02-21T00:00:00.000Z'
    const proposal = proposalFromOps(
      [{ type: 'sprint.update', targetId: 'sA', patch: { endDate: newDate } }],
      'SPRINT_EXTENSION',
    )

    const { rollbackOps } = await applyProposal(proposal, { prisma: prisma as never })
    expect(store.sprints.get('sA')?.endDate.toISOString()).toBe(newDate)
    expect(rollbackOps[0]).toMatchObject({ type: 'sprint.update', targetId: 'sA' })

    await rollbackProposal(rollbackOps, { prisma: prisma as never })
    expect(store.sprints.get('sA')?.endDate.toISOString()).toBe('2026-02-14T00:00:00.000Z')
  })

  it('aplica workspace.upsert_global_template y rollback borra el template creado', async () => {
    const prisma = makeMockPrisma(store)
    const proposal = proposalFromOps(
      [
        {
          type: 'workspace.upsert_global_template',
          targetId: 'tpl-1',
          workspaceId: 'ws-1',
          payload: {
            name: 'Tpl',
            kind: 'DOR_DOD',
            body: { foo: 'bar' },
          },
        },
      ],
      'LESSON_PROMOTION',
    )

    const { rollbackOps } = await applyProposal(proposal, { prisma: prisma as never })
    expect(store.templates.has('tpl-1')).toBe(true)
    expect(rollbackOps).toHaveLength(1)

    await rollbackProposal(rollbackOps, { prisma: prisma as never })
    expect(store.templates.has('tpl-1')).toBe(false)
  })

  it('lanza AUTO_PILOT_TARGET_NOT_FOUND cuando la task del op no existe', async () => {
    const prisma = makeMockPrisma(store)
    const proposal = proposalFromOps([
      { type: 'task.update', targetId: 'no-such-task', patch: { sprintId: 'sX' } },
    ])
    await expect(
      applyProposal(proposal, { prisma: prisma as never }),
    ).rejects.toThrow(/AUTO_PILOT_TARGET_NOT_FOUND/)
  })
})
