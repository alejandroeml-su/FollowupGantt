/**
 * HU-4.0 · Generador de fixtures pseudo-reales MSP XML 2003+.
 *
 * Tres archivos en `tests/e2e/_fixtures/msp-real/` que simulan proyectos
 * Avante reales (no solo el sintético del POC). Consumidos por la suite
 * `tests/unit/msp-pseudoreal.test.ts` (parametrizada) cuando el parser
 * HU-4.1 mergee.
 *
 * Salidas (NO se commitean — ver `.gitignore` del directorio):
 *   - tests/e2e/_fixtures/msp-real/proyecto-pequeño.xml  (~30 tasks · 2 fases · 5 deps · 3 recursos)
 *   - tests/e2e/_fixtures/msp-real/proyecto-medio.xml    (~150 tasks · 5 fases · 30 deps · 10 recursos)
 *   - tests/e2e/_fixtures/msp-real/proyecto-grande.xml   (~500 tasks · 10 fases · 100 deps · 25 recursos)
 *
 * Características clave (todas presentes en cada fixture, escaladas por tamaño):
 *   - Jerarquía de fases con OutlineNumber `1`, `1.1`, `1.1.1`, `1.1.1.1` (4 niveles).
 *   - Tipo de dependencia: 70% FS, 15% SS, 10% FF, 5% SF.
 *   - Lag positivo, negativo (lead) y zero — distribuidos con módulo determinístico.
 *   - 5% de las tareas son milestones (`Milestone=1`).
 *   - 1 task con BOM UTF-8 al inicio del archivo (test de stripping en parser).
 *   - 1 task con `Active=0` (debería ignorarse por parser).
 *   - 1 Resource sin EmailAddress (genera warning RESOURCE_NO_MATCH).
 *   - 1 Assignment con `>1` Resource por Task (genera warning MULTIPLE_ASSIGNMENTS_IGNORED).
 *   - 1 PredecessorLink con LinkLag muy grande (>365 days, debería clamparse).
 *   - Algunos OutlineNumber con `0` para representar root virtual MSP.
 *
 * Uso:
 *   npx tsx scripts/gen-pseudoreal-fixtures.ts                    # genera los 3
 *   npx tsx scripts/gen-pseudoreal-fixtures.ts --only=pequeno     # solo pequeño
 *   npx tsx scripts/gen-pseudoreal-fixtures.ts --only=medio
 *   npx tsx scripts/gen-pseudoreal-fixtures.ts --only=grande
 *
 * Cuándo regenerar:
 *   - Cuando el parser HU-4.1 cambie su contrato de validación (warnings nuevos).
 *   - Cuando se añadan tipos de tarea/dependencia adicionales al esquema.
 *   - NUNCA en CI: los XML están en `.gitignore`. Cada agente que toque la suite
 *     pseudo-real debe regenerar localmente antes de correr los tests.
 *
 * Convenciones:
 *   - Determinístico: la misma invocación produce el mismo XML byte a byte
 *     (no usa `Math.random`). Esto facilita debugging de tests parametrizados.
 *   - UTF-8 con BOM en `proyecto-grande.xml` (caso explícito de stripBom).
 *   - Sin BOM en `proyecto-pequeño.xml` y `proyecto-medio.xml`.
 *   - Nombres de tareas en español, realistas Avante: "Diseño DB", "Migración
 *     legacy", "Pruebas QA", "Despliegue producción", etc.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { performance } from 'node:perf_hooks'
import { XMLBuilder } from 'fast-xml-parser'

const FIXTURES_DIR = path.resolve(
  __dirname,
  '..',
  'tests',
  'e2e',
  '_fixtures',
  'msp-real',
)

// MSP usa códigos numéricos para tipo de PredecessorLink:
//   FF=0, FS=1, SS=2, SF=3
const MSP_LINK_TYPE: Record<DepType, string> = {
  FF: '0',
  FS: '1',
  SS: '2',
  SF: '3',
}

type DepType = 'FS' | 'SS' | 'FF' | 'SF'

interface FixtureSpec {
  filename: string
  taskCount: number
  phaseCount: number
  depCount: number
  resourceCount: number
  withBom: boolean
}

const FIXTURE_SPECS: Record<'pequeno' | 'medio' | 'grande', FixtureSpec> = {
  pequeno: {
    filename: 'proyecto-pequeño.xml',
    taskCount: 30,
    phaseCount: 2,
    depCount: 5,
    resourceCount: 3,
    withBom: false,
  },
  medio: {
    filename: 'proyecto-medio.xml',
    taskCount: 150,
    phaseCount: 5,
    depCount: 30,
    resourceCount: 10,
    withBom: false,
  },
  grande: {
    filename: 'proyecto-grande.xml',
    taskCount: 500,
    phaseCount: 10,
    depCount: 100,
    resourceCount: 25,
    withBom: true,
  },
}

/**
 * Vocabulario realista Avante. La generación rota estos fragmentos para
 * crear nombres como "Diseño DB · módulo crédito", "Pruebas QA · ETL nómina",
 * "Despliegue producción · API gateway", etc.
 */
