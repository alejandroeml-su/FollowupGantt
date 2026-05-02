import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * HU-4.1 · Tests de la server action `importMspXml`.
 *
 * Estrategia (igual que `import-excel-action.test.ts`):
 *   - mockeamos `@/lib/prisma`, `next/cache`, `@/lib/scheduling/invalidate`
 *     y `@/lib/scheduling/validate` (para D15 — slack negativo no
 *     bloquea import).
 *   - Construimos XMLs sintéticos in-line (helper local).
 *
 * Cubre:
 *   1. Import OK con 3 tasks + 2 deps.
 *   2. File >5 MB → FILE_TOO_LARGE.
 *   3. mode='replace' borra existentes y crea nuevas en transacción.
 *   4. Resource sin email → warning RESOURCE_NO_MATCH (no aborta).
 *   5. NEGATIVE_FLOAT_POST_IMPORT incluido (no aborta — D15).
 *   6. Errores de parser → no toca BD (transaction no se llama).
 */

const projectFindUnique = vi.fn()
const userFindMany = vi.fn(async () => [] as Array<{ id: string; email: string }>)
const taskFindMany = vi.fn(async () => [] as Array<{ id: string }>)
const taskDeleteMany = vi.fn(async () => ({ count: 0 }))
const depDeleteMany = vi.fn(async () => ({ count: 0 }))
const taskCreate = vi.fn(async () => ({ id: 'task-id' }))
const depCreate = vi.fn(async () => ({ id: 'dep-id' }))

interface MockTx {
  task: {
    findMany: typeof taskFindMany
    deleteMany: typeof taskDeleteMany
    create: typeof taskCreate
  }
  taskDependency: {
    deleteMany: typeof depDeleteMany
    create: typeof depCreate
  }
}

const transactionFn = vi.fn(async (cb: (tx: MockTx) => Promise<unknown>) => {
  const tx: MockTx = {
    task: {
      findMany: taskFindMany,
      deleteMany: taskDeleteMany,
      create: taskCreate,
    },
    taskDependency: {
      deleteMany: depDeleteMany,
      create: depCreate,
    },
  }
  return cb(tx)
})

