import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import {
  buildManifestFromDb,
  exportProjectFullToZip,
  type PrismaLikeForExport,
} from '@/lib/backup/export-project'
import {
  CURRENT_SCHEMA_VERSION,
  MANIFEST_FILENAME,
  manifestSchema,
} from '@/lib/backup/manifest-schema'

/**
 * P3-3 · Tests del builder de export full.
 *
 * Mockeamos solo la interfaz `PrismaLikeForExport` (no el cliente real).
 * Verificamos que:
 *   1. Proyecto inexistente lanza [NOT_FOUND].
 *   2. Manifest serializa todas las colecciones esperadas.
 *   3. ZIP generado contiene `manifest.json` válido contra zod.
 *   4. Tareas con assignee anidado se aplanan a `assigneeEmail`.
 *   5. Mind-map con nodes/edges sobrevive el roundtrip.
 */

function makePrismaMock(overrides: Partial<PrismaLikeForExport> = {}): PrismaLikeForExport {
  return {
    project: { findUnique: async () => null },
    phase: { findMany: async () => [] },
    sprint: { findMany: async () => [] },
    boardColumn: { findMany: async () => [] },
    task: { findMany: async () => [] },
    taskDependency: { findMany: async () => [] },
    baseline: { findMany: async () => [] },
    comment: { findMany: async () => [] },
    attachment: { findMany: async () => [] },
    customFieldDef: { findMany: async () => [] },
    customFieldValue: { findMany: async () => [] },
    mindMap: { findMany: async () => [] },
    ...overrides,
  } as PrismaLikeForExport
}

describe('buildManifestFromDb', () => {
  it('proyecto inexistente → [NOT_FOUND]', async () => {
    const prismaLike = makePrismaMock()
    await expect(buildManifestFromDb(prismaLike, 'ghost')).rejects.toThrow(
      /\[NOT_FOUND\]/,
    )
  })

  it('proyecto vacío genera manifest mínimo válido', async () => {
    const prismaLike = makePrismaMock({
      project: {
        findUnique: async () => ({
          id: 'p1',
          name: 'Solo nombre',
          description: null,
          status: 'PLANNING',
          cpi: null,
          spi: null,
        }),
      },
    })

    const m = await buildManifestFromDb(prismaLike, 'p1')
    expect(m.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(m.project.id).toBe('p1')
    expect(m.tasks).toEqual([])
    expect(m.dependencies).toEqual([])
    expect(m.exportedAt).toBeInstanceOf(Date)
  })

  it('aplana assignee.email → assigneeEmail en tareas', async () => {
    const prismaLike = makePrismaMock({
      project: {
        findUnique: async () => ({
          id: 'p1',
          name: 'Test',
          description: null,
          status: 'ACTIVE',
          cpi: null,
          spi: null,
        }),
      },
      task: {
        findMany: async () => [
          {
            id: 't1',
            mnemonic: 'A-1',
            title: 'Una',
            description: null,
            type: 'PMI_TASK',
            status: 'TODO',
            priority: 'MEDIUM',
            parentId: null,
            phaseId: null,
            sprintId: null,
            columnId: null,
            startDate: null,
            endDate: null,
            progress: 0,
            isMilestone: false,
            slaResponseLimit: null,
            slaResolutionLimit: null,
            isEscalated: false,
            plannedValue: null,
            actualCost: null,
            earnedValue: null,
            position: 1,
            archivedAt: null,
            tags: [],
            referenceUrl: null,
            assignee: { email: 'edwin@x.com' },
          },
        ],
      },
      comment: {
        findMany: async () => [
          {
            id: 'c1',
            taskId: 't1',
            content: 'comentario',
            isInternal: false,
            author: { email: 'edwin@x.com' },
            createdAt: new Date('2026-05-01'),
          },
        ],
      },
    })

    const m = await buildManifestFromDb(prismaLike, 'p1')
    expect(m.tasks[0].assigneeEmail).toBe('edwin@x.com')
    expect(m.comments[0].authorEmail).toBe('edwin@x.com')
    // No debe quedar el shape Prisma anidado en el manifest.
    expect((m.tasks[0] as unknown as { assignee?: unknown }).assignee).toBeUndefined()
  })

  it('mind map con nodes y edges sobrevive el shape', async () => {
    const prismaLike = makePrismaMock({
      project: {
        findUnique: async () => ({
          id: 'p1',
          name: 'MM',
          description: null,
          status: 'ACTIVE',
          cpi: null,
          spi: null,
        }),
      },
      mindMap: {
        findMany: async () => [
          {
            id: 'mm1',
            title: 'Mapa',
            description: null,
            owner: { email: 'edwin@x.com' },
            nodes: [
              {
                id: 'n1',
                label: 'Root',
                note: null,
                x: 0,
                y: 0,
                color: null,
                isRoot: true,
                taskId: null,
              },
            ],
            edges: [],
          },
        ],
      },
    })
    const m = await buildManifestFromDb(prismaLike, 'p1')
    expect(m.mindMaps).toHaveLength(1)
    expect(m.mindMaps[0].ownerEmail).toBe('edwin@x.com')
    expect(m.mindMaps[0].nodes).toHaveLength(1)
  })
})

describe('exportProjectFullToZip', () => {
  it('genera ZIP con manifest.json válido y filename con slug', async () => {
    const prismaLike = makePrismaMock({
      project: {
        findUnique: async () => ({
          id: 'p1',
          name: 'Mi Proyecto Genial',
          description: null,
          status: 'ACTIVE',
          cpi: null,
          spi: null,
        }),
      },
    })

    const res = await exportProjectFullToZip(prismaLike, 'p1')
    expect(res.mimeType).toBe('application/zip')
    expect(res.filename).toMatch(/^mi-proyecto-genial-backup-\d{4}-\d{2}-\d{2}\.zip$/)
    expect(res.byteLength).toBeGreaterThan(0)

    // Roundtrip: cargar el ZIP y validar el manifest.
    const buf = Buffer.from(res.payloadBase64, 'base64')
    const zip = await JSZip.loadAsync(buf)
    const entry = zip.file(MANIFEST_FILENAME)
    expect(entry).not.toBeNull()
    const text = await entry!.async('string')
    const parsed = JSON.parse(text)
    expect(parsed.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    // Validación zod del manifest re-leído.
    const validated = manifestSchema.safeParse(parsed)
    expect(validated.success).toBe(true)
  })
})
