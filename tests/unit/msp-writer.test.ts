import { describe, it, expect } from 'vitest'
import { XMLParser } from 'fast-xml-parser'
import {
  buildMspXml,
  type MspExportTask,
  type MspExportDep,
  type MspExportResource,
} from '@/lib/import-export/msp-writer'

/**
 * HU-4.3 · Tests del writer MSP XML.
 *
 * Estrategia: en cada test parseamos el output con `XMLParser` (D20:
 * `parseTagValue: false` para mantener tipos como string y comparar sin
 * sorpresas de coerción numérica). Este round-trip emula al reader que
 * vendrá en HU-4.0/4.1.
 */

const TASK_BASE: MspExportTask = {
  id: 'task-1',
  uid: 1,
  title: 'Diseño BD',
  startDate: new Date('2026-05-02T00:00:00.000Z'),
  endDate: new Date('2026-05-05T00:00:00.000Z'),
  isMilestone: false,
  parentId: null,
  progress: 50,
  priority: 'HIGH',
  position: 1,
}

const FIXED_CREATION = new Date('2026-05-01T08:00:00.000Z')

function parse(xml: string): Record<string, unknown> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    parseAttributeValue: false,
  })
  return parser.parse(xml)
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return []
  return Array.isArray(v) ? v : [v]
}

describe('msp-writer · estructura básica', () => {
  it('genera XML con declaration UTF-8 y namespace MSP', () => {
    const xml = buildMspXml({
      projectName: 'Proyecto Test',
      tasks: [TASK_BASE],
      deps: [],
      resources: [],
      creationDate: FIXED_CREATION,
    })
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toContain('xmlns="http://schemas.microsoft.com/project"')
  })

  it('serializa Project con metadatos top-level (Title, Name, Calendar)', () => {
    const xml = buildMspXml({
      projectName: 'Migración Cloud',
      tasks: [TASK_BASE],
      deps: [],
      resources: [],
      creationDate: FIXED_CREATION,
    })
    const doc = parse(xml) as { Project: Record<string, unknown> }
    expect(doc.Project.Title).toBe('Migración Cloud')
    expect(doc.Project.Name).toBe('migracion-cloud')
    expect(doc.Project.SaveVersion).toBe('14')
    expect(doc.Project.CalendarUID).toBe('1')
    const calendars = doc.Project.Calendars as { Calendar: Record<string, string> }
    expect(calendars.Calendar.Name).toBe('Standard')
    expect(calendars.Calendar.IsBaseCalendar).toBe('1')
  })

  it('calcula StartDate/FinishDate del proyecto desde min/max de las tasks', () => {
    const xml = buildMspXml({
      projectName: 'P1',
      tasks: [
        { ...TASK_BASE, id: 't1', uid: 1, startDate: new Date('2026-05-02T00:00:00Z'), endDate: new Date('2026-05-04T00:00:00Z') },
        { ...TASK_BASE, id: 't2', uid: 2, startDate: new Date('2026-05-10T00:00:00Z'), endDate: new Date('2026-05-15T00:00:00Z') },
      ],
      deps: [],
      resources: [],
      creationDate: FIXED_CREATION,
    })
    const doc = parse(xml) as { Project: Record<string, unknown> }
    expect(doc.Project.StartDate).toBe('2026-05-02T00:00:00')
    expect(doc.Project.FinishDate).toBe('2026-05-15T00:00:00')
  })
})