vi.mock('@/lib/prisma', () => ({
  default: {
    project: {
      findUnique: (...args: unknown[]) => projectFindUnique(...args),
    },
    user: {
      findMany: (...args: unknown[]) => userFindMany(...args),
    },
    task: {
      findMany: (...args: unknown[]) => taskFindMany(...args),
      deleteMany: (...args: unknown[]) => taskDeleteMany(...args),
      create: (...args: unknown[]) => taskCreate(...args),
    },
    taskDependency: {
      deleteMany: (...args: unknown[]) => depDeleteMany(...args),
      create: (...args: unknown[]) => depCreate(...args),
    },
    $transaction: (cb: (tx: MockTx) => Promise<unknown>) => transactionFn(cb),
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/lib/scheduling/invalidate', () => ({
  invalidateCpmCache: vi.fn(),
}))

const validateProjectSchedule = vi.fn(async () => ({
  ok: true,
  negativeFloatTasks: [] as Array<{ taskId: string; float: number }>,
  newCycles: [] as string[][],
}))

vi.mock('@/lib/scheduling/validate', () => ({
  validateProjectSchedule: (...args: unknown[]) =>
    validateProjectSchedule(...(args as [])),
}))

beforeEach(() => {
  projectFindUnique.mockReset()
  userFindMany.mockReset()
  taskFindMany.mockReset()
  taskDeleteMany.mockClear()
  depDeleteMany.mockClear()
  taskCreate.mockClear()
  depCreate.mockClear()
  transactionFn.mockClear()
  validateProjectSchedule.mockClear()
  userFindMany.mockResolvedValue([])
  taskFindMany.mockResolvedValue([])
  validateProjectSchedule.mockResolvedValue({
    ok: true,
    negativeFloatTasks: [],
    newCycles: [],
  })
})

const MSP_NS = 'http://schemas.microsoft.com/project'

interface FxTask {
  uid: number
  name: string
  outline: string
  pred?: number
  type?: 0 | 1 | 2 | 3
  linkLag?: number
}

function buildXml(input: {
  title?: string
  tasks: FxTask[]
  resources?: Array<{
    uid: number
    name: string
    email?: string
    type?: number
  }>
  assignments?: Array<{ taskUid: number; resourceUid: number }>
}): string {
  const tasksXml = input.tasks
    .map((t) => {
      const link = t.pred
        ? `      <PredecessorLink>
        <PredecessorUID>${t.pred}</PredecessorUID>
        <Type>${t.type ?? 1}</Type>
        <LinkLag>${t.linkLag ?? 0}</LinkLag>
      </PredecessorLink>`
        : ''
      return `    <Task>
      <UID>${t.uid}</UID>
      <ID>${t.uid}</ID>
      <Name>${t.name}</Name>
      <Start>2026-05-04T08:00:00</Start>
      <Finish>2026-05-08T17:00:00</Finish>
      <OutlineNumber>${t.outline}</OutlineNumber>
      <OutlineLevel>${t.outline.split('.').length}</OutlineLevel>
${link}
    </Task>`
    })
    .join('\n')
  const resourcesXml = (input.resources ?? [])
    .map(
      (r) => `    <Resource>
      <UID>${r.uid}</UID>
      <Name>${r.name}</Name>
      ${r.email ? `<EmailAddress>${r.email}</EmailAddress>` : ''}
      <Type>${r.type ?? 1}</Type>
    </Resource>`,
    )
    .join('\n')
  const assignmentsXml = (input.assignments ?? [])
    .map(
      (a, i) => `    <Assignment>
      <UID>${i + 1}</UID>
      <TaskUID>${a.taskUid}</TaskUID>
      <ResourceUID>${a.resourceUid}</ResourceUID>
    </Assignment>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="${MSP_NS}">
  <Title>${input.title ?? 'Test'}</Title>
  <Tasks>
${tasksXml}
  </Tasks>
  <Resources>
${resourcesXml}
  </Resources>
  <Assignments>
${assignmentsXml}
  </Assignments>
</Project>`
}

function xmlToBase64(xml: string): string {
  return Buffer.from(xml, 'utf-8').toString('base64')
}

// ───────────────────────── Tests ─────────────────────────

describe('importMspXml', () => {
  it(
    'import OK con 3 tasks + 2 deps en transacción replace',
    { timeout: 30_000 },
    async () => {
      const { importMspXml } = await import(
        '@/lib/actions/import-export-msp'
      )
      projectFindUnique.mockResolvedValue({ id: 'p1' })
      userFindMany.mockResolvedValue([])
      // Hay tareas previas → se borran.
      taskFindMany.mockResolvedValue([{ id: 'old-1' }, { id: 'old-2' }])
      taskDeleteMany.mockResolvedValue({ count: 2 })
      depDeleteMany.mockResolvedValue({ count: 1 })

      const xml = buildXml({
        tasks: [
          { uid: 1, name: 'A', outline: '1' },
          { uid: 2, name: 'B', outline: '2', pred: 1, type: 1 },
          { uid: 3, name: 'C', outline: '3', pred: 2, type: 1 },
        ],
      })

      const result = await importMspXml({
        fileBase64: xmlToBase64(xml),
        filename: 'test.xml',
        projectId: 'p1',
        mode: 'replace',
      })

      expect(result.ok).toBe(true)
      expect(transactionFn).toHaveBeenCalledTimes(1)
      expect(taskDeleteMany).toHaveBeenCalledTimes(1)
      expect(depDeleteMany).toHaveBeenCalledTimes(1)
      expect(taskCreate).toHaveBeenCalledTimes(3)
      expect(depCreate).toHaveBeenCalledTimes(2)
      expect(result.counts?.tasksCreated).toBe(3)
      expect(result.counts?.depsCreated).toBe(2)
      expect(result.counts?.tasksDeleted).toBe(2)
    },
  )

  it('archivo > 5 MB → FILE_TOO_LARGE (no toca BD)', async () => {
    const { importMspXml } = await import(
      '@/lib/actions/import-export-msp'
    )
    projectFindUnique.mockResolvedValue({ id: 'p1' })

    // 6 MB de bytes en base64 (cada 3 bytes binarios = 4 chars b64).
    const huge = Buffer.alloc(6 * 1024 * 1024 + 10)
    const result = await importMspXml({
      fileBase64: huge.toString('base64'),
      filename: 'big.xml',
      projectId: 'p1',
    })

    expect(result.ok).toBe(false)
    expect(result.errors?.[0]?.code).toBe('FILE_TOO_LARGE')
    expect(transactionFn).not.toHaveBeenCalled()
  })

  it('Resource sin email → warning RESOURCE_NO_MATCH (no aborta)', async () => {
    const { importMspXml } = await import(
      '@/lib/actions/import-export-msp'
    )
    projectFindUnique.mockResolvedValue({ id: 'p1' })

    const xml = buildXml({
      tasks: [{ uid: 1, name: 'A', outline: '1' }],
      resources: [{ uid: 10, name: 'Alguien' }],
      assignments: [{ taskUid: 1, resourceUid: 10 }],
    })

    const result = await importMspXml({
      fileBase64: xmlToBase64(xml),
      filename: 'msp.xml',
      projectId: 'p1',
    })
    expect(result.ok).toBe(true)
    expect(
      result.warnings?.some((w) => w.code === 'RESOURCE_NO_MATCH'),
    ).toBe(true)
    expect(taskCreate).toHaveBeenCalledTimes(1)
  })

  it('NEGATIVE_FLOAT_POST_IMPORT se emite si validate detecta slack negativo (D15)', async () => {
    const { importMspXml } = await import(
      '@/lib/actions/import-export-msp'
    )
    projectFindUnique.mockResolvedValue({ id: 'p1' })
    validateProjectSchedule.mockResolvedValue({
      ok: false,
      negativeFloatTasks: [{ taskId: 'x', float: -2 }],
      newCycles: [],
    })

    const xml = buildXml({
      tasks: [
        { uid: 1, name: 'A', outline: '1' },
        { uid: 2, name: 'B', outline: '2', pred: 1, linkLag: -9600 },
      ],
    })

    const result = await importMspXml({
      fileBase64: xmlToBase64(xml),
      filename: 'msp.xml',
      projectId: 'p1',
    })

    expect(result.ok).toBe(true)
    expect(
      result.warnings?.some((w) => w.code === 'NEGATIVE_FLOAT_POST_IMPORT'),
    ).toBe(true)
    expect(taskCreate).toHaveBeenCalled()
  })

  it('archivo con namespace inválido (parser error) → no toca BD', async () => {
    const { importMspXml } = await import(
      '@/lib/actions/import-export-msp'
    )
    projectFindUnique.mockResolvedValue({ id: 'p1' })

    const badXml = '<?xml version="1.0"?><Project><Tasks/></Project>'
    const result = await importMspXml({
      fileBase64: Buffer.from(badXml, 'utf-8').toString('base64'),
      filename: 'bad.xml',
      projectId: 'p1',
    })

    expect(result.ok).toBe(false)
    expect(result.errors?.some((e) => e.code === 'INVALID_FILE')).toBe(true)
    expect(transactionFn).not.toHaveBeenCalled()
    expect(taskCreate).not.toHaveBeenCalled()
  })

  it('input inválido (sin fileBase64) → INVALID_INPUT', async () => {
    const { importMspXml } = await import(
      '@/lib/actions/import-export-msp'
    )
    const result = await importMspXml({
      fileBase64: '',
      filename: 'x.xml',
      projectId: '',
    })
    expect(result.ok).toBe(false)
    expect(result.errors?.[0]?.code).toBe('INVALID_INPUT')
  })
})
