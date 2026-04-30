import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * HU-1.5 · Tests del validador CPM server-side.
 *
 * Estrategia: testeamos `evaluateCpmInput` y `applyOverrideToCpmInput` con
 * inputs sintéticos (sin Prisma) y `validateProjectSchedule` con un mock
 * de `loadCpmInputForProject`. Esto evita BD y deja la suite rápida.
 *
 * Nota sobre NEGATIVE_FLOAT en `computeCpm`: la implementación actual
 * inicializa `LF` al `projectDuration` y no admite deadlines duros, por lo
 * que ciclos puros + grafos sanos son los únicos casos sintetizables sin
 * warnings inyectados. Mockeamos `computeCpm` puntualmente para validar
 * el ramal NEGATIVE_FLOAT.
 */

import {
  applyOverrideToCpmInput,
  evaluateCpmInput,
  validateProjectSchedule,
  validateScheduledChange,
} from '@/lib/scheduling/validate'
import type { CpmInput } from '@/lib/scheduling/cpm'

const PROJECT_START = new Date('2026-05-01T00:00:00Z')

function baseInput(): CpmInput {
  // Grafo: A(2d) → B(3d) → C(1d). Sin slack negativo.
  return {
    projectStart: PROJECT_START,
    tasks: [
      { id: 'A', duration: 2, isMilestone: false, earliestStartConstraint: 0 },
      { id: 'B', duration: 3, isMilestone: false, earliestStartConstraint: 2 },
      { id: 'C', duration: 1, isMilestone: false, earliestStartConstraint: 5 },
    ],
    dependencies: [
      { predecessorId: 'A', successorId: 'B', type: 'FS', lag: 0 },
      { predecessorId: 'B', successorId: 'C', type: 'FS', lag: 0 },
    ],
  }
}

describe('evaluateCpmInput', () => {
  it('schedule sano → ok=true sin warnings', () => {
    const r = evaluateCpmInput(baseInput())
    expect(r.ok).toBe(true)
    expect(r.negativeFloatTasks).toEqual([])
    expect(r.newCycles).toEqual([])
  })

  it('proyecto con ciclo de 2 nodos → newCycles poblado', () => {
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: [
        { id: 'P', duration: 2, isMilestone: false },
        { id: 'Q', duration: 2, isMilestone: false },
      ],
      dependencies: [
        { predecessorId: 'P', successorId: 'Q', type: 'FS', lag: 0 },
        { predecessorId: 'Q', successorId: 'P', type: 'FS', lag: 0 },
      ],
    }
    const r = evaluateCpmInput(input)
    expect(r.ok).toBe(false)
    expect(r.newCycles.length).toBe(1)
    expect(new Set(r.newCycles[0])).toEqual(new Set(['P', 'Q']))
    expect(r.negativeFloatTasks).toEqual([])
  })

  it('proyecto con ciclo de 3 nodos → todos los nodos del ciclo listados', () => {
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: [
        { id: 'X', duration: 1, isMilestone: false },
        { id: 'Y', duration: 1, isMilestone: false },
        { id: 'Z', duration: 1, isMilestone: false },
      ],
      dependencies: [
        { predecessorId: 'X', successorId: 'Y', type: 'FS', lag: 0 },
        { predecessorId: 'Y', successorId: 'Z', type: 'FS', lag: 0 },
        { predecessorId: 'Z', successorId: 'X', type: 'FS', lag: 0 },
      ],
    }
    const r = evaluateCpmInput(input)
    expect(r.ok).toBe(false)
    expect(r.newCycles.length).toBe(1)
    expect(new Set(r.newCycles[0])).toEqual(new Set(['X', 'Y', 'Z']))
  })

  it('proyecto vacío → ok=true', () => {
    const r = evaluateCpmInput({
      projectStart: PROJECT_START,
      tasks: [],
      dependencies: [],
    })
    expect(r.ok).toBe(true)
  })
})