const ACTIVITIES = [
  'Diseño DB',
  'Migración legacy',
  'Pruebas QA',
  'Despliegue producción',
  'Análisis requerimientos',
  'Configuración entorno',
  'Implementación servicio',
  'Refactor módulo',
  'Validación stakeholders',
  'Documentación técnica',
  'Capacitación usuarios',
  'Auditoría seguridad',
  'Revisión código',
  'Integración API',
  'Optimización query',
  'Backup pre-cutover',
  'Smoke test post-deploy',
  'Rollback plan',
  'Diseño UX',
  'Hardening servidor',
]

const SUBJECTS = [
  'módulo crédito',
  'ETL nómina',
  'API gateway',
  'portal proveedores',
  'integración SAP',
  'dashboard ejecutivo',
  'autenticación SSO',
  'pipeline CI/CD',
  'reporte regulatorio',
  'módulo cobranza',
  'app móvil empleados',
  'capa semántica BI',
  'migración Oracle→Postgres',
  'auditoría compliance',
  'flujo aprobaciones',
]

const PHASE_NAMES = [
  'Inicio',
  'Análisis',
  'Diseño',
  'Construcción',
  'Pruebas',
  'Implantación',
  'Estabilización',
  'Cierre',
  'Operación temprana',
  'Garantía post-go-live',
  'Capacitación',
  'Documentación',
]

const RESOURCE_NAMES = [
  'Ana Torres',
  'Carlos Méndez',
  'Diana Ruiz',
  'Esteban Vargas',
  'Fátima Lugo',
  'Gabriel Soto',
  'Helena Cruz',
  'Ignacio Pardo',
  'Julia Herrera',
  'Kevin Alarcón',
  'Lourdes Rivas',
  'Mario Quiroz',
  'Nora Bustos',
  'Óscar Peña',
  'Paula Restrepo',
  'Quirino Jaramillo',
  'Rosa Lemus',
  'Sergio Ávalos',
  'Tania Velasco',
  'Ulises Cardona',
  'Valeria Méndez',
  'Wilmer Cano',
  'Ximena Olarte',
  'Yamil Berrío',
  'Zulema Ortega',
]

const ROLES = ['PM', 'Tech Lead', 'Dev', 'QA', 'Analista', 'DBA', 'DevOps']

interface TaskNode {
  uid: number
  name: string
  outlineLevel: number
  outlineNumber: string
  isPhase: boolean
  isMilestone: boolean
  isInactive: boolean
  start: Date
  finish: Date
  durationDays: number
  notes: string
  parentUid: number | null
}

interface DepLink {
  predecessorUid: number
  successorUid: number
  type: DepType
  /** Lag en tenths of minutes (MSP). 4800 = 1 día (8h × 60 × 10). */
  linkLag: number
}

interface ResourceRow {
  uid: number
  name: string
  email: string | null
  role: string
}

interface AssignmentRow {
  uid: number
  taskUid: number
  resourceUid: number
  units: number
}

interface Bag {
  tasks: TaskNode[]
  deps: DepLink[]
  resources: ResourceRow[]
  assignments: AssignmentRow[]
}

/**
 * Crea jerarquía de fases con OutlineNumber `1`, `1.1`, `1.1.1`, `1.1.1.1`
 * hasta 4 niveles. La distribución se reparte uniforme entre `phaseCount`
 * fases top-level. Una de las fases incluye un sub-fase con OutlineNumber `0`
 * para simular el "root virtual" que MSP a veces emite (parser debe ignorarlo).
 */