describe('msp-writer · jerarquía / OutlineNumber', () => {
  it('asigna OutlineNumber 1.2.3 en tres niveles de profundidad', () => {
    // Estructura:
    //   t-root1 (1)
    //     t-child1 (1.1)
    //       t-grand1 (1.1.1)
    //   t-root2 (2)
    const tasks: MspExportTask[] = [
      { ...TASK_BASE, id: 't-root1', uid: 1, parentId: null, title: 'Root 1' },
      { ...TASK_BASE, id: 't-child1', uid: 2, parentId: 't-root1', title: 'Child' },
      { ...TASK_BASE, id: 't-grand1', uid: 3, parentId: 't-child1', title: 'Grand' },
      { ...TASK_BASE, id: 't-root2', uid: 4, parentId: null, title: 'Root 2' },
    ]
    const xml = buildMspXml({
      projectName: 'P1',
      tasks,
      deps: [],
      resources: [],
      creationDate: FIXED_CREATION,
    })
    const doc = parse(xml) as { Project: { Tasks: { Task: unknown } } }
    const taskList = asArray(doc.Project.Tasks.Task) as Array<Record<string, string>>
    const byName = Object.fromEntries(taskList.map((t) => [t.Name, t]))

    expect(byName['Root 1'].OutlineNumber).toBe('1')
    expect(byName['Root 1'].OutlineLevel).toBe('1')
    expect(byName['Root 1'].Summary).toBe('1')

    expect(byName['Child'].OutlineNumber).toBe('1.1')
    expect(byName['Child'].OutlineLevel).toBe('2')
    expect(byName['Child'].Summary).toBe('1')

    expect(byName['Grand'].OutlineNumber).toBe('1.1.1')
    expect(byName['Grand'].OutlineLevel).toBe('3')
    expect(byName['Grand'].Summary).toBe('0')

    expect(byName['Root 2'].OutlineNumber).toBe('2')
    expect(byName['Root 2'].OutlineLevel).toBe('1')
    expect(byName['Root 2'].Summary).toBe('0')
  })
})

describe('msp-writer · dependencias / PredecessorLink', () => {
  it('inyecta PredecessorLink dentro del Task sucesor (FS lag=0)', () => {
    const tasks: MspExportTask[] = [
      { ...TASK_BASE, id: 'a', uid: 1, title: 'A' },
      { ...TASK_BASE, id: 'b', uid: 2, title: 'B' },
    ]
    const deps: MspExportDep[] = [
      { predecessorId: 'a', successorId: 'b', type: 'FS', lagDays: 0 },
    ]
    const xml = buildMspXml({
      projectName: 'P1',
      tasks,
      deps,
      resources: [],
      creationDate: FIXED_CREATION,
    })
    const doc = parse(xml) as { Project: { Tasks: { Task: unknown } } }
    const list = asArray(doc.Project.Tasks.Task) as Array<Record<string, unknown>>
    const taskA = list.find((t) => t.Name === 'A')!
    const taskB = list.find((t) => t.Name === 'B')!

    // El predecesor no tiene PredecessorLink (no es sucesor de nada).
    expect(taskA.PredecessorLink).toBeUndefined()

    const link = taskB.PredecessorLink as Record<string, string>
    expect(link.PredecessorUID).toBe('1')
    expect(link.Type).toBe('1') // FS
    expect(link.LinkLag).toBe('0')
    expect(link.LagFormat).toBe('7')
    expect(link.CrossProject).toBe('0')
  })

  it('convierte LinkLag para SF lag=2 → 2 * 4800 = 9600 décimas de minuto', () => {
    const tasks: MspExportTask[] = [
      { ...TASK_BASE, id: 'a', uid: 1, title: 'A' },
      { ...TASK_BASE, id: 'b', uid: 2, title: 'B' },
    ]
    const deps: MspExportDep[] = [
      { predecessorId: 'a', successorId: 'b', type: 'SF', lagDays: 2 },
    ]
    const xml = buildMspXml({
      projectName: 'P1',
      tasks,
      deps,
      resources: [],
      creationDate: FIXED_CREATION,
    })
    const doc = parse(xml) as { Project: { Tasks: { Task: unknown } } }
    const list = asArray(doc.Project.Tasks.Task) as Array<Record<string, unknown>>
    const taskB = list.find((t) => t.Name === 'B')!
    const link = taskB.PredecessorLink as Record<string, string>
    expect(link.Type).toBe('3') // SF
    expect(link.LinkLag).toBe('9600')
  })

  it('admite lead negativo (D19): lagDays=-1 → LinkLag=-4800', () => {
    const tasks: MspExportTask[] = [
      { ...TASK_BASE, id: 'a', uid: 1, title: 'A' },
      { ...TASK_BASE, id: 'b', uid: 2, title: 'B' },
    ]
    const deps: MspExportDep[] = [
      { predecessorId: 'a', successorId: 'b', type: 'FS', lagDays: -1 },
    ]
    const xml = buildMspXml({
      projectName: 'P1',
      tasks,
      deps,
      resources: [],
      creationDate: FIXED_CREATION,
    })
    const doc = parse(xml) as { Project: { Tasks: { Task: unknown } } }
    const list = asArray(doc.Project.Tasks.Task) as Array<Record<string, unknown>>
    const taskB = list.find((t) => t.Name === 'B')!
    const link = taskB.PredecessorLink as Record<string, string>
    expect(link.LinkLag).toBe('-4800')
  })
})

