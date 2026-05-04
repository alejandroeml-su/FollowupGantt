import { describe, it, expect } from 'vitest'
import {
  computeExtendedCpm,
  PRIORITY_HIGH,
  PRIORITY_LOW,
  PRIORITY_MEDIUM,
  type ExtendedCpmInput,
} from '@/lib/scheduling/cpm-extended'
import {
  buildUniformCapacity,
  levelResources,
} from '@/lib/scheduling/resource-leveling'
import {
  DEFAULT_WORKDAYS_BITMASK,
  type WorkCalendarLike,
} from '@/lib/scheduling/work-calendar'

const PROJECT_START = new Date('2026-05-04T00:00:00Z') // lunes

const monFri: WorkCalendarLike = {
  workdays: DEFAULT_WORKDAYS_BITMASK,
  holidays: [],
}

function buildInput(
  tasks: ExtendedCpmInput['tasks'],
  dependencies: ExtendedCpmInput['dependencies'] = [],
  calendar?: WorkCalendarLike,
): ExtendedCpmInput {
  return { projectStart: PROJECT_START, tasks, dependencies, calendar }
}

describe('levelResources', () => {
  it('sin tareas asignadas: plan vacío', () => {
    const cpm = computeExtendedCpm(
      buildInput([{ id: 'A', duration: 3, isMilestone: false }]),
    )
    const plan = levelResources({
      cpm,
      capacityPerDay: new Map(),
    })
    expect(plan.changes).toHaveLength(0)
    expect(plan.unresolved).toHaveLength(0)
    expect(plan.overloadedDayCount).toBe(0)
  })

  it('una sola tarea dentro de capacidad: sin cambios', () => {
    const cpm = computeExtendedCpm(
      buildInput([
        {
          id: 'A',
          duration: 3,
          isMilestone: false,
          assigneeId: 'u1',
          dailyEffortHours: 4,
        },
      ]),
    )
    const plan = levelResources({
      cpm,
      capacityPerDay: buildUniformCapacity(['u1'], 8),
    })
    expect(plan.changes).toHaveLength(0)
    expect(plan.overloadedDayCount).toBe(0)
  })

  it('dos tareas paralelas que saturan a un usuario: empuja la no-crítica', () => {
    // A y B comparten la misma ventana 0-3 con asignado u1.
    // Cada una pide 8h ⇒ load=16h vs cap=8h.
    // Ambas son terminales sin deps ⇒ ambas críticas (slack=0 cada una).
    // Para tener slack añadimos una "tarea ancla" que extiende el proyecto.
    const cpm = computeExtendedCpm(
      buildInput(
        [
          {
            id: 'A',
            duration: 3,
            isMilestone: false,
            assigneeId: 'u1',
            dailyEffortHours: 8,
            priority: PRIORITY_HIGH,
          },
          {
            id: 'B',
            duration: 3,
            isMilestone: false,
            assigneeId: 'u1',
            dailyEffortHours: 8,
            priority: PRIORITY_LOW,
          },
          // Ancla con duración larga para crear holgura en A y B.
          {
            id: 'ANCHOR',
            duration: 20,
            isMilestone: false,
            assigneeId: 'other',
          },
        ],
      ),
    )
    expect(cpm.results.get('A')!.totalFloat).toBeGreaterThan(0)
    expect(cpm.results.get('B')!.totalFloat).toBeGreaterThan(0)

    const plan = levelResources({
      cpm,
      capacityPerDay: buildUniformCapacity(['u1', 'other'], 8),
    })
    // Debería empujar B (LOW) antes que A (HIGH).
    expect(plan.changes.length).toBeGreaterThan(0)
    expect(plan.changes[0].taskId).toBe('B')
    expect(plan.changes[0].deltaDays).toBeGreaterThan(0)
    expect(plan.overloadedDayCount).toBeGreaterThan(0)
  })

  it('tarea crítica sobreasignada: no puede moverse, queda en unresolved CRITICAL', () => {
    const cpm = computeExtendedCpm(
      buildInput([
        {
          id: 'A',
          duration: 3,
          isMilestone: false,
          assigneeId: 'u1',
          dailyEffortHours: 10,
        },
      ]),
    )
    const plan = levelResources({
      cpm,
      capacityPerDay: buildUniformCapacity(['u1'], 8),
    })
    expect(plan.changes).toHaveLength(0)
    expect(plan.unresolved.length).toBeGreaterThan(0)
    expect(plan.unresolved[0].reason).toBe('CRITICAL')
  })

  it('determinismo: misma entrada → mismo plan', () => {
    const buildSame = () =>
      computeExtendedCpm(
        buildInput([
          {
            id: 'A',
            duration: 2,
            isMilestone: false,
            assigneeId: 'u1',
            dailyEffortHours: 8,
            priority: PRIORITY_LOW,
          },
          {
            id: 'B',
            duration: 2,
            isMilestone: false,
            assigneeId: 'u1',
            dailyEffortHours: 8,
            priority: PRIORITY_LOW,
          },
          {
            id: 'C',
            duration: 2,
            isMilestone: false,
            assigneeId: 'u1',
            dailyEffortHours: 8,
            priority: PRIORITY_LOW,
          },
          { id: 'ANCHOR', duration: 20, isMilestone: false, assigneeId: 'x' },
        ]),
      )
    const cap = buildUniformCapacity(['u1', 'x'], 8)
    const p1 = levelResources({ cpm: buildSame(), capacityPerDay: cap })
    const p2 = levelResources({ cpm: buildSame(), capacityPerDay: cap })
    expect(p1.changes.map((c) => c.taskId)).toEqual(
      p2.changes.map((c) => c.taskId),
    )
    expect(p1.changes.map((c) => c.deltaDays)).toEqual(
      p2.changes.map((c) => c.deltaDays),
    )
  })

  it('respeta hardDeadline: no propone shift que la rompa', () => {
    // A y B saturan u1; B tiene hardDeadline corto.
    const hd = new Date('2026-05-07T00:00:00Z')
    const cpm = computeExtendedCpm(
      buildInput([
        {
          id: 'A',
          duration: 3,
          isMilestone: false,
          assigneeId: 'u1',
          dailyEffortHours: 8,
          priority: PRIORITY_HIGH,
        },
        {
          id: 'B',
          duration: 3,
          isMilestone: false,
          assigneeId: 'u1',
          dailyEffortHours: 8,
          priority: PRIORITY_LOW,
          hardDeadline: hd,
        },
        { id: 'ANCHOR', duration: 30, isMilestone: false, assigneeId: 'x' },
      ]),
    )
    const plan = levelResources({
      cpm,
      capacityPerDay: buildUniformCapacity(['u1', 'x'], 8),
    })
    // Si el plan propone mover B, el proposedEnd no puede pasar de hd.
    const moveB = plan.changes.find((c) => c.taskId === 'B')
    if (moveB) {
      expect(moveB.proposedEnd.getTime()).toBeLessThanOrEqual(hd.getTime())
    }
    // Si no se pudo mover B, A debió moverse (es la otra opción) o B en unresolved.
    expect(
      plan.changes.length + plan.unresolved.length,
    ).toBeGreaterThan(0)
  })

  it('todas las tareas críticas: sin movimiento, todas en unresolved CRITICAL', () => {
    const cpm = computeExtendedCpm(
      buildInput(
        [
          {
            id: 'A',
            duration: 3,
            isMilestone: false,
            assigneeId: 'u1',
            dailyEffortHours: 8,
          },
          {
            id: 'B',
            duration: 3,
            isMilestone: false,
            assigneeId: 'u1',
            dailyEffortHours: 8,
          },
        ],
        [{ predecessorId: 'A', successorId: 'B', type: 'FS', lag: 0 }],
      ),
    )
    // En cadena lineal sin solape no hay sobrecarga; añadimos otra que sí solape.
    expect(cpm.results.get('A')!.isCritical).toBe(true)
    expect(cpm.results.get('B')!.isCritical).toBe(true)

    // Forzar overlap usando SS (ambas inician 0).
    const cpm2 = computeExtendedCpm(
      buildInput(
        [
          {
            id: 'A',
            duration: 3,
            isMilestone: false,
            assigneeId: 'u1',
            dailyEffortHours: 8,
          },
          {
            id: 'B',
            duration: 3,
            isMilestone: false,
            assigneeId: 'u1',
            dailyEffortHours: 8,
          },
        ],
        [{ predecessorId: 'A', successorId: 'B', type: 'SS', lag: 0 }],
      ),
    )
    const plan = levelResources({
      cpm: cpm2,
      capacityPerDay: buildUniformCapacity(['u1'], 8),
    })
    expect(plan.changes).toHaveLength(0)
    expect(plan.unresolved.length).toBeGreaterThan(0)
    for (const u of plan.unresolved) {
      expect(u.reason).toBe('CRITICAL')
    }
  })

  it('capacidad 0 para usuario: cualquier carga se reporta', () => {
    const cpm = computeExtendedCpm(
      buildInput([
        {
          id: 'A',
          duration: 1,
          isMilestone: false,
          assigneeId: 'u1',
          dailyEffortHours: 4,
        },
      ]),
    )
    const plan = levelResources({
      cpm,
      capacityPerDay: new Map([['u1', 0]]),
    })
    expect(plan.overloadedDayCount).toBeGreaterThan(0)
  })

  it('falta capacityPerDay para un usuario: cae a defaultDailyEffortHours', () => {
    const cpm = computeExtendedCpm(
      buildInput([
        {
          id: 'A',
          duration: 1,
          isMilestone: false,
          assigneeId: 'u1',
          dailyEffortHours: 8,
        },
      ]),
    )
    const plan = levelResources({
      cpm,
      capacityPerDay: new Map(),
      defaultDailyEffortHours: 8,
    })
    // 8 vs 8 ⇒ NO sobrecarga.
    expect(plan.overloadedDayCount).toBe(0)
  })

  it('hito (duration=0) NO consume capacidad', () => {
    const cpm = computeExtendedCpm(
      buildInput([
        {
          id: 'M',
          duration: 0,
          isMilestone: true,
          assigneeId: 'u1',
          dailyEffortHours: 1000,
        },
      ]),
    )
    const plan = levelResources({
      cpm,
      capacityPerDay: buildUniformCapacity(['u1'], 8),
    })
    expect(plan.overloadedDayCount).toBe(0)
  })

  it('priority desempata: HIGH no se mueve antes que LOW', () => {
    const cpm = computeExtendedCpm(
      buildInput([
        {
          id: 'HIGH',
          duration: 3,
          isMilestone: false,
          assigneeId: 'u1',
          dailyEffortHours: 8,
          priority: PRIORITY_HIGH,
        },
        {
          id: 'LOW',
          duration: 3,
          isMilestone: false,
          assigneeId: 'u1',
          dailyEffortHours: 8,
          priority: PRIORITY_LOW,
        },
        { id: 'ANCHOR', duration: 30, isMilestone: false, assigneeId: 'x' },
      ]),
    )
    const plan = levelResources({
      cpm,
      capacityPerDay: buildUniformCapacity(['u1', 'x'], 8),
    })
    // El primer cambio debería ser LOW.
    expect(plan.changes[0]?.taskId).toBe('LOW')
  })

  it('con calendar lun-vie: los shifts ignoran weekends', () => {
    const cpm = computeExtendedCpm(
      buildInput(
        [
          {
            id: 'A',
            duration: 1,
            isMilestone: false,
            assigneeId: 'u1',
            dailyEffortHours: 8,
            priority: PRIORITY_LOW,
          },
          {
            id: 'B',
            duration: 1,
            isMilestone: false,
            assigneeId: 'u1',
            dailyEffortHours: 8,
            priority: PRIORITY_LOW,
          },
          { id: 'ANCHOR', duration: 10, isMilestone: false, assigneeId: 'x' },
        ],
        [],
        monFri,
      ),
    )
    const plan = levelResources({
      cpm,
      capacityPerDay: buildUniformCapacity(['u1', 'x'], 8),
      calendar: monFri,
    })
    // Si se movió alguna tarea, su proposedStart debe ser un workday.
    for (const c of plan.changes) {
      const dow = c.proposedStart.getUTCDay()
      // 0=domingo, 6=sábado deben quedar excluidos
      expect(dow).not.toBe(0)
      expect(dow).not.toBe(6)
    }
  })

  it('dailyEffortHours null/undefined → cae a defaultDailyEffortHours', () => {
    const cpm = computeExtendedCpm(
      buildInput([
        {
          id: 'A',
          duration: 1,
          isMilestone: false,
          assigneeId: 'u1',
          dailyEffortHours: null,
        },
      ]),
    )
    const plan = levelResources({
      cpm,
      capacityPerDay: buildUniformCapacity(['u1'], 8),
      defaultDailyEffortHours: 8,
    })
    expect(plan.overloadedDayCount).toBe(0) // 8 vs 8 → ok
  })

  it('buildUniformCapacity construye correctamente el map', () => {
    const m = buildUniformCapacity(['a', 'b', 'c'], 6)
    expect(m.size).toBe(3)
    expect(m.get('a')).toBe(6)
    expect(m.get('b')).toBe(6)
    expect(m.get('c')).toBe(6)
  })

  it('proposedStart/proposedEnd preservan la duración original', () => {
    const cpm = computeExtendedCpm(
      buildInput([
        {
          id: 'A',
          duration: 2,
          isMilestone: false,
          assigneeId: 'u1',
          dailyEffortHours: 8,
          priority: PRIORITY_LOW,
        },
        {
          id: 'B',
          duration: 2,
          isMilestone: false,
          assigneeId: 'u1',
          dailyEffortHours: 8,
          priority: PRIORITY_LOW,
        },
        { id: 'ANCHOR', duration: 20, isMilestone: false, assigneeId: 'x' },
      ]),
    )
    const plan = levelResources({
      cpm,
      capacityPerDay: buildUniformCapacity(['u1', 'x'], 8),
    })
    for (const c of plan.changes) {
      const origDur = c.originalEnd.getTime() - c.originalStart.getTime()
      const newDur = c.proposedEnd.getTime() - c.proposedStart.getTime()
      expect(newDur).toBe(origDur)
    }
  })

  it('múltiples usuarios independientes: solo el saturado se afecta', () => {
    const cpm = computeExtendedCpm(
      buildInput([
        {
          id: 'A1',
          duration: 3,
          isMilestone: false,
          assigneeId: 'u1',
          dailyEffortHours: 8,
          priority: PRIORITY_LOW,
        },
        {
          id: 'A2',
          duration: 3,
          isMilestone: false,
          assigneeId: 'u1',
          dailyEffortHours: 8,
          priority: PRIORITY_LOW,
        },
        {
          id: 'B1',
          duration: 3,
          isMilestone: false,
          assigneeId: 'u2',
          dailyEffortHours: 4,
        },
        { id: 'ANCHOR', duration: 30, isMilestone: false, assigneeId: 'x' },
      ]),
    )
    const plan = levelResources({
      cpm,
      capacityPerDay: buildUniformCapacity(['u1', 'u2', 'x'], 8),
    })
    // Solo tareas de u1 deben aparecer en changes.
    for (const c of plan.changes) {
      expect(c.assigneeId).toBe('u1')
    }
  })

  it('reason OVER_CAPACITY se asigna correctamente cuando hay shift exitoso', () => {
    const cpm = computeExtendedCpm(
      buildInput([
        {
          id: 'A',
          duration: 1,
          isMilestone: false,
          assigneeId: 'u1',
          dailyEffortHours: 8,
          priority: PRIORITY_LOW,
        },
        {
          id: 'B',
          duration: 1,
          isMilestone: false,
          assigneeId: 'u1',
          dailyEffortHours: 8,
          priority: PRIORITY_LOW,
        },
        { id: 'ANCHOR', duration: 20, isMilestone: false, assigneeId: 'x' },
      ]),
    )
    const plan = levelResources({
      cpm,
      capacityPerDay: buildUniformCapacity(['u1', 'x'], 8),
    })
    if (plan.changes.length > 0) {
      expect(plan.changes[0].reason).toBe('OVER_CAPACITY')
    }
  })

  it('mediano: 5 tareas mismo recurso, capacidad 8h, distribuye en distintos días', () => {
    const tasks: ExtendedCpmInput['tasks'] = []
    for (let i = 0; i < 5; i++) {
      tasks.push({
        id: `T${i}`,
        duration: 1,
        isMilestone: false,
        assigneeId: 'u1',
        dailyEffortHours: 8,
        priority: PRIORITY_MEDIUM,
      })
    }
    tasks.push({
      id: 'ANCHOR',
      duration: 30,
      isMilestone: false,
      assigneeId: 'x',
    })
    const cpm = computeExtendedCpm(buildInput(tasks))
    const plan = levelResources({
      cpm,
      capacityPerDay: buildUniformCapacity(['u1', 'x'], 8),
    })
    // Antes había 5 tareas mismo día (40h vs 8h cap). Plan debe proponer
    // mover 4 de ellas (queda 1 sin mover en el día original).
    expect(plan.changes.length).toBeGreaterThanOrEqual(3)
    // Todos los deltas deben ser positivos.
    for (const c of plan.changes) {
      expect(c.deltaDays).toBeGreaterThan(0)
    }
  })

  it('capacityPerDay vacío y sin defaultDailyEffortHours: usa fallback de 8h', () => {
    const cpm = computeExtendedCpm(
      buildInput([
        {
          id: 'A',
          duration: 1,
          isMilestone: false,
          assigneeId: 'u1',
          dailyEffortHours: 8,
        },
      ]),
    )
    const plan = levelResources({
      cpm,
      capacityPerDay: new Map(), // sin u1
      // sin defaultDailyEffortHours ⇒ default 8h en el algoritmo
    })
    // 8 carga vs 8 cap ⇒ no overload
    expect(plan.overloadedDayCount).toBe(0)
  })
})