function buildHierarchy(spec: FixtureSpec): TaskNode[] {
  const baseDate = new Date(Date.UTC(2026, 0, 5)) // 2026-01-05 (lunes)
  const tasks: TaskNode[] = []
  let uid = 1

  const tasksPerPhase = Math.floor(spec.taskCount / spec.phaseCount)
  let dayCursor = 0

  for (let p = 1; p <= spec.phaseCount; p++) {
    const phaseName = PHASE_NAMES[(p - 1) % PHASE_NAMES.length]
    const phaseUid = uid++
    const phaseStart = addDays(baseDate, dayCursor)
    // Las fases agrupan a sus hijos; la duración se reescribe al final.
    tasks.push({
      uid: phaseUid,
      name: `Fase ${p} · ${phaseName}`,
      outlineLevel: 1,
      outlineNumber: String(p),
      isPhase: true,
      isMilestone: false,
      isInactive: false,
      start: phaseStart,
      finish: phaseStart,
      durationDays: 0,
      notes: `Fase ${p} del proyecto. Agrupa entregables de ${phaseName.toLowerCase()}.`,
      parentUid: null,
    })

    // Construye 3-4 sub-fases de nivel 2 con OutlineNumber p.k
    const subPhaseCount = Math.min(4, Math.max(2, Math.floor(tasksPerPhase / 8)))
    const tasksLeftInPhase = tasksPerPhase - 1 // -1 por la fase top-level
    const tasksPerSubPhase = Math.max(1, Math.floor(tasksLeftInPhase / subPhaseCount))

    for (let sp = 1; sp <= subPhaseCount; sp++) {
      const subPhaseUid = uid++
      const isVirtualRoot = p === 1 && sp === 1 // primera fase, primer sub-fase: outline "0"
      const subStart = addDays(baseDate, dayCursor)
      tasks.push({
        uid: subPhaseUid,
        name: `Subfase ${p}.${sp} · ${SUBJECTS[(sp - 1) % SUBJECTS.length]}`,
        outlineLevel: 2,
        outlineNumber: isVirtualRoot ? '0' : `${p}.${sp}`,
        isPhase: true,
        isMilestone: false,
        isInactive: false,
        start: subStart,
        finish: subStart,
        durationDays: 0,
        notes: `Sub-fase de la Fase ${p}.`,
        parentUid: phaseUid,
      })

      // Nivel 3 (paquetes) — solo en la primera sub-fase de cada fase para no
      // explotar el conteo en fixtures pequeños.
      let level3Uid: number | null = null
      let level4Uid: number | null = null
      if (sp === 1 && tasksPerSubPhase > 4) {
        level3Uid = uid++
        const l3Start = addDays(baseDate, dayCursor)
        tasks.push({
          uid: level3Uid,
          name: `Paquete ${p}.${sp}.1 · ${ACTIVITIES[(p - 1) % ACTIVITIES.length]}`,
          outlineLevel: 3,
          outlineNumber: `${p}.${sp}.1`,
          isPhase: true,
          isMilestone: false,
          isInactive: false,
          start: l3Start,
          finish: l3Start,
          durationDays: 0,
          notes: `Paquete de trabajo bajo ${p}.${sp}.`,
          parentUid: subPhaseUid,
        })

        // Nivel 4 (subpaquete) — solo 1 por fixture grande
        if (spec.taskCount >= 150 && p === 1) {
          level4Uid = uid++
          const l4Start = addDays(baseDate, dayCursor)
          tasks.push({
            uid: level4Uid,
            name: `Subpaquete ${p}.${sp}.1.1 · detalles técnicos`,
            outlineLevel: 4,
            outlineNumber: `${p}.${sp}.1.1`,
            isPhase: true,
            isMilestone: false,
            isInactive: false,
            start: l4Start,
            finish: l4Start,
            durationDays: 0,
            notes: `Subpaquete técnico bajo ${p}.${sp}.1.`,
            parentUid: level3Uid,
          })
        }
      }

      // Hojas reales bajo el último contenedor creado (nivel 2, 3 ó 4).
      const leafParentUid = level4Uid ?? level3Uid ?? subPhaseUid
      const leafParentLevel = level4Uid ? 4 : level3Uid ? 3 : 2
      const leafOutlineBase = tasks.find((t) => t.uid === leafParentUid)!.outlineNumber

      for (let i = 1; i <= tasksPerSubPhase && tasks.length < spec.taskCount; i++) {
        const leafUid = uid++
        const activity = ACTIVITIES[(uid * 7) % ACTIVITIES.length]
        const subject = SUBJECTS[(uid * 11) % SUBJECTS.length]
        const duration = ((uid * 3) % 5) + 1 // 1-5 días
        const start = addDays(baseDate, dayCursor)
        const finish = addDays(start, duration - 1)
        dayCursor += 1 // staggered start: cada hoja arranca 1 día después

        const isMilestone = (leafUid * 19) % 20 === 0 // ~5%

        tasks.push({
          uid: leafUid,
          name: `${activity} · ${subject}`,
          outlineLevel: leafParentLevel + 1,
          outlineNumber: `${leafOutlineBase}.${i}`,
          isPhase: false,
          isMilestone,
          isInactive: false,
          start,
          finish: isMilestone ? start : finish,
          durationDays: isMilestone ? 0 : duration,
          notes: `${activity} aplicada a ${subject}. Generada automáticamente para fixture pseudo-real.`,
          parentUid: leafParentUid,
        })

        if (tasks.length >= spec.taskCount) break
      }
      if (tasks.length >= spec.taskCount) break
    }
    if (tasks.length >= spec.taskCount) break
  }

  // Casos especiales (siempre presentes, sobre las últimas hojas):
  //   - 1 task `Active=0` (inactiva)
  //   - 1 task con BOM si spec.withBom (manejado al escribir, no aquí)
  const lastLeaves = tasks.filter((t) => !t.isPhase)
  if (lastLeaves.length > 0) {
    const inactive = lastLeaves[lastLeaves.length - 1]
    inactive.isInactive = true
    inactive.notes += ' (TASK INACTIVA · debe ignorarse por parser)'
  }

  // Recalcular start/finish de fases agregando hijos.
  recalcPhaseSpans(tasks)

  return tasks
}

