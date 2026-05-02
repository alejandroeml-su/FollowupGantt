import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildExcelWorkbook, type ExportTasksRow } from '@/lib/import-export/excel-writer'

/**
 * HU-4.2 · Tests de la server action `importExcel` y `buildImportPreview`.
 *
 * Estrategia: mockeamos `@/lib/prisma`, `next/cache` y
 * `@/lib/scheduling/invalidate`. Verificamos:
 *   1. Preview con archivo válido → ok=true + counts correctos.
 *   2. Preview proyecto inexistente → NOT_FOUND.
 *   3. Preview archivo > 5MB → FILE_TOO_LARGE.
 *   4. Import all-or-nothing replace borra y reescribe en transacción.
 *   5. Email sin match → warning RESOURCE_NO_MATCH.
 *   6. Import con errores del parser → no toca BD.
 */

const projectFindUnique = vi.fn()
const userFindMany = vi.fn(async () => [])
const taskFindMany = vi.fn(async () => [])
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

beforeEach(() => {
  projectFindUnique.mockReset()
  userFindMany.mockReset()
  taskFindMany.mockReset()
  taskDeleteMany.mockClear()
  depDeleteMany.mockClear()
  taskCreate.mockClear()
  depCreate.mockClear()
  transactionFn.mockClear()
  userFindMany.mockResolvedValue([])
  taskFindMany.mockResolvedValue([])
})

const TASK_BASE: ExportTasksRow = {
  mnemonic: 'A-1',
  title: 'Tarea uno',
  parent_mnemonic: null,
  start_date: new Date('2026-05-04T00:00:00.000Z'),
  end_date: new Date('2026-05-08T00:00:00.000Z'),
  duration_days: 5,
  is_milestone: false,
  progress: 0,
  priority: 'MEDIUM',
  assignee_email: 'a@x.com',
  tags: '',
  description: null,
}

async function buildBufferBase64(input: {
  tasks: ExportTasksRow[]
  deps?: Array<{
    predecessor_mnemonic: string
    successor_mnemonic: string
    type: 'FS' | 'SS' | 'FF' | 'SF'
    lag_days: number
  }>
}): Promise<{ base64: string; buffer: Buffer }> {
  const buf = await buildExcelWorkbook({
    tasks: input.tasks,
    deps: input.deps ?? [],
    resources: [],
    projectName: 'Test',
  })
  const buffer = Buffer.from(buf)
  return { buffer, base64: buffer.toString('base64') }
}

