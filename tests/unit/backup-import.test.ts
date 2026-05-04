import { describe, it, expect, vi } from 'vitest'
import JSZip from 'jszip'
import {
  importProjectFromZipBase64,
  readManifestFromZipBase64,
  type PrismaLikeForImport,
} from '@/lib/backup/import-project'
import {
  CURRENT_SCHEMA_VERSION,
  MANIFEST_FILENAME,
  ZIP_SIZE_LIMIT_BYTES,
} from '@/lib/backup/manifest-schema'

/**
 * P3-3 · Tests del motor de import full.
 *
 * Cubrimos:
 *   1. Manifest válido → readManifestFromZipBase64 lo regresa.
 *   2. ZIP sin manifest.json → [INVALID_ZIP].
 *   3. schemaVersion no soportado → [MANIFEST_VERSION].
 *   4. ZIP > 50MB → [FILE_TOO_LARGE].
 *   5. importProjectFromZipBase64 ejecuta TODO dentro de $transaction.
 *   6. UUIDs son regenerados (project.id de salida ≠ id del manifest).
 *   7. Tareas con parentId resuelto y deps con re-mapeo.
 *   8. assigneeEmail sin match → warning, tarea sin asignar.
 */

async function buildZipBase64(manifestObj: object): Promise<string> {
  const zip = new JSZip()
  zip.file(MANIFEST_FILENAME, JSON.stringify(manifestObj))
  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  return buf.toString('base64')
}

const BASE_PROJECT = {
  id: 'src-p1',
  name: 'Origen',
  description: null,
  status: 'ACTIVE',
  cpi: null,
  spi: null,
}

const BASE_MANIFEST = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  exportedAt: '2026-05-03T10:00:00.000Z',
  project: BASE_PROJECT,
  phases: [],
  sprints: [],
  columns: [],
  tasks: [],
  dependencies: [],
  baselines: [],
  comments: [],
  attachments: [],
  customFieldDefs: [],
  customFieldValues: [],
  mindMaps: [],
  timeEntries: [],
}

describe('readManifestFromZipBase64', () => {
  it('parsea ZIP válido', async () => {
    const b64 = await buildZipBase64(BASE_MANIFEST)
    const m = await readManifestFromZipBase64(b64)
    expect(m.project.id).toBe('src-p1')
    expect(m.schemaVersion).toBe(1)
  })

  it('ZIP sin manifest.json → [INVALID_ZIP]', async () => {
    const zip = new JSZip()
    zip.file('otro.txt', 'hola')
    const buf = await zip.generateAsync({ type: 'nodebuffer' })
    const b64 = buf.toString('base64')
    await expect(readManifestFromZipBase64(b64)).rejects.toThrow(/\[INVALID_ZIP\]/)
  })

  it('schemaVersion 99 → [MANIFEST_VERSION]', async () => {
    const b64 = await buildZipBase64({ ...BASE_MANIFEST, schemaVersion: 99 })
    await expect(readManifestFromZipBase64(b64)).rejects.toThrow(/\[MANIFEST_VERSION\]/)
  })

  it('payload > 50MB → [FILE_TOO_LARGE]', async () => {
    const huge = Buffer.alloc(ZIP_SIZE_LIMIT_BYTES + 100).toString('base64')
    await expect(readManifestFromZipBase64(huge)).rejects.toThrow(/\[FILE_TOO_LARGE\]/)
  })

  it('manifest malformado (faltando project) → [INVALID_MANIFEST]', async () => {
    const b64 = await buildZipBase64({
      schemaVersion: 1,
      exportedAt: '2026-05-03T10:00:00.000Z',
      // project ausente.
    })
    await expect(readManifestFromZipBase64(b64)).rejects.toThrow(
      /\[INVALID_MANIFEST\]/,
    )
  })
})

