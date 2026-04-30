import { describe, it, expect } from 'vitest'
import {
  computeCpm,
  type CpmInput,
  type CpmDependencyInput,
} from '@/lib/scheduling/cpm'

const PROJECT_START = new Date('2026-05-01T00:00:00Z')

function task(
  id: string,
  duration: number,
  isMilestone = false,
  earliestStartConstraint?: number,
) {
  return { id, duration, isMilestone, earliestStartConstraint }
}

function dep(
  predecessorId: string,
  successorId: string,
  type: CpmDependencyInput['type'] = 'FS',
  lag = 0,
): CpmDependencyInput {
  return { predecessorId, successorId, type, lag }
}

describe('computeCpm', () => {
  it('cadena lineal A→B→C (FS, lag=0): ES correctos', () => {
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: [task('A', 3), task('B', 2), task('C', 4)],
      dependencies: [dep('A', 'B'), dep('B', 'C')],
    }
    const out = computeCpm(input)
    expect(out.warnings).toHaveLength(0)
    expect(out.results.get('A')!.ES).toBe(0)
    expect(out.results.get('A')!.EF).toBe(3)
    expect(out.results.get('B')!.ES).toBe(3)
    expect(out.results.get('B')!.EF).toBe(5)
    expect(out.results.get('C')!.ES).toBe(5)
    expect(out.results.get('C')!.EF).toBe(9)
    expect(out.projectDuration).toBe(9)
    // Toda la cadena es crítica
    expect(out.criticalPath).toEqual(['A', 'B', 'C'])
  })

  it('paralelos A→[B,C]→D: D.ES = max(B.EF, C.EF)', () => {
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: [task('A', 2), task('B', 3), task('C', 5), task('D', 1)],
      dependencies: [
        dep('A', 'B'),
        dep('A', 'C'),
        dep('B', 'D'),
        dep('C', 'D'),
      ],
    }
    const out = computeCpm(input)
    expect(out.results.get('B')!.EF).toBe(5) // 2 + 3
    expect(out.results.get('C')!.EF).toBe(7) // 2 + 5
    expect(out.results.get('D')!.ES).toBe(7) // max(5, 7)
    expect(out.results.get('D')!.EF).toBe(8)
    expect(out.projectDuration).toBe(8)
    // Crítica: A → C → D (B tiene float)
    expect(out.criticalPath).toEqual(['A', 'C', 'D'])
    expect(out.results.get('B')!.isCritical).toBe(false)
    expect(out.results.get('B')!.totalFloat).toBe(2)
  })

  it('FS con lag=2: espera obligatoria entre tareas', () => {
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: [task('A', 3), task('B', 2)],
      dependencies: [dep('A', 'B', 'FS', 2)],
    }
    const out = computeCpm(input)
    expect(out.results.get('B')!.ES).toBe(5) // 3 + 2
    expect(out.results.get('B')!.EF).toBe(7)
    expect(out.projectDuration).toBe(7)
  })

  it('FS con lag=-1 (lead): solapamiento de 1 día', () => {
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: [task('A', 4), task('B', 3)],
      dependencies: [dep('A', 'B', 'FS', -1)],
    }
    const out = computeCpm(input)
    expect(out.results.get('B')!.ES).toBe(3) // 4 - 1
    expect(out.results.get('B')!.EF).toBe(6)
    expect(out.projectDuration).toBe(6)
  })

  it('SS con lag=1: sucesor inicia 1d después del inicio del predecesor', () => {
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: [task('A', 5), task('B', 4)],
      dependencies: [dep('A', 'B', 'SS', 1)],
    }
    const out = computeCpm(input)
    expect(out.results.get('A')!.ES).toBe(0)
    expect(out.results.get('B')!.ES).toBe(1) // pred.ES + 1
    expect(out.results.get('B')!.EF).toBe(5)
    // El predecesor termina en 5 y el sucesor también, así que duration = 5
    expect(out.projectDuration).toBe(5)
  })

  it('FF con lag=0: ambas terminan al mismo tiempo', () => {
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: [task('A', 6), task('B', 3)],
      dependencies: [dep('A', 'B', 'FF', 0)],
    }
    const out = computeCpm(input)
    // succ.EF ≥ pred.EF + lag → B.EF ≥ 6 → B.ES = 3
    expect(out.results.get('A')!.EF).toBe(6)
    expect(out.results.get('B')!.ES).toBe(3)
    expect(out.results.get('B')!.EF).toBe(6)
    expect(out.projectDuration).toBe(6)
  })

  it('hito (duration=0): EF == ES, no infla la duración', () => {
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: [task('A', 4), task('M', 0, true), task('B', 2)],
      dependencies: [dep('A', 'M'), dep('M', 'B')],
    }
    const out = computeCpm(input)
    const m = out.results.get('M')!
    expect(m.ES).toBe(4)
    expect(m.EF).toBe(4)
    expect(out.results.get('B')!.ES).toBe(4)
    expect(out.projectDuration).toBe(6)
  })

  it('ciclo A→B→A: warning CYCLE, sin loop infinito, results vacío', () => {
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: [task('A', 2), task('B', 3)],
      dependencies: [dep('A', 'B'), dep('B', 'A')],
    }
    const out = computeCpm(input)
    expect(out.results.size).toBe(0)
    expect(out.criticalPath).toEqual([])
    expect(out.projectDuration).toBe(0)
    const cycle = out.warnings.find((w) => w.code === 'CYCLE')
    expect(cycle).toBeTruthy()
    if (cycle && cycle.code === 'CYCLE') {
      expect(cycle.nodes).toEqual(expect.arrayContaining(['A', 'B']))
    }
  })

  it('ruta crítica única: identifica las tareas con float=0', () => {
    // A(3) → B(2) → D(4)  (suma 9, crítica)
    // A(3) → C(1) → D(4)  (suma 8, holgura 1)
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: [task('A', 3), task('B', 2), task('C', 1), task('D', 4)],
      dependencies: [
        dep('A', 'B'),
        dep('A', 'C'),
        dep('B', 'D'),
        dep('C', 'D'),
      ],
    }
    const out = computeCpm(input)
    expect(out.projectDuration).toBe(9)
    expect(out.criticalPath).toEqual(['A', 'B', 'D'])
    expect(out.results.get('C')!.isCritical).toBe(false)
    expect(out.results.get('C')!.totalFloat).toBe(1)
  })

  it('startDate/endDate calculados desde projectStart + ES/EF', () => {
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: [task('A', 2), task('B', 3)],
      dependencies: [dep('A', 'B', 'FS', 1)], // B inicia día 3
    }
    const out = computeCpm(input)
    const b = out.results.get('B')!
    expect(b.ES).toBe(3)
    expect(b.startDate.toISOString().slice(0, 10)).toBe('2026-05-04')
    expect(b.endDate.toISOString().slice(0, 10)).toBe('2026-05-07')
  })

  it('stress: 100 tareas en cadena lineal corre en menos de 50ms', () => {
    const tasks = Array.from({ length: 100 }, (_, i) => task(`T${i}`, 1))
    const dependencies: CpmDependencyInput[] = []
    for (let i = 0; i < 99; i++) {
      dependencies.push(dep(`T${i}`, `T${i + 1}`))
    }
    // Añadir 100 dependencias paralelas extra (T0 → T_i para i ∈ [10, 109])
    // pero limitando al rango existente
    for (let i = 1; i < 99; i += 1) {
      dependencies.push(dep('T0', `T${i}`))
    }
    const t0 = performance.now()
    const out = computeCpm({
      projectStart: PROJECT_START,
      tasks,
      dependencies,
    })
    const elapsed = performance.now() - t0
    expect(out.projectDuration).toBe(100)
    expect(elapsed).toBeLessThan(50)
  })

  // ───────────────── Backward pass · LS / LF / totalFloat (HU-2.2) ─────────────────

  it('backward pass: LF de la tarea final = projectDuration; LS = LF - duration', () => {
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: [task('A', 3), task('B', 2), task('C', 4)],
      dependencies: [dep('A', 'B'), dep('B', 'C')],
    }
    const out = computeCpm(input)
    // C es final
    expect(out.results.get('C')!.LF).toBe(9)
    expect(out.results.get('C')!.LS).toBe(5)
    // En cadena lineal todo tiene float=0 y LS=ES
    for (const id of ['A', 'B', 'C'] as const) {
      const r = out.results.get(id)!
      expect(r.LS).toBe(r.ES)
      expect(r.LF).toBe(r.EF)
      expect(r.totalFloat).toBe(0)
      expect(r.isCritical).toBe(true)
    }
  })

  it('backward pass: rama paralela no crítica tiene float = (camino crítico - propio)', () => {
    // A(3) → B(2) → D(4)  (crítica, suma 9)
    // A(3) → C(1) → D(4)  (holgura 1)
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: [task('A', 3), task('B', 2), task('C', 1), task('D', 4)],
      dependencies: [
        dep('A', 'B'),
        dep('A', 'C'),
        dep('B', 'D'),
        dep('C', 'D'),
      ],
    }
    const out = computeCpm(input)
    const c = out.results.get('C')!
    expect(c.ES).toBe(3)
    expect(c.EF).toBe(4)
    // C podría empezar 1 día más tarde sin afectar al proyecto:
    expect(c.LS).toBe(4)
    expect(c.LF).toBe(5)
    expect(c.totalFloat).toBe(1)
    expect(c.isCritical).toBe(false)
  })

  it('backward pass propaga LS/LF correctamente con FF', () => {
    // A(6) → B(3) FF lag=0 → ambas terminan al mismo tiempo (día 6)
    // B.LF debe ser 6, B.LS = 3
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: [task('A', 6), task('B', 3)],
      dependencies: [dep('A', 'B', 'FF', 0)],
    }
    const out = computeCpm(input)
    const a = out.results.get('A')!
    const b = out.results.get('B')!
    expect(a.LF).toBe(6)
    expect(b.LF).toBe(6)
    expect(b.LS).toBe(3)
    expect(b.totalFloat).toBe(0)
  })

  it('dependencia con extremo inexistente reporta ORPHAN sin romper', () => {
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: [task('A', 2), task('B', 3)],
      dependencies: [dep('A', 'B'), dep('A', 'GHOST')],
    }
    const out = computeCpm(input)
    expect(out.warnings).toContainEqual({ code: 'ORPHAN', taskId: 'GHOST' })
    // El cálculo sigue siendo válido para A→B
    expect(out.results.get('B')!.ES).toBe(2)
  })
})