describe('buildImportPreview', () => {
  // Primer test del módulo: incluye el cold-load de imports pesados
  // (exceljs, parser, prisma mock). Damos margen extra.
  it('retorna ok + counts cuando el archivo es válido', { timeout: 30_000 }, async () => {
    const { buildImportPreview } = await import('@/lib/actions/import-export')
    projectFindUnique.mockResolvedValue({ id: 'p1' })
    userFindMany.mockResolvedValue([{ id: 'u1', email: 'a@x.com' }])

    const { buffer } = await buildBufferBase64({
      tasks: [
        TASK_BASE,
        { ...TASK_BASE, mnemonic: 'A-2', title: 'Tarea dos', parent_mnemonic: 'A-1' },
      ],
      deps: [
        {
          predecessor_mnemonic: 'A-1',
          successor_mnemonic: 'A-2',
          type: 'FS',
          lag_days: 0,
        },
      ],
    })

    const result = await buildImportPreview({ buffer, projectId: 'p1' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.counts.tasks).toBe(2)
    expect(result.counts.deps).toBe(1)
    expect(result.counts.matchedUsers).toBe(1)
    expect(result.counts.unmatchedEmails).toEqual([])
  })

  it('proyecto inexistente → NOT_FOUND', async () => {
    const { buildImportPreview } = await import('@/lib/actions/import-export')
    projectFindUnique.mockResolvedValue(null)

    const { buffer } = await buildBufferBase64({ tasks: [TASK_BASE] })
    const result = await buildImportPreview({ buffer, projectId: 'ghost' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0].code).toBe('NOT_FOUND')
  })

  it('email sin match → warning RESOURCE_NO_MATCH', async () => {
    const { buildImportPreview } = await import('@/lib/actions/import-export')
    projectFindUnique.mockResolvedValue({ id: 'p1' })
    userFindMany.mockResolvedValue([]) // nadie matchea

    const { buffer } = await buildBufferBase64({ tasks: [TASK_BASE] })
    const result = await buildImportPreview({ buffer, projectId: 'p1' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.some((w) => w.code === 'RESOURCE_NO_MATCH')).toBe(true)
    expect(result.counts.unmatchedEmails).toContain('a@x.com')
  })

  it('archivo > 5 MB → FILE_TOO_LARGE', async () => {
    const { buildImportPreview } = await import('@/lib/actions/import-export')
    projectFindUnique.mockResolvedValue({ id: 'p1' })
    const huge = Buffer.alloc(6 * 1024 * 1024 + 10)
    const result = await buildImportPreview({ buffer: huge, projectId: 'p1' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0].code).toBe('FILE_TOO_LARGE')
  })
})

describe('importExcel · transacción y replace', () => {
  it('replace borra existentes y crea nuevas dentro de $transaction', async () => {
    const { importExcel } = await import('@/lib/actions/import-export')
    projectFindUnique.mockResolvedValue({ id: 'p1' })
    userFindMany.mockResolvedValue([{ id: 'u1', email: 'a@x.com' }])
    // Existen 2 tareas previas que serán borradas.
    taskFindMany.mockResolvedValue([{ id: 'old-1' }, { id: 'old-2' }])
    taskDeleteMany.mockResolvedValue({ count: 2 })
    depDeleteMany.mockResolvedValue({ count: 1 })

    const { base64 } = await buildBufferBase64({
      tasks: [
        TASK_BASE,
        { ...TASK_BASE, mnemonic: 'A-2', parent_mnemonic: 'A-1' },
      ],
      deps: [
        {
          predecessor_mnemonic: 'A-1',
          successor_mnemonic: 'A-2',
          type: 'FS',
          lag_days: 0,
        },
      ],
    })

    const result = await importExcel({
      fileBase64: base64,
      filename: 'test.xlsx',
      projectId: 'p1',
      mode: 'replace',
    })

    expect(result.ok).toBe(true)
    expect(transactionFn).toHaveBeenCalledTimes(1)
    expect(taskDeleteMany).toHaveBeenCalledTimes(1)
    expect(depDeleteMany).toHaveBeenCalledTimes(1)
    expect(taskCreate).toHaveBeenCalledTimes(2)
    expect(depCreate).toHaveBeenCalledTimes(1)
    expect(result.counts).toEqual({
      tasksCreated: 2,
      depsCreated: 1,
      tasksDeleted: 2,
      depsDeleted: 1,
    })
  })

  it('archivo con errores del parser → no toca BD', async () => {
    const { importExcel } = await import('@/lib/actions/import-export')
    projectFindUnique.mockResolvedValue({ id: 'p1' })

    // Generar buffer con mnemonic duplicado
    const { base64 } = await buildBufferBase64({
      tasks: [TASK_BASE, { ...TASK_BASE, title: 'duplicado' }],
    })

    const result = await importExcel({
      fileBase64: base64,
      filename: 'bad.xlsx',
      projectId: 'p1',
    })

    expect(result.ok).toBe(false)
    expect(transactionFn).not.toHaveBeenCalled()
    expect(taskCreate).not.toHaveBeenCalled()
    if (result.ok) return
    expect(result.errors?.some((e) => e.code === 'DUPLICATE_MNEMONIC')).toBe(true)
  })

  it('input inválido (sin fileBase64) → INVALID_INPUT', async () => {
    const { importExcel } = await import('@/lib/actions/import-export')
    const result = await importExcel({
      fileBase64: '',
      filename: 'x.xlsx',
      projectId: '',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors?.[0]?.code).toBe('INVALID_INPUT')
  })
})