function recalcPhaseSpans(tasks: TaskNode[]): void {
  // Mapa parent → hijos
  const childrenByParent = new Map<number, TaskNode[]>()
  for (const t of tasks) {
    if (t.parentUid === null) continue
    const arr = childrenByParent.get(t.parentUid) ?? []
    arr.push(t)
    childrenByParent.set(t.parentUid, arr)
  }
  // Procesar de hojas hacia raíz: como `tasks` ya está en orden DFS,
  // iterar reverso garantiza que los hijos estén calculados antes de su parent.
  const taskByUid = new Map(tasks.map((t) => [t.uid, t]))
  for (let i = tasks.length - 1; i >= 0; i--) {
    const t = tasks[i]
    if (!t.isPhase) continue
    const kids = childrenByParent.get(t.uid) ?? []
    if (kids.length === 0) continue
    // Resolver descendientes recursivamente: tomar min/max de hojas.
    const stack: TaskNode[] = [...kids]
    let minStart: Date | null = null
    let maxFinish: Date | null = null
    while (stack.length > 0) {
      const cur = stack.pop()!
      if (!cur.isPhase) {
        if (minStart === null || cur.start < minStart) minStart = cur.start
        if (maxFinish === null || cur.finish > maxFinish) maxFinish = cur.finish
      } else {
        const grand = childrenByParent.get(cur.uid) ?? []
        for (const g of grand) stack.push(g)
      }
    }
    if (minStart && maxFinish) {
      t.start = minStart
      t.finish = maxFinish
      t.durationDays = Math.max(
        1,
        Math.round((maxFinish.getTime() - minStart.getTime()) / 86_400_000) + 1,
      )
    }
    // Silenciar lints de variable no usada
    void taskByUid
  }
}

/**
 * Construye dependencias respetando la mezcla 70/15/10/5 y variando lag
 * (positivo, negativo, zero). Inserta exactamente 1 dependencia con LinkLag
 * fuera de rango (>365 días) para validar el clamp del parser.
 */