describe('msp-writer · milestones', () => {
  it('marca Milestone=1 cuando isMilestone=true y 0 cuando false', () => {
    const tasks: MspExportTask[] = [
      { ...TASK_BASE, id: 't1', uid: 1, title: 'Hito', isMilestone: true },
      { ...TASK_BASE, id: 't2', uid: 2, title: 'Tarea normal', isMilestone: false },
    ]
    const xml = buildMspXml({
      projectName: 'P1',
      tasks,
      deps: [],
      resources: [],
      creationDate: FIXED_CREATION,
    })
    const doc = parse(xml) as { Project: { Tasks: { Task: unknown } } }
    const list = asArray(doc.Project.Tasks.Task) as Array<Record<string, string>>
    const hito = list.find((t) => t.Name === 'Hito')!
    const normal = list.find((t) => t.Name === 'Tarea normal')!
    expect(hito.Milestone).toBe('1')
    expect(normal.Milestone).toBe('0')
  })
})

describe('msp-writer · prioridad', () => {
  it('mapea LOW=125, MEDIUM=500, HIGH=750, CRITICAL=900', () => {
    const tasks: MspExportTask[] = [
      { ...TASK_BASE, id: 't1', uid: 1, title: 'L', priority: 'LOW' },
      { ...TASK_BASE, id: 't2', uid: 2, title: 'M', priority: 'MEDIUM' },
      { ...TASK_BASE, id: 't3', uid: 3, title: 'H', priority: 'HIGH' },
      { ...TASK_BASE, id: 't4', uid: 4, title: 'C', priority: 'CRITICAL' },
    ]
    const xml = buildMspXml({
      projectName: 'P1',
      tasks,
      deps: [],
      resources: [],
      creationDate: FIXED_CREATION,
    })
    const doc = parse(xml) as { Project: { Tasks: { Task: unknown } } }
    const list = asArray(doc.Project.Tasks.Task) as Array<Record<string, string>>
    expect(list.find((t) => t.Name === 'L')!.Priority).toBe('125')
    expect(list.find((t) => t.Name === 'M')!.Priority).toBe('500')
    expect(list.find((t) => t.Name === 'H')!.Priority).toBe('750')
    expect(list.find((t) => t.Name === 'C')!.Priority).toBe('900')
  })
})

