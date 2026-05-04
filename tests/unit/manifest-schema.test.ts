import { describe, it, expect } from 'vitest'
import {
  CURRENT_SCHEMA_VERSION,
  ZIP_SIZE_LIMIT_BYTES,
  ZIP_SIZE_LIMIT_MB,
  isSupportedSchemaVersion,
  manifestSchema,
} from '@/lib/backup/manifest-schema'

/**
 * P3-3 · Tests del schema zod del manifest.
 *
 * Validamos:
 *   1. Constantes de versión + cap de tamaño.
 *   2. `isSupportedSchemaVersion` distingue versiones soportadas.
 *   3. Manifest mínimo (solo project) parsea ok.
 *   4. Manifest con tasks + deps + comments parsea y normaliza fechas.
 *   5. schemaVersion incorrecto falla.
 *   6. Email malformado en assigneeEmail falla.
 */

const VALID_PROJECT = {
  id: 'p-1',
  name: 'Proyecto Test',
  description: null,
  status: 'ACTIVE' as const,
  cpi: null,
  spi: null,
}

describe('manifest-schema · constantes', () => {
  it('CURRENT_SCHEMA_VERSION = 1', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1)
  })
  it('cap = 50 MB', () => {
    expect(ZIP_SIZE_LIMIT_MB).toBe(50)
    expect(ZIP_SIZE_LIMIT_BYTES).toBe(50 * 1024 * 1024)
  })
})

describe('isSupportedSchemaVersion', () => {
  it('acepta v1', () => {
    expect(isSupportedSchemaVersion(1)).toBe(true)
  })
  it('rechaza versiones futuras o garbage', () => {
    expect(isSupportedSchemaVersion(2)).toBe(false)
    expect(isSupportedSchemaVersion(0)).toBe(false)
    expect(isSupportedSchemaVersion('1')).toBe(false)
    expect(isSupportedSchemaVersion(undefined)).toBe(false)
    expect(isSupportedSchemaVersion(null)).toBe(false)
  })
})

describe('manifestSchema · parsing', () => {
  it('parsea manifest mínimo (solo project)', () => {
    const input = {
      schemaVersion: 1,
      exportedAt: '2026-05-03T10:00:00.000Z',
      project: VALID_PROJECT,
    }
    const res = manifestSchema.safeParse(input)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data.tasks).toEqual([])
    expect(res.data.dependencies).toEqual([])
    expect(res.data.timeEntries).toEqual([])
    // exportedAt fue coercionado a Date.
    expect(res.data.exportedAt).toBeInstanceOf(Date)
  })

  it('parsea manifest con tasks + deps + comments y normaliza fechas', () => {
    const input = {
      schemaVersion: 1,
      exportedAt: '2026-05-03T10:00:00.000Z',
      project: VALID_PROJECT,
      tasks: [
        {
          id: 't1',
          title: 'Tarea',
          type: 'PMI_TASK',
          status: 'TODO',
          priority: 'MEDIUM',
          assigneeEmail: 'edwin@x.com',
          startDate: '2026-05-01T00:00:00Z',
          endDate: '2026-05-10T00:00:00Z',
          progress: 0,
          isMilestone: false,
          isEscalated: false,
          position: 1.0,
          tags: ['urgent'],
        },
      ],
      dependencies: [
        {
          id: 'd1',
          predecessorId: 't1',
          successorId: 't1',
          type: 'FINISH_TO_START',
          lagDays: 2,
        },
      ],
      comments: [
        {
          id: 'c1',
          taskId: 't1',
          content: 'hola',
          isInternal: true,
          authorEmail: 'edwin@x.com',
          createdAt: '2026-05-02T00:00:00Z',
        },
      ],
    }
    const res = manifestSchema.safeParse(input)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data.tasks).toHaveLength(1)
    expect(res.data.tasks[0].startDate).toBeInstanceOf(Date)
    expect(res.data.dependencies[0].lagDays).toBe(2)
    expect(res.data.comments[0].createdAt).toBeInstanceOf(Date)
  })

  it('rechaza schemaVersion incorrecto', () => {
    const input = {
      schemaVersion: 99,
      exportedAt: '2026-05-03T10:00:00.000Z',
      project: VALID_PROJECT,
    }
    const res = manifestSchema.safeParse(input)
    expect(res.success).toBe(false)
  })

  it('rechaza email malformado en assigneeEmail', () => {
    const input = {
      schemaVersion: 1,
      exportedAt: '2026-05-03T10:00:00.000Z',
      project: VALID_PROJECT,
      tasks: [
        {
          id: 't1',
          title: 'Tarea',
          type: 'PMI_TASK',
          status: 'TODO',
          priority: 'MEDIUM',
          assigneeEmail: 'no-es-email',
          progress: 0,
          isMilestone: false,
          isEscalated: false,
          position: 1.0,
          tags: [],
        },
      ],
    }
    const res = manifestSchema.safeParse(input)
    expect(res.success).toBe(false)
  })

  it('rechaza progress fuera de [0,100]', () => {
    const input = {
      schemaVersion: 1,
      exportedAt: '2026-05-03T10:00:00.000Z',
      project: VALID_PROJECT,
      tasks: [
        {
          id: 't1',
          title: 'Tarea',
          type: 'PMI_TASK',
          status: 'TODO',
          priority: 'MEDIUM',
          progress: 150,
          isMilestone: false,
          isEscalated: false,
          position: 1.0,
          tags: [],
        },
      ],
    }
    const res = manifestSchema.safeParse(input)
    expect(res.success).toBe(false)
  })
})
