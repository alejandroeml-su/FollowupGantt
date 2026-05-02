import { describe, it, expect } from 'vitest'
import { parseMspXml, stripBom } from '@/lib/import-export/msp-parser'

/**
 * HU-4.1 · Tests del parser MSP XML.
 *
 * Estrategia:
 *  - Construimos fixtures sintéticos de XML in-line (NO archivos reales,
 *    Sprint 8 corre sin ellos según D11). Cada test arma el mínimo XML
 *    necesario para ejercitar una rama del parser.
 *  - Cubrimos: namespace, BOM UTF-8/UTF-16, UID dup, OutlineNumber,
 *    PredecessorLink (todos los tipos), LinkLag (positivo, negativo,
 *    clamp), Resources (sin email, multiple, Material), ConstraintType,
 *    Calendar, Active=false, Priority enum, ciclos.
 */

const MSP_NS = 'http://schemas.microsoft.com/project'

interface FxTask {
  uid: number
  id?: number
  name: string
  start: string
  finish: string
  outlineNumber?: string
  outlineLevel?: number
  milestone?: 0 | 1
  summary?: 0 | 1
  active?: 0 | 1
  percentComplete?: number
  priority?: number
  notes?: string
  hyperlink?: string
  constraintType?: number
  calendarUid?: number
  predecessorLinks?: Array<{
    predecessorUid: number
    type: 0 | 1 | 2 | 3
    linkLag?: number
    lagFormat?: number
  }>
}

interface FxResource {
  uid: number
  id?: number
  name: string
  email?: string
  type?: number
}

interface FxAssignment {
  taskUid: number
  resourceUid: number
}

interface Fixture {
  title?: string
  tasks?: FxTask[]
  resources?: FxResource[]
  assignments?: FxAssignment[]
  /** Override del namespace; si null se omite (para forzar INVALID_FILE). */
  xmlns?: string | null
  /** Si true se omite el header XML (forzar parse error). */
  noHeader?: boolean
  /** Prepend de BOM. */
  bom?: 'utf8' | 'utf16le' | null
}