function buildDependencies(spec: FixtureSpec, tasks: TaskNode[]): DepLink[] {
  const leaves = tasks.filter((t) => !t.isPhase && !t.isInactive)
  const deps: DepLink[] = []
  const target = Math.min(spec.depCount, Math.max(0, leaves.length - 1))

  // Distribución acumulada: 70 FS, 15 SS, 10 FF, 5 SF
  function pickType(i: number): DepType {
    const r = i % 100
    if (r < 70) return 'FS'
    if (r < 85) return 'SS'
    if (r < 95) return 'FF'
    return 'SF'
  }

  // Lag pattern determinístico:
  //   i % 5 === 0 → +1 día (4800)
  //   i % 5 === 1 → -1 día (-4800) [lead]
  //   i % 5 === 2 →  0
  //   i % 5 === 3 → +2 días (9600)
  //   i % 5 === 4 →  0
  function pickLag(i: number): number {
    const r = i % 5
    if (r === 0) return 4800
    if (r === 1) return -4800
    if (r === 3) return 9600
    return 0
  }

  for (let i = 0; i < target; i++) {
    const pred = leaves[i % leaves.length]
    const succ = leaves[(i + 1) % leaves.length]
    if (pred.uid === succ.uid) continue
    deps.push({
      predecessorUid: pred.uid,
      successorUid: succ.uid,
      type: pickType(i),
      linkLag: pickLag(i),
    })
  }

  // 1 dep con lag fuera de rango (>365 días) — debe clamparse en parser.
  if (deps.length > 0) {
    deps[deps.length - 1].linkLag = 4800 * 400 // 400 días
  }

  return deps
}

function buildResources(spec: FixtureSpec): ResourceRow[] {
  const out: ResourceRow[] = []
  for (let i = 0; i < spec.resourceCount; i++) {
    const name = RESOURCE_NAMES[i % RESOURCE_NAMES.length]
    const slug = name.toLowerCase().replace(/\s+/g, '.').normalize('NFD').replace(/[̀-ͯ]/g, '')
    out.push({
      uid: i + 1,
      name,
      // Recurso #1 (índice 0) sin email para forzar warning RESOURCE_NO_MATCH.
      email: i === 0 ? null : `${slug}@complejoavante.com`,
      role: ROLES[i % ROLES.length],
    })
  }
  return out
}

/**
 * Construye assignments. Garantiza que existe al menos 1 task con >1 recurso
 * asignado (warning MULTIPLE_ASSIGNMENTS_IGNORED en parser).
 */
function buildAssignments(
  tasks: TaskNode[],
  resources: ResourceRow[],
): AssignmentRow[] {
  const leaves = tasks.filter((t) => !t.isPhase && !t.isInactive)
  const out: AssignmentRow[] = []
  let assignmentUid = 1

  // Asignación 1 recurso por hoja (round-robin sobre `resources`).
  for (let i = 0; i < leaves.length; i++) {
    const t = leaves[i]
    const r = resources[i % resources.length]
    out.push({
      uid: assignmentUid++,
      taskUid: t.uid,
      resourceUid: r.uid,
      units: 1,
    })
  }

  // Caso especial: la primera hoja con >=2 recursos (asignamos un 2do).
  if (leaves.length > 0 && resources.length > 1) {
    out.push({
      uid: assignmentUid++,
      taskUid: leaves[0].uid,
      resourceUid: resources[1].uid,
      units: 0.5,
    })
  }

  return out
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime())
  out.setUTCDate(out.getUTCDate() + days)
  return out
}

