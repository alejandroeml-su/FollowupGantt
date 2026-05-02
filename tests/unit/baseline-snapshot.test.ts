import { describe, it, expect } from 'vitest'

/**
 * HU-3.1 · Tests del helper de snapshot de líneas base.
 *
 * Probamos solo lógica pura (sin Prisma): construcción del JSON,
 * normalización de label, validación con zod y rama de error
 * `[INVALID_SNAPSHOT]`. La server action `captureBaseline` se cubre
 * indirectamente vía e2e (skip en este sprint, programado en HU futura).
 */

import {
  BASELINE_CAP_PER_PROJECT,
  BASELINE_LABEL_MAX,
  BASELINE_WARN_THRESHOLD,
  BaselineSnapshotSchema,
  buildBaselineSnapshot,
  normalizeBaselineLabel,
  parseBaselineSnapshot,
  type TaskForSnapshot,
} from '@/lib/scheduling/baseline-snapshot'

const NOW = new Date('2026-05-01T12:00:00Z')

function task(partial: Partial<TaskForSnapshot> = {}): TaskForSnapshot {
  return {
    id: 't1',
    mnemonic: 'PROJ-1',
    title: 'Diseño BD',
    startDate: new Date('2026-05-02T00:00:00Z'),
    endDate: new Date('2026-05-05T00:00:00Z'),
    plannedValue: 1000,
    earnedValue: 500,
    actualCost: 600,
    progress: 50,
    status: 'IN_PROGRESS',
    ...partial,
  }
}

describe('baseline-snapshot · constantes', () => {
  it('expone los topes documentados (D10)', () => {
    expect(BASELINE_CAP_PER_PROJECT).toBe(20)
    expect(BASELINE_WARN_THRESHOLD).toBe(15)
    expect(BASELINE_LABEL_MAX).toBe(80)
  })
})

describe('baseline-snapshot · buildBaselineSnapshot', () => {
  it('serializa Date → ISO y mapea startDate/endDate a plannedStart/plannedEnd', () => {
    const snap = buildBaselineSnapshot({
      tasks: [task()],
      capturedAt: NOW,
      label: null,
    })
    expect(snap.schemaVersion).toBe(1)
    expect(snap.capturedAt).toBe(NOW.toISOString())
    expect(snap.label).toBeNull()
    expect(snap.tasks).toHaveLength(1)
    const t = snap.tasks[0]
    expect(t.id).toBe('t1')
    expect(t.mnemonic).toBe('PROJ-1')
    expect(t.plannedStart).toBe('2026-05-02T00:00:00.000Z')
    expect(t.plannedEnd).toBe('2026-05-05T00:00:00.000Z')
    expect(t.plannedValue).toBe(1000)
    expect(t.earnedValue).toBe(500)
    expect(t.actualCost).toBe(600)
    expect(t.progress).toBe(50)
    expect(t.status).toBe('IN_PROGRESS')
  })

  it('soporta label opcional truncado y trimmed', () => {
    const noLabel = buildBaselineSnapshot({
      tasks: [task()],
      capturedAt: NOW,
      label: null,
    })
    expect(noLabel.label).toBeNull()

    const trimmed = buildBaselineSnapshot({
      tasks: [task()],
      capturedAt: NOW,
      label: 'Reaprob. comité Q2',
    })
    expect(trimmed.label).toBe('Reaprob. comité Q2')
  })

  it('preserva campos null en tareas sin fechas o sin EVM', () => {
    const empty: TaskForSnapshot = {
      id: 't2',
      mnemonic: null,
      title: 'Sin fechas',
      startDate: null,
      endDate: null,
      plannedValue: null,
      earnedValue: null,
      actualCost: null,
      progress: null,
      status: 'TODO',
    }
    const snap = buildBaselineSnapshot({
      tasks: [empty],
      capturedAt: NOW,
      label: null,
    })
    expect(snap.tasks[0]).toMatchObject({
      id: 't2',
      mnemonic: null,
      plannedStart: null,
      plannedEnd: null,
      plannedValue: null,
      earnedValue: null,
      actualCost: null,
      progress: null,
    })
  })

  it('valida con zod el shape final (auto-aserción contra drift)', () => {
    const snap = buildBaselineSnapshot({
      tasks: [task(), task({ id: 't2', mnemonic: null })],
      capturedAt: NOW,
      label: 'v1',
    })
    const reparsed = BaselineSnapshotSchema.safeParse(snap)
    expect(reparsed.success).toBe(true)
    if (reparsed.success) {
      expect(reparsed.data.tasks).toHaveLength(2)
    }
  })
})

describe('baseline-snapshot · normalizeBaselineLabel', () => {
  it('null/undefined/"" → null', () => {
    expect(normalizeBaselineLabel(null)).toBeNull()
    expect(normalizeBaselineLabel(undefined)).toBeNull()
    expect(normalizeBaselineLabel('')).toBeNull()
    expect(normalizeBaselineLabel('   ')).toBeNull()
  })

  it('trimmea espacios al inicio y al final', () => {
    expect(normalizeBaselineLabel('  Comité  ')).toBe('Comité')
  })

  it('trunca a 80 caracteres', () => {
    const long = 'a'.repeat(120)
    const out = normalizeBaselineLabel(long)
    expect(out).not.toBeNull()
    expect(out!.length).toBe(BASELINE_LABEL_MAX)
  })
})

describe('baseline-snapshot · parseBaselineSnapshot', () => {
  it('devuelve el snapshot válido tal cual', () => {
    const snap = buildBaselineSnapshot({
      tasks: [task()],
      capturedAt: NOW,
      label: null,
    })
    const parsed = parseBaselineSnapshot(snap)
    expect(parsed).toEqual(snap)
  })

  it('lanza [INVALID_SNAPSHOT] si el shape está roto', () => {
    expect(() => parseBaselineSnapshot({ schemaVersion: 99 })).toThrow(
      /\[INVALID_SNAPSHOT\]/,
    )
    expect(() =>
      parseBaselineSnapshot({
        schemaVersion: 1,
        capturedAt: 'no-iso',
        label: null,
        tasks: [],
      }),
    ).toThrow(/\[INVALID_SNAPSHOT\]/)
  })

  it('lanza [INVALID_SNAPSHOT] cuando una tarea pierde campos requeridos', () => {
    expect(() =>
      parseBaselineSnapshot({
        schemaVersion: 1,
        capturedAt: NOW.toISOString(),
        label: null,
        tasks: [{ id: 't1' }], // faltan title, status, etc.
      }),
    ).toThrow(/\[INVALID_SNAPSHOT\]/)
  })
})