function buildXml(f: Fixture): string {
  const tasksXml = (f.tasks ?? [])
    .map((t) => {
      const links = (t.predecessorLinks ?? [])
        .map(
          (l) => `      <PredecessorLink>
        <PredecessorUID>${l.predecessorUid}</PredecessorUID>
        <Type>${l.type}</Type>
        <CrossProject>0</CrossProject>
        <LinkLag>${l.linkLag ?? 0}</LinkLag>
        <LagFormat>${l.lagFormat ?? 7}</LagFormat>
      </PredecessorLink>`,
        )
        .join('\n')
      const optional = [
        t.outlineNumber !== undefined
          ? `      <OutlineNumber>${t.outlineNumber}</OutlineNumber>`
          : '',
        t.outlineLevel !== undefined
          ? `      <OutlineLevel>${t.outlineLevel}</OutlineLevel>`
          : '',
        t.milestone !== undefined
          ? `      <Milestone>${t.milestone}</Milestone>`
          : '',
        t.summary !== undefined ? `      <Summary>${t.summary}</Summary>` : '',
        t.active !== undefined ? `      <Active>${t.active}</Active>` : '',
        t.percentComplete !== undefined
          ? `      <PercentComplete>${t.percentComplete}</PercentComplete>`
          : '',
        t.priority !== undefined
          ? `      <Priority>${t.priority}</Priority>`
          : '',
        t.notes !== undefined ? `      <Notes>${t.notes}</Notes>` : '',
        t.hyperlink !== undefined
          ? `      <HyperlinkAddress>${t.hyperlink}</HyperlinkAddress>`
          : '',
        t.constraintType !== undefined
          ? `      <ConstraintType>${t.constraintType}</ConstraintType>`
          : '',
        t.calendarUid !== undefined
          ? `      <CalendarUID>${t.calendarUid}</CalendarUID>`
          : '',
      ]
        .filter(Boolean)
        .join('\n')
      return `    <Task>
      <UID>${t.uid}</UID>
      <ID>${t.id ?? t.uid}</ID>
      <Name>${t.name}</Name>
      <Start>${t.start}</Start>
      <Finish>${t.finish}</Finish>
${optional}
${links}
    </Task>`
    })
    .join('\n')

  const resourcesXml = (f.resources ?? [])
    .map(
      (r) => `    <Resource>
      <UID>${r.uid}</UID>
      <ID>${r.id ?? r.uid}</ID>
      <Name>${r.name}</Name>
      ${r.email !== undefined ? `<EmailAddress>${r.email}</EmailAddress>` : ''}
      <Type>${r.type ?? 1}</Type>
    </Resource>`,
    )
    .join('\n')

  const assignmentsXml = (f.assignments ?? [])
    .map(
      (a, i) => `    <Assignment>
      <UID>${i + 1}</UID>
      <TaskUID>${a.taskUid}</TaskUID>
      <ResourceUID>${a.resourceUid}</ResourceUID>
    </Assignment>`,
    )
    .join('\n')

  const xmlns = f.xmlns === null ? '' : ` xmlns="${f.xmlns ?? MSP_NS}"`
  const header = f.noHeader ? '' : '<?xml version="1.0" encoding="UTF-8"?>\n'
  let xml = `${header}<Project${xmlns}>
  <Title>${f.title ?? 'Test Project'}</Title>
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

  if (f.bom === 'utf8') xml = '﻿' + xml
  if (f.bom === 'utf16le') xml = '﻿' + xml // mismo char en string JS
  return xml
}

const BASE_TASK = (overrides: Partial<FxTask>): FxTask => ({
  uid: 1,
  name: 'Tarea',
  start: '2026-05-04T08:00:00',
  finish: '2026-05-08T17:00:00',
  outlineNumber: '1',
  outlineLevel: 1,
  ...overrides,
})

// ───────────────────────── stripBom ─────────────────────────

describe('stripBom', () => {
  it('quita BOM U+FEFF', () => {
    expect(stripBom('﻿hola')).toBe('hola')
  })
  it('respeta strings sin BOM', () => {
    expect(stripBom('hola')).toBe('hola')
  })
})

// ───────────────────────── parseMspXml básico ─────────────────────────

describe('parseMspXml · estructura básica', () => {
  it('parsea XML válido con 3 tasks', () => {
    const xml = buildXml({
      title: 'Proyecto X',
      tasks: [
        BASE_TASK({ uid: 1, name: 'A', outlineNumber: '1' }),
        BASE_TASK({ uid: 2, name: 'B', outlineNumber: '2' }),
        BASE_TASK({ uid: 3, name: 'C', outlineNumber: '3' }),
      ],
    })
    const out = parseMspXml(xml)
    expect(out.errors).toEqual([])
    expect(out.tasks.length).toBe(3)
    expect(out.projectName).toBe('Proyecto X')
    expect(out.tasks[0].externalId).toBe('msp-uid-1')
  })

  it('strip BOM UTF-8 y parsea OK', () => {
    const xml = buildXml({
      tasks: [BASE_TASK({})],
      bom: 'utf8',
    })
    const out = parseMspXml(xml)
    expect(out.errors).toEqual([])
    expect(out.tasks.length).toBe(1)
  })

  it('strip BOM UTF-16 (charCode 0xFEFF) y parsea OK', () => {
    const xml = buildXml({
      tasks: [BASE_TASK({})],
      bom: 'utf16le',
    })
    const out = parseMspXml(xml)
    expect(out.errors).toEqual([])
  })
})

// ───────────────────────── Validación de namespace ─────────────────────────

describe('parseMspXml · validación namespace (D11)', () => {
  it('XML sin namespace MSP → INVALID_FILE', () => {
    const xml = buildXml({
      tasks: [BASE_TASK({})],
      xmlns: null,
    })
    const out = parseMspXml(xml)
    expect(out.errors[0].code).toBe('INVALID_FILE')
    expect(out.errors[0].detail).toMatch(/namespace/i)
  })

  it('XML con namespace incorrecto (pre-2003) → INVALID_FILE', () => {
    const xml = buildXml({
      tasks: [BASE_TASK({})],
      xmlns: 'http://schemas.example.com/foo',
    })
    const out = parseMspXml(xml)
    expect(out.errors[0].code).toBe('INVALID_FILE')
  })

  it('XML vacío → INVALID_FILE', () => {
    const out = parseMspXml('')
    expect(out.errors[0].code).toBe('INVALID_FILE')
  })

  it('XML solo whitespace → INVALID_FILE', () => {
    const out = parseMspXml('   \n  \t  ')
    expect(out.errors[0].code).toBe('INVALID_FILE')
  })

  it('XML sin <Project> → INVALID_FILE', () => {
    const out = parseMspXml(
      '<?xml version="1.0"?><Foo xmlns="' + MSP_NS + '"><Bar/></Foo>',
    )
    expect(out.errors[0].code).toBe('INVALID_FILE')
  })
})

// ───────────────────────── UID y OutlineNumber ─────────────────────────

describe('parseMspXml · UIDs y jerarquía', () => {
  it('UID duplicado → DUPLICATE_MNEMONIC', () => {
    const xml = buildXml({
      tasks: [
        BASE_TASK({ uid: 7, name: 'A', outlineNumber: '1' }),
        BASE_TASK({ uid: 7, name: 'A2', outlineNumber: '2' }),
      ],
    })
    const out = parseMspXml(xml)
    expect(out.errors.some((e) => e.code === 'DUPLICATE_MNEMONIC')).toBe(true)
  })

  it('OutlineNumber resuelve jerarquía 1, 1.1, 1.2, 2', () => {
    const xml = buildXml({
      tasks: [
        BASE_TASK({ uid: 1, name: 'Root1', outlineNumber: '1' }),
        BASE_TASK({ uid: 2, name: 'Child1', outlineNumber: '1.1' }),
        BASE_TASK({ uid: 3, name: 'Child2', outlineNumber: '1.2' }),
        BASE_TASK({ uid: 4, name: 'Root2', outlineNumber: '2' }),
      ],
    })
    const out = parseMspXml(xml)
    expect(out.errors).toEqual([])
    const byExt = new Map(out.tasks.map((t) => [t.externalId, t]))
    expect(byExt.get('msp-uid-1')?.parentExternalId).toBeNull()
    expect(byExt.get('msp-uid-2')?.parentExternalId).toBe('msp-uid-1')
    expect(byExt.get('msp-uid-3')?.parentExternalId).toBe('msp-uid-1')
    expect(byExt.get('msp-uid-4')?.parentExternalId).toBeNull()
  })

  it('OutlineNumber duplicado → INVALID_FILE', () => {
    const xml = buildXml({
      tasks: [
        BASE_TASK({ uid: 1, outlineNumber: '1' }),
        BASE_TASK({ uid: 2, outlineNumber: '1' }),
      ],
    })
    const out = parseMspXml(xml)
    expect(out.errors.some((e) => e.code === 'INVALID_FILE')).toBe(true)
  })

  it('Tarea sin Start/Finish válidos → INVALID_ROW', () => {
    const xml = buildXml({
      tasks: [
        BASE_TASK({ uid: 1, start: 'not-a-date', finish: 'also-bad' }),
      ],
    })
    const out = parseMspXml(xml)
    expect(out.errors.some((e) => e.code === 'INVALID_ROW')).toBe(true)
  })
})

// ───────────────────────── PredecessorLink (tipos y lag) ─────────────────────────

describe('parseMspXml · PredecessorLink', () => {
  it('Type 0/1/2/3 mapea a FF/FS/SS/SF', () => {
    const xml = buildXml({
      tasks: [
        BASE_TASK({ uid: 1, outlineNumber: '1' }),
        BASE_TASK({
          uid: 2,
          outlineNumber: '2',
          predecessorLinks: [
            { predecessorUid: 1, type: 0 },
            { predecessorUid: 1, type: 1 },
            { predecessorUid: 1, type: 2 },
            { predecessorUid: 1, type: 3 },
          ],
        }),
      ],
    })
    const out = parseMspXml(xml)
    expect(out.errors).toEqual([])
    const types = out.deps.map((d) => d.type)
    expect(types).toEqual(['FF', 'FS', 'SS', 'SF'])
  })

  it('LinkLag=4800 → 1d', () => {
    const xml = buildXml({
      tasks: [
        BASE_TASK({ uid: 1, outlineNumber: '1' }),
        BASE_TASK({
          uid: 2,
          outlineNumber: '2',
          predecessorLinks: [{ predecessorUid: 1, type: 1, linkLag: 4800 }],
        }),
      ],
    })
    const out = parseMspXml(xml)
    expect(out.deps[0].lagDays).toBe(1)
  })

  it('LinkLag=-9600 → -2d (lead negativo, D19)', () => {
    const xml = buildXml({
      tasks: [
        BASE_TASK({ uid: 1, outlineNumber: '1' }),
        BASE_TASK({
          uid: 2,
          outlineNumber: '2',
          predecessorLinks: [{ predecessorUid: 1, type: 1, linkLag: -9600 }],
        }),
      ],
    })
    const out = parseMspXml(xml)
    expect(out.deps[0].lagDays).toBe(-2)
  })

  it('LinkLag muy grande → clamp a 365 + warning LAG_CLAMPED', () => {
    const xml = buildXml({
      tasks: [
        BASE_TASK({ uid: 1, outlineNumber: '1' }),
        BASE_TASK({
          uid: 2,
          outlineNumber: '2',
          predecessorLinks: [
            // 400 días * 4800 = 1_920_000
            { predecessorUid: 1, type: 1, linkLag: 1_920_000 },
          ],
        }),
      ],
    })
    const out = parseMspXml(xml)
    expect(out.deps[0].lagDays).toBe(365)
    expect(out.warnings.some((w) => w.code === 'LAG_CLAMPED')).toBe(true)
  })

  it('PredecessorUID inexistente → ORPHAN_DEPENDENCY', () => {
    const xml = buildXml({
      tasks: [
        BASE_TASK({
          uid: 1,
          outlineNumber: '1',
          predecessorLinks: [{ predecessorUid: 999, type: 1 }],
        }),
      ],
    })
    const out = parseMspXml(xml)
    expect(out.errors.some((e) => e.code === 'ORPHAN_DEPENDENCY')).toBe(true)
  })

  it('Ciclo A→B→A → CYCLE_DETECTED', () => {
    const xml = buildXml({
      tasks: [
        BASE_TASK({
          uid: 1,
          outlineNumber: '1',
          predecessorLinks: [{ predecessorUid: 2, type: 1 }],
        }),
        BASE_TASK({
          uid: 2,
          outlineNumber: '2',
          predecessorLinks: [{ predecessorUid: 1, type: 1 }],
        }),
      ],
    })
    const out = parseMspXml(xml)
    expect(out.errors.some((e) => e.code === 'CYCLE_DETECTED')).toBe(true)
  })
})

// ───────────────────────── Resources & Assignments ─────────────────────────

describe('parseMspXml · Resources y Assignments', () => {
  it('Resource sin EmailAddress no aborta', () => {
    const xml = buildXml({
      tasks: [BASE_TASK({})],
      resources: [{ uid: 10, name: 'Alguien' }],
    })
    const out = parseMspXml(xml)
    // El parser solo reporta tasks-mismatch; el warning RESOURCE_NO_MATCH
    // por email vacío se emite en la action. Aquí basta que no haya error
    // y el resource haya entrado.
    expect(out.errors).toEqual([])
    expect(out.resources.length).toBe(1)
    expect(out.resources[0].email).toBeNull()
  })

  it('Resource Type=0 (Material) → MATERIAL_RESOURCE_IGNORED', () => {
    const xml = buildXml({
      tasks: [BASE_TASK({})],
      resources: [{ uid: 10, name: 'Cemento', type: 0 }],
    })
    const out = parseMspXml(xml)
    expect(
      out.warnings.some((w) => w.code === 'MATERIAL_RESOURCE_IGNORED'),
    ).toBe(true)
    expect(out.resources.length).toBe(0)
  })

  it('Múltiples assignments para una task → MULTIPLE_ASSIGNMENTS_IGNORED', () => {
    const xml = buildXml({
      tasks: [BASE_TASK({ uid: 1 })],
      resources: [
        { uid: 10, name: 'A', email: 'a@x.com' },
        { uid: 11, name: 'B', email: 'b@x.com' },
      ],
      assignments: [
        { taskUid: 1, resourceUid: 10 },
        { taskUid: 1, resourceUid: 11 },
      ],
    })
    const out = parseMspXml(xml)
    expect(
      out.warnings.some((w) => w.code === 'MULTIPLE_ASSIGNMENTS_IGNORED'),
    ).toBe(true)
  })
})

// ───────────────────────── Constraints, Calendars, Active ─────────────────────────

describe('parseMspXml · constraints/calendars/active', () => {
  it('ConstraintType > 0 → CONSTRAINT_IGNORED', () => {
    const xml = buildXml({
      tasks: [BASE_TASK({ constraintType: 4 })],
    })
    const out = parseMspXml(xml)
    expect(out.warnings.some((w) => w.code === 'CONSTRAINT_IGNORED')).toBe(true)
  })

  it('CalendarUID custom (>1) → CALENDAR_IGNORED', () => {
    const xml = buildXml({
      tasks: [BASE_TASK({ calendarUid: 5 })],
    })
    const out = parseMspXml(xml)
    expect(out.warnings.some((w) => w.code === 'CALENDAR_IGNORED')).toBe(true)
  })

  it('Active=0 → INACTIVE_TASK_SKIPPED + skip', () => {
    const xml = buildXml({
      tasks: [
        BASE_TASK({ uid: 1, name: 'Active', outlineNumber: '1' }),
        BASE_TASK({ uid: 2, name: 'Skipped', outlineNumber: '2', active: 0 }),
      ],
    })
    const out = parseMspXml(xml)
    expect(out.tasks.length).toBe(1)
    expect(
      out.warnings.some((w) => w.code === 'INACTIVE_TASK_SKIPPED'),
    ).toBe(true)
  })
})

// ───────────────────────── Priority enum ─────────────────────────

describe('parseMspXml · Priority mapping', () => {
  it.each([
    [0, 'LOW'],
    [200, 'LOW'],
    [300, 'MEDIUM'],
    [499, 'MEDIUM'],
    [500, 'HIGH'],
    [749, 'HIGH'],
    [750, 'CRITICAL'],
    [999, 'CRITICAL'],
  ])('Priority MSP=%d → enum %s', (msp, expected) => {
    const xml = buildXml({
      tasks: [BASE_TASK({ priority: msp })],
    })
    const out = parseMspXml(xml)
    expect(out.tasks[0].priority).toBe(expected)
  })
})