describe('applyOverrideToCpmInput', () => {
  it('sin override retorna el input sin tocar', () => {
    const base = baseInput()
    const out = applyOverrideToCpmInput(base, undefined)
    expect(out).toBe(base)
  })

  it('aplica taskUpdates con duration sin mutar el original', () => {
    const base = baseInput()
    const out = applyOverrideToCpmInput(base, {
      taskUpdates: [{ id: 'B', duration: 10 }],
    })
    expect(out.tasks.find((t) => t.id === 'B')?.duration).toBe(10)
    expect(base.tasks.find((t) => t.id === 'B')?.duration).toBe(3)
  })

  it('convierte taskUpdates.startDate a earliestStartConstraint relativo', () => {
    const base = baseInput()
    // projectStart = 2026-05-01. Si movemos B a 2026-05-04, ESC = 3.
    const out = applyOverrideToCpmInput(base, {
      taskUpdates: [{ id: 'B', startDate: new Date('2026-05-04T00:00:00Z') }],
    })
    expect(
      out.tasks.find((t) => t.id === 'B')?.earliestStartConstraint,
    ).toBe(3)
  })

  it('addDependencies agrega aristas al grafo', () => {
    const base = baseInput()
    const out = applyOverrideToCpmInput(base, {
      addDependencies: [
        { predecessorId: 'A', successorId: 'C', type: 'FS', lag: 0 },
      ],
    })
    expect(out.dependencies.length).toBe(base.dependencies.length + 1)
  })

  it('updateDependencies actualiza lag de arista existente', () => {
    const base = baseInput()
    const out = applyOverrideToCpmInput(base, {
      updateDependencies: [
        { predecessorId: 'A', successorId: 'B', lag: 5 },
      ],
    })
    expect(
      out.dependencies.find(
        (d) => d.predecessorId === 'A' && d.successorId === 'B',
      )?.lag,
    ).toBe(5)
    expect(
      base.dependencies.find(
        (d) => d.predecessorId === 'A' && d.successorId === 'B',
      )?.lag,
    ).toBe(0)
  })

  it('updateDependencies sobre arista inexistente la inserta', () => {
    const base = baseInput()
    const out = applyOverrideToCpmInput(base, {
      updateDependencies: [
        { predecessorId: 'A', successorId: 'C', type: 'SS', lag: 1 },
      ],
    })
    expect(
      out.dependencies.find(
        (d) => d.predecessorId === 'A' && d.successorId === 'C',
      ),
    ).toEqual({
      predecessorId: 'A',
      successorId: 'C',
      type: 'SS',
      lag: 1,
    })
  })

  it('removeDependencies elimina aristas antes de update/add', () => {
    const base = baseInput()
    const out = applyOverrideToCpmInput(base, {
      removeDependencies: [{ predecessorId: 'A', successorId: 'B' }],
    })
    expect(
      out.dependencies.find(
        (d) => d.predecessorId === 'A' && d.successorId === 'B',
      ),
    ).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────
// Tests de integración con loadCpmInputForProject mockeado
// ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/scheduling/prismaAdapter', () => ({
  loadCpmInputForProject: vi.fn(),
}))

const { loadCpmInputForProject } = await import('@/lib/scheduling/prismaAdapter')
const loadMock = loadCpmInputForProject as unknown as ReturnType<typeof vi.fn>

describe('validateProjectSchedule', () => {
  beforeEach(() => {
    loadMock.mockReset()
  })

  it('proyectId vacío retorna ok=true sin cargar', async () => {
    const r = await validateProjectSchedule('')
    expect(r.ok).toBe(true)
    expect(loadMock).not.toHaveBeenCalled()
  })

  it('proyecto vacío retorna ok=true', async () => {
    loadMock.mockResolvedValueOnce({
      projectStart: PROJECT_START,
      tasks: [],
      dependencies: [],
    })
    const r = await validateProjectSchedule('proj-1')
    expect(r.ok).toBe(true)
  })

  it('schedule sano sin override → ok=true', async () => {
    loadMock.mockResolvedValueOnce(baseInput())
    const r = await validateProjectSchedule('proj-1')
    expect(r.ok).toBe(true)
    expect(r.negativeFloatTasks).toEqual([])
  })

  it('override que cierra ciclo → newCycles poblado', async () => {
    loadMock.mockResolvedValueOnce(baseInput())
    // base: A → B → C. Añadir C → A cierra ciclo.
    const r = await validateProjectSchedule('proj-1', {
      addDependencies: [
        { predecessorId: 'C', successorId: 'A', type: 'FS', lag: 0 },
      ],
    })
    expect(r.ok).toBe(false)
    expect(r.newCycles.length).toBeGreaterThan(0)
  })
})

describe('validateScheduledChange', () => {
  beforeEach(() => {
    loadMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('no lanza si schedule sano', async () => {
    loadMock.mockResolvedValueOnce(baseInput())
    await expect(validateScheduledChange('proj-1')).resolves.toBeUndefined()
  })

  it('lanza [CYCLE_DETECTED] si el override cierra ciclo', async () => {
    loadMock.mockResolvedValueOnce(baseInput())
    await expect(
      validateScheduledChange('proj-1', {
        addDependencies: [
          { predecessorId: 'C', successorId: 'A', type: 'FS', lag: 0 },
        ],
      }),
    ).rejects.toThrow(/\[CYCLE_DETECTED\]/)
  })

  it('no lanza con projectId nulo', async () => {
    await expect(validateScheduledChange(null)).resolves.toBeUndefined()
    expect(loadMock).not.toHaveBeenCalled()
  })

  it('lanza [NEGATIVE_FLOAT] cuando la simulación reporta una tarea con float < 0', async () => {
    // computeCpm en el código actual no emite NEGATIVE_FLOAT con grafos
    // sintetizables sin deadlines (LF se inicializa a projectDuration).
    // Mockeamos `computeCpm` puntualmente para inyectar el warning y
    // verificar que `validateScheduledChange` lo traduce al error tipado
    // [NEGATIVE_FLOAT]. Esto cubre el contrato: si CPM detecta slack
    // negativo, el server rechaza.
    const cpmModule = await import('@/lib/scheduling/cpm')
    const spy = vi.spyOn(cpmModule, 'computeCpm').mockReturnValueOnce({
      results: new Map(),
      criticalPath: [],
      projectDuration: 0,
      warnings: [{ code: 'NEGATIVE_FLOAT', taskId: 'A', float: -3 }],
    })

    loadMock.mockResolvedValueOnce(baseInput())
    await expect(validateScheduledChange('proj-1')).rejects.toThrow(
      /\[NEGATIVE_FLOAT\]/,
    )
    spy.mockRestore()
  })

  it('lanza [NEGATIVE_FLOAT] con conteo plural cuando hay múltiples tareas afectadas', async () => {
    const cpmModule = await import('@/lib/scheduling/cpm')
    const spy = vi.spyOn(cpmModule, 'computeCpm').mockReturnValueOnce({
      results: new Map(),
      criticalPath: [],
      projectDuration: 0,
      warnings: [
        { code: 'NEGATIVE_FLOAT', taskId: 'A', float: -2 },
        { code: 'NEGATIVE_FLOAT', taskId: 'B', float: -1 },
        { code: 'NEGATIVE_FLOAT', taskId: 'C', float: -5 },
      ],
    })

    loadMock.mockResolvedValueOnce(baseInput())
    await expect(validateScheduledChange('proj-1')).rejects.toThrow(
      /\[NEGATIVE_FLOAT\] 3 tareas/,
    )
    spy.mockRestore()
  })
})