describe('importProjectFromZipBase64 · transacción + warnings', () => {
  function makePrismaMock(opts: {
    matchEmails?: string[]
  } = {}) {
    const matchSet = new Set(opts.matchEmails ?? [])
    const created = {
      project: [] as unknown[],
      task: [] as unknown[],
      taskDependency: [] as unknown[],
      phase: [] as unknown[],
      comment: [] as unknown[],
    }
    const txMock = {
      project: { create: vi.fn(async ({ data }: { data: unknown }) => { created.project.push(data); return { id: (data as { id: string }).id } }) },
      phase: { create: vi.fn(async ({ data }: { data: unknown }) => { created.phase.push(data); return data }) },
      sprint: { create: vi.fn(async ({ data }: { data: unknown }) => data) },
      boardColumn: { create: vi.fn(async ({ data }: { data: unknown }) => data) },
      task: { create: vi.fn(async ({ data }: { data: unknown }) => { created.task.push(data); return data }) },
      taskDependency: { create: vi.fn(async ({ data }: { data: unknown }) => { created.taskDependency.push(data); return data }) },
      baseline: { create: vi.fn(async ({ data }: { data: unknown }) => data) },
      comment: { create: vi.fn(async ({ data }: { data: unknown }) => { created.comment.push(data); return data }) },
      attachment: { create: vi.fn(async ({ data }: { data: unknown }) => data) },
      customFieldDef: { create: vi.fn(async ({ data }: { data: unknown }) => data) },
      customFieldValue: { create: vi.fn(async ({ data }: { data: unknown }) => data) },
      mindMap: { create: vi.fn(async ({ data }: { data: unknown }) => ({ id: (data as { id: string }).id })) },
      mindMapNode: { create: vi.fn(async ({ data }: { data: unknown }) => data) },
      mindMapEdge: { create: vi.fn(async ({ data }: { data: unknown }) => data) },
    }
    const $transaction = vi.fn(async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock))
    const prismaLike: PrismaLikeForImport = {
      user: {
        findMany: vi.fn(async ({ where }: { where: { email: { in: string[] } } }) => {
          const requested = where.email.in
          return requested
            .filter((e) => matchSet.has(e))
            .map((e) => ({ id: `u-${e}`, email: e }))
        }),
      },
      $transaction: $transaction as unknown as PrismaLikeForImport['$transaction'],
    }
    return { prismaLike, txMock, $transaction, created }
  }

  it('crea proyecto NUEVO con UUID distinto al manifest', async () => {
    const { prismaLike, txMock, created } = makePrismaMock()
    const b64 = await buildZipBase64(BASE_MANIFEST)
    const result = await importProjectFromZipBase64(prismaLike, b64)
    expect(result.projectId).not.toBe('src-p1')
    expect(txMock.project.create).toHaveBeenCalledTimes(1)
    expect((created.project[0] as { id: string }).id).toBe(result.projectId)
  })

  it('tareas con parentId quedan re-mapeadas', async () => {
    const manifest = {
      ...BASE_MANIFEST,
      tasks: [
        {
          id: 'src-t1',
          title: 'Padre',
          type: 'PMI_TASK',
          status: 'TODO',
          priority: 'MEDIUM',
          progress: 0,
          isMilestone: false,
          isEscalated: false,
          position: 1,
          tags: [],
        },
        {
          id: 'src-t2',
          parentId: 'src-t1',
          title: 'Hijo',
          type: 'PMI_TASK',
          status: 'TODO',
          priority: 'MEDIUM',
          progress: 0,
          isMilestone: false,
          isEscalated: false,
          position: 2,
          tags: [],
        },
      ],
      dependencies: [
        {
          id: 'src-d1',
          predecessorId: 'src-t1',
          successorId: 'src-t2',
          type: 'FINISH_TO_START',
          lagDays: 0,
        },
      ],
    }
    const { prismaLike, txMock, created } = makePrismaMock()
    const b64 = await buildZipBase64(manifest)
    const result = await importProjectFromZipBase64(prismaLike, b64)
    expect(result.warnings).toEqual([])
    expect(txMock.task.create).toHaveBeenCalledTimes(2)
    expect(txMock.taskDependency.create).toHaveBeenCalledTimes(1)
    // El parentId del hijo debe coincidir con el id del padre re-mapeado.
    const padre = created.task.find((t) => (t as { title: string }).title === 'Padre') as
      | { id: string }
      | undefined
    const hijo = created.task.find((t) => (t as { title: string }).title === 'Hijo') as
      | { id: string; parentId: string | null }
      | undefined
    expect(padre).toBeDefined()
    expect(hijo).toBeDefined()
    expect(hijo!.parentId).toBe(padre!.id)
    // El padre se inserta antes que el hijo (topo sort).
    const padreIdx = created.task.findIndex((t) => (t as { title: string }).title === 'Padre')
    const hijoIdx = created.task.findIndex((t) => (t as { title: string }).title === 'Hijo')
    expect(padreIdx).toBeLessThan(hijoIdx)
    // La dep también está re-mapeada.
    const dep = created.taskDependency[0] as { predecessorId: string; successorId: string }
    expect(dep.predecessorId).toBe(padre!.id)
    expect(dep.successorId).toBe(hijo!.id)
  })

  it('assignee sin match en BD genera warning y deja tarea sin asignar', async () => {
    const manifest = {
      ...BASE_MANIFEST,
      tasks: [
        {
          id: 'src-t1',
          title: 'Tarea sin assignee real',
          type: 'PMI_TASK',
          status: 'TODO',
          priority: 'MEDIUM',
          assigneeEmail: 'fantasma@x.com',
          progress: 0,
          isMilestone: false,
          isEscalated: false,
          position: 1,
          tags: [],
        },
      ],
    }
    const { prismaLike, created } = makePrismaMock({ matchEmails: [] })
    const b64 = await buildZipBase64(manifest)
    const result = await importProjectFromZipBase64(prismaLike, b64)
    expect(result.warnings.some((w) => w.includes('fantasma@x.com'))).toBe(true)
    const task = created.task[0] as { assigneeId: string | null }
    expect(task.assigneeId).toBeNull()
  })

  it('todo el pipeline corre dentro de $transaction (all-or-nothing)', async () => {
    const { prismaLike, $transaction } = makePrismaMock()
    const b64 = await buildZipBase64(BASE_MANIFEST)
    await importProjectFromZipBase64(prismaLike, b64)
    expect($transaction).toHaveBeenCalledTimes(1)
  })

  it('email match: assigneeId se resuelve correctamente', async () => {
    const manifest = {
      ...BASE_MANIFEST,
      tasks: [
        {
          id: 'src-t1',
          title: 'Tarea con assignee real',
          type: 'PMI_TASK',
          status: 'TODO',
          priority: 'MEDIUM',
          assigneeEmail: 'edwin@x.com',
          progress: 0,
          isMilestone: false,
          isEscalated: false,
          position: 1,
          tags: [],
        },
      ],
    }
    const { prismaLike, created } = makePrismaMock({
      matchEmails: ['edwin@x.com'],
    })
    const b64 = await buildZipBase64(manifest)
    const result = await importProjectFromZipBase64(prismaLike, b64)
    expect(result.warnings).toEqual([])
    const task = created.task[0] as { assigneeId: string | null }
    expect(task.assigneeId).toBe('u-edwin@x.com')
  })

  it('comments con authorEmail quedan re-mapeados al userId', async () => {
    const manifest = {
      ...BASE_MANIFEST,
      tasks: [
        {
          id: 'src-t1',
          title: 'T',
          type: 'PMI_TASK',
          status: 'TODO',
          priority: 'MEDIUM',
          progress: 0,
          isMilestone: false,
          isEscalated: false,
          position: 1,
          tags: [],
        },
      ],
      comments: [
        {
          id: 'src-c1',
          taskId: 'src-t1',
          content: 'Hola',
          isInternal: false,
          authorEmail: 'edwin@x.com',
          createdAt: '2026-05-01T00:00:00Z',
        },
      ],
    }
    const { prismaLike, created } = makePrismaMock({
      matchEmails: ['edwin@x.com'],
    })
    const b64 = await buildZipBase64(manifest)
    await importProjectFromZipBase64(prismaLike, b64)
    expect(created.comment).toHaveLength(1)
    const c = created.comment[0] as { taskId: string; authorId: string | null }
    expect(c.authorId).toBe('u-edwin@x.com')
    // taskId del comentario apunta al nuevo task.id
    const t = created.task[0] as { id: string }
    expect(c.taskId).toBe(t.id)
  })
})