function fmtDateTime(d: Date): string {
  // ISO-like sin Z, MSP-friendly: `yyyy-MM-ddTHH:mm:ss`
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T08:00:00`
}

/**
 * Serializa el bag a XML MSP 2003+. La forma sigue el schema oficial de
 * `xmlns:http://schemas.microsoft.com/project`. Atributos solo donde MSP
 * los exige (xmlns en Project); el resto son elementos.
 */
function serializeMsp(bag: Bag, opts: { withBom: boolean; title: string }): string {
  // Predecessor links agrupados por successor
  const linksBySuccessor = new Map<number, DepLink[]>()
  for (const d of bag.deps) {
    const arr = linksBySuccessor.get(d.successorUid) ?? []
    arr.push(d)
    linksBySuccessor.set(d.successorUid, arr)
  }

  const mspTasks = bag.tasks.map((t) => {
    const links = linksBySuccessor.get(t.uid) ?? []
    const taskObj: Record<string, unknown> = {
      UID: t.uid,
      ID: t.uid,
      Name: t.name,
      Active: t.isInactive ? 0 : 1,
      Manual: 0,
      Type: t.isMilestone ? 1 : 0,
      OutlineLevel: t.outlineLevel,
      OutlineNumber: t.outlineNumber,
      Start: fmtDateTime(t.start),
      Finish: fmtDateTime(t.finish),
      Duration: msDuration(t.durationDays),
      DurationFormat: 7,
      Milestone: t.isMilestone ? 1 : 0,
      Summary: t.isPhase ? 1 : 0,
      PercentComplete: 0,
      Notes: t.notes,
    }
    if (links.length > 0) {
      taskObj.PredecessorLink = links.map((l) => ({
        PredecessorUID: l.predecessorUid,
        Type: MSP_LINK_TYPE[l.type],
        LinkLag: l.linkLag,
        LagFormat: 7,
      }))
    }
    return taskObj
  })

  const mspResources = bag.resources.map((r) => {
    const obj: Record<string, unknown> = {
      UID: r.uid,
      ID: r.uid,
      Name: r.name,
      Type: 1,
      Initials: r.name.split(' ').map((s) => s[0] ?? '').join(''),
    }
    if (r.email !== null) obj.EmailAddress = r.email
    return obj
  })

  const mspAssignments = bag.assignments.map((a) => ({
    UID: a.uid,
    TaskUID: a.taskUid,
    ResourceUID: a.resourceUid,
    Units: a.units,
  }))

  const projectStart = bag.tasks[0]?.start ?? new Date()
  const projectFinish = bag.tasks
    .map((t) => t.finish)
    .reduce((acc, d) => (d > acc ? d : acc), projectStart)

  const project = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8', '@_standalone': 'yes' },
    Project: {
      '@_xmlns': 'http://schemas.microsoft.com/project',
      Name: opts.title,
      Title: opts.title,
      Author: 'FollowupGantt HU-4.0 fixture pseudo-real',
      SaveVersion: 14,
      StartDate: fmtDateTime(projectStart),
      FinishDate: fmtDateTime(projectFinish),
      Tasks: { Task: mspTasks },
      Resources: { Resource: mspResources },
      Assignments: { Assignment: mspAssignments },
    },
  }

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    format: true,
    indentBy: '  ',
    suppressEmptyNode: false,
    processEntities: true,
  })
  let xml = builder.build(project)
  if (opts.withBom) xml = '﻿' + xml
  return xml
}

/**
 * MSP expresa Duration como ISO 8601 PT-format: `PT8H0M0S` por día (jornada
 * de 8h). Suficiente para que el parser la reconozca; la implementación real
 * de HU-4.1 es libre de aceptar también minutos puros.
 */
function msDuration(days: number): string {
  if (days <= 0) return 'PT0H0M0S'
  return `PT${days * 8}H0M0S`
}

function generateOne(
  key: 'pequeno' | 'medio' | 'grande',
  spec: FixtureSpec,
): { path: string; bytes: number; ms: number; tasks: number; deps: number } {
  const t0 = performance.now()
  const tasks = buildHierarchy(spec)
  const deps = buildDependencies(spec, tasks)
  const resources = buildResources(spec)
  const assignments = buildAssignments(tasks, resources)
  const xml = serializeMsp(
    { tasks, deps, resources, assignments },
    {
      withBom: spec.withBom,
      title: `Fixture pseudo-real ${key} (${spec.taskCount} tareas)`,
    },
  )
  const out = path.join(FIXTURES_DIR, spec.filename)
  fs.writeFileSync(out, xml, { encoding: 'utf-8' })
  const bytes = fs.statSync(out).size
  return {
    path: out,
    bytes,
    ms: Math.round(performance.now() - t0),
    tasks: tasks.length,
    deps: deps.length,
  }
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function parseOnly(argv: string[]): 'pequeno' | 'medio' | 'grande' | 'all' {
  for (const a of argv.slice(2)) {
    const m = a.match(/^--only=(.+)$/)
    if (!m) continue
    const v = m[1]
    if (v === 'pequeno' || v === 'medio' || v === 'grande') return v
  }
  return 'all'
}

function main(): void {
  ensureDir(FIXTURES_DIR)
  const only = parseOnly(process.argv)
  const keys: Array<'pequeno' | 'medio' | 'grande'> =
    only === 'all' ? ['pequeno', 'medio', 'grande'] : [only]

  console.log(`[gen-pseudoreal-fixtures] dir=${FIXTURES_DIR}`)
  for (const k of keys) {
    const spec = FIXTURE_SPECS[k]
    const r = generateOne(k, spec)
    console.log(
      `[${k}] ${path.basename(r.path)} -> tasks=${r.tasks} deps=${r.deps} ` +
        `bytes=${r.bytes} (${(r.bytes / 1024).toFixed(1)} KB) ${r.ms}ms ` +
        `bom=${spec.withBom ? 'yes' : 'no'}`,
    )
  }
  console.log('[OK] gen-pseudoreal-fixtures done')
}

main()