describe('msp-writer · recursos', () => {
  it('serializa Resources con UID, Name, EmailAddress y Type=1 (Work)', () => {
    const resources: MspExportResource[] = [
      { uid: 1, email: 'edwin@avante.com', name: 'Edwin Martinez' },
      { uid: 2, email: 'ale@avante.com', name: 'Ale ML' },
    ]
    const xml = buildMspXml({
      projectName: 'P1',
      tasks: [TASK_BASE],
      deps: [],
      resources,
      creationDate: FIXED_CREATION,
    })
    const doc = parse(xml) as { Project: { Resources: { Resource: unknown } } }
    const list = asArray(doc.Project.Resources.Resource) as Array<Record<string, string>>
    expect(list.length).toBe(2)
    const edwin = list.find((r) => r.EmailAddress === 'edwin@avante.com')!
    expect(edwin.UID).toBe('1')
    expect(edwin.Name).toBe('Edwin Martinez')
    expect(edwin.Type).toBe('1')
    const ale = list.find((r) => r.EmailAddress === 'ale@avante.com')!
    expect(ale.UID).toBe('2')
    expect(ale.Name).toBe('Ale ML')
  })

  it('genera Resources vacío cuando no hay recursos asignados', () => {
    const xml = buildMspXml({
      projectName: 'P1',
      tasks: [TASK_BASE],
      deps: [],
      resources: [],
      creationDate: FIXED_CREATION,
    })
    // Solo verificamos que el parser no falle y que no hay <Resource> con
    // datos. fast-xml-parser puede generar vacío como string vacío o no
    // exponer la propiedad — ambas situaciones son aceptables.
    const doc = parse(xml) as { Project: { Resources?: unknown } }
    const resources = doc.Project.Resources as
      | { Resource?: unknown }
      | string
      | undefined
    if (resources && typeof resources === 'object') {
      const inner = resources.Resource
      expect(inner === undefined || inner === '' || (Array.isArray(inner) && inner.length === 0)).toBe(true)
    }
  })
})

describe('msp-writer · round-trip parser+writer', () => {
  it('genera XML que el reader puede parsear y conserva conteos', () => {
    // Mini proyecto: 3 tasks (1 milestone), 2 deps, 1 resource.
    const tasks: MspExportTask[] = [
      { ...TASK_BASE, id: 't1', uid: 1, title: 'Análisis', priority: 'MEDIUM' },
      {
        ...TASK_BASE,
        id: 't2',
        uid: 2,
        title: 'Diseño',
        parentId: null,
        startDate: new Date('2026-05-06T00:00:00Z'),
        endDate: new Date('2026-05-08T00:00:00Z'),
      },
      {
        ...TASK_BASE,
        id: 't3',
        uid: 3,
        title: 'Kick-off',
        isMilestone: true,
        startDate: new Date('2026-05-02T00:00:00Z'),
        endDate: new Date('2026-05-02T00:00:00Z'),
      },
    ]
    const deps: MspExportDep[] = [
      { predecessorId: 't1', successorId: 't2', type: 'FS', lagDays: 1 },
      { predecessorId: 't3', successorId: 't1', type: 'FS', lagDays: 0 },
    ]
    const resources: MspExportResource[] = [
      { uid: 1, email: 'a@x.com', name: 'A' },
    ]
    const xml = buildMspXml({
      projectName: 'Round Trip',
      tasks,
      deps,
      resources,
      creationDate: FIXED_CREATION,
    })

    const doc = parse(xml) as { Project: { Tasks: { Task: unknown }; Resources: { Resource: unknown } } }
    const taskList = asArray(doc.Project.Tasks.Task) as Array<Record<string, unknown>>
    const resourceList = asArray(doc.Project.Resources.Resource) as Array<unknown>

    expect(taskList.length).toBe(3)
    expect(resourceList.length).toBe(1)

    // Cada PredecessorLink en su Task sucesora.
    const t1 = taskList.find((t) => t.Name === 'Análisis')!
    const t2 = taskList.find((t) => t.Name === 'Diseño')!
    expect(t1.PredecessorLink).toBeDefined()
    expect(t2.PredecessorLink).toBeDefined()

    const totalLinks =
      asArray(t1.PredecessorLink as unknown).length +
      asArray(t2.PredecessorLink as unknown).length
    expect(totalLinks).toBe(2)
  })
})
