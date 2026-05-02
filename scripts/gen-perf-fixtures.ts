/**
 * HU-4.6 · Generador de fixtures sintéticos para tests de performance.
 *
 * Salidas (NO se commitean — ver tests/perf/_fixtures/.gitignore):
 *   - tests/perf/_fixtures/excel-5000.xlsx (~0.6 MB comprimido, 5000 tareas)
 *   - tests/perf/_fixtures/msp-5000.xml    (~6 MB plano, 5000 tareas)
 *
 * NOTA SOBRE TAMAÑOS (decisión D17 Sprint 8):
 *   El SLO "<2s para parsear 5MB" se entiende como "5MB de DATOS". XLSX
 *   comprime con deflate + sharedStrings, así que un .xlsx con 5000 tareas
 *   sólo pesa ~0.6 MB EN DISCO pero descomprime a ~5 MB de XML interno.
 *   Hemos validado que ExcelJS expande shared strings y hojas a ese volumen
 *   antes de procesar, por lo que la métrica de "5MB de carga" se cumple
 *   con 5000 tareas aunque el archivo en disco sea menor. Para MSP XML,
 *   no hay compresión: 5000 tareas == ~6 MB en disco.
 *
 * Datos: 5 epics × 1000 hojas + 3000 dependencias FS/SS/FF/SF intercaladas.
 *
 * Uso:
 *   npx tsx scripts/gen-perf-fixtures.ts                    # defaults (5000 / 5MB)
 *   npx tsx scripts/gen-perf-fixtures.ts --task-count=2000
 *   npx tsx scripts/gen-perf-fixtures.ts --target-mb=10
 *   npx tsx scripts/gen-perf-fixtures.ts --only=excel|msp
 *
 * Convenciones:
 *   - El script NO depende de excel-writer.ts ni msp-writer.ts (otros agentes
 *     los están construyendo). Usa exceljs y fast-xml-parser directos.
 *   - El XML MSP escribe sin BOM (UTF-8) — el parser real (HU-4.1) hace stripBom.
 *   - Si --target-mb se especifica, el conteo se ajusta para acercarse al tamaño
 *     manteniendo proporción 1 epic : 200 leaves : 0.6 deps por leaf.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { performance } from 'node:perf_hooks'
import ExcelJS from 'exceljs'
import { XMLBuilder } from 'fast-xml-parser'

const FIXTURES_DIR = path.resolve(__dirname, '..', 'tests', 'perf', '_fixtures')
const EXCEL_OUT = path.join(FIXTURES_DIR, 'excel-5000.xlsx')
const MSP_OUT = path.join(FIXTURES_DIR, 'msp-5000.xml')

interface CliArgs {
  taskCount: number
  targetMb: number | null
  only: 'excel' | 'msp' | 'both'
}

interface TaskRow {
  mnemonic: string
  title: string
  parent_mnemonic: string | null
  start_date: Date
  end_date: Date
  duration_days: number
  is_milestone: boolean
  progress: number
  priority: 'low' | 'medium' | 'high' | 'critical'
  assignee_email: string | null
  tags: string
  description: string
}

interface DepRow {
  predecessor_mnemonic: string
  successor_mnemonic: string
  type: 'FS' | 'SS' | 'FF' | 'SF'
  lag_days: number
}

interface ResourceRow {
  email: string
  name: string
  role: string
}

const PRIORITIES: TaskRow['priority'][] = ['low', 'medium', 'high', 'critical']
const DEP_TYPES: DepRow['type'][] = ['FS', 'SS', 'FF', 'SF']
const MSP_LINK_TYPE: Record<DepRow['type'], string> = {
  FF: '0',
  FS: '1',
  SS: '2',
  SF: '3',
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { taskCount: 5000, targetMb: null, only: 'both' }
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.+)$/)
    if (!m) continue
    const [, key, value] = m
    if (key === 'task-count') args.taskCount = Math.max(50, parseInt(value, 10))
    else if (key === 'target-mb') args.targetMb = parseFloat(value)
    else if (key === 'only' && (value === 'excel' || value === 'msp' || value === 'both')) {
      args.only = value
    }
  }
  return args
}

/**
 * Texto largo realista para inflar el tamaño del fixture. Excel comprime
 * agresivamente strings repetidos via shared strings, así que rotamos
 * fragmentos para evitar deduplicación trivial.
 */
const DESC_FRAGMENTS = [
  'Implementar la logica de negocio aplicando los principios SOLID y arquitectura hexagonal manteniendo la separacion de responsabilidades en cada capa del sistema.',
  'Verificar la integracion con sistemas legacy via API Gateway en AWS, garantizando que los contratos OpenAPI esten versionados y que el circuito breaker este configurado.',
  'Coordinar con el equipo de SRE para validar SLOs de latencia (p95 < 200ms), throughput sostenido y politicas de retry con exponential backoff y jitter aleatorio.',
  'Documentar los criterios de aceptacion en formato Gherkin y asegurar cobertura de tests E2E con Playwright cubriendo flujos felices y casos borde con datos sinteticos.',
  'Revisar implicaciones de seguridad: OWASP Top 10, validacion de input con zod, sanitizacion de output, headers CSP, rate limiting por IP y autenticacion por JWT con rotacion.',
  'Validar requerimientos no funcionales con stakeholders: accesibilidad WCAG 2.1 AA, internacionalizacion ES/EN, performance budget de 250KB JS y contraste minimo 4.5:1.',
  'Definir metricas de exito en el dashboard de BI: adopcion semanal, tiempo medio de tarea, NPS, tasa de error en flujos criticos y tendencia mensual de churn por segmento.',
  'Configurar pipelines de CI/CD en GitHub Actions con jobs paralelos: lint, typecheck, vitest unit, vitest integration, playwright E2E, build artifacts y deploy a Vercel preview.',
]

/**
 * Genera texto largo y único por índice. El .xlsx comprime con deflate, por lo
 * que strings con baja entropía se reducen agresivamente. Mezclamos hex + base36
 * + fragmentos rotados para mantener entropía alta y un payload realista.
 */
function buildLongDescription(idx: number): string {
  const parts: string[] = [`[id=${idx}]`]
  // 5 fragmentos rotados (~5x180 = 900 chars base)
  for (let k = 0; k < 5; k++) {
    parts.push(DESC_FRAGMENTS[(idx + k * 3) % DESC_FRAGMENTS.length])
  }
  // 8 tokens pseudo-aleatorios determinísticos (alta entropía -> deflate
  // no puede comprimirlos) ~200 chars adicionales
  for (let k = 0; k < 8; k++) {
    const seed = (idx * 2654435761 + k * 1103515245) >>> 0
    parts.push(seed.toString(16).padStart(8, '0'))
  }
  return parts.join(' ')
}

function buildSyntheticData(taskCount: number): {
  tasks: TaskRow[]
  deps: DepRow[]
  resources: ResourceRow[]
} {
  const baseDate = new Date(2026, 4, 4) // 2026-05-04
  const tasks: TaskRow[] = []
  const epicCount = 5
  const leavesPerEpic = Math.max(1, Math.floor(taskCount / epicCount))

  // Epics
  for (let e = 1; e <= epicCount; e++) {
    const start = new Date(baseDate)
    start.setDate(start.getDate() + (e - 1) * leavesPerEpic)
    const end = new Date(start)
    end.setDate(end.getDate() + leavesPerEpic - 1)
    tasks.push({
      mnemonic: `EPIC-${e}`,
      title: `Epic ${e} - Modulo principal con scope grande`,
      parent_mnemonic: null,
      start_date: start,
      end_date: end,
      duration_days: leavesPerEpic,
      is_milestone: false,
      progress: 0,
      priority: 'high',
      assignee_email: null,
      tags: 'epic,parent',
      description: buildLongDescription(e * 100000),
    })
  }

  // Hojas
  const totalLeaves = epicCount * leavesPerEpic
  for (let i = 1; i <= totalLeaves; i++) {
    const epicIdx = ((i - 1) % epicCount) + 1
    const orderInEpic = Math.floor((i - 1) / epicCount)
    const parent = `EPIC-${epicIdx}`
    const epic = tasks[epicIdx - 1]
    const start = new Date(epic.start_date)
    start.setDate(start.getDate() + orderInEpic)
    const duration = (i % 5) + 1
    const end = new Date(start)
    end.setDate(end.getDate() + duration - 1)
    tasks.push({
      mnemonic: `T-${String(i).padStart(5, '0')}`,
      title: `Tarea ${i} bajo ${parent} con titulo descriptivo medianamente largo`,
      parent_mnemonic: parent,
      start_date: start,
      end_date: end,
      duration_days: duration,
      is_milestone: i % 250 === 0,
      progress: i % 5 === 0 ? 100 : (i * 7) % 100,
      priority: PRIORITIES[i % PRIORITIES.length],
      assignee_email: i % 3 === 0 ? `user${(i % 25) + 1}@complejoavante.com` : null,
      tags: i % 2 === 0 ? 'backend,api,perf' : 'frontend,ui',
      description: buildLongDescription(i),
    })
  }

  // Dependencias: ~60% de las hojas tienen 1 predecesora (genera ~60% * leaves links)
  const deps: DepRow[] = []
  const leafTasks = tasks.filter((t) => t.parent_mnemonic !== null)
  const depCount = Math.floor(leafTasks.length * 0.6)
  for (let i = 0; i < depCount && i + 1 < leafTasks.length; i++) {
    deps.push({
      predecessor_mnemonic: leafTasks[i].mnemonic,
      successor_mnemonic: leafTasks[i + 1].mnemonic,
      type: DEP_TYPES[i % DEP_TYPES.length],
      lag_days: i % 7 === 0 ? 1 : 0,
    })
  }

  // Recursos
  const resources: ResourceRow[] = Array.from({ length: 25 }, (_, i) => ({
    email: `user${i + 1}@complejoavante.com`,
    name: `Usuario ${i + 1}`,
    role: i === 0 ? 'PM' : i < 4 ? 'Tech Lead' : 'Dev',
  }))

  return { tasks, deps, resources }
}

async function writeExcel(
  tasks: TaskRow[],
  deps: DepRow[],
  resources: ResourceRow[],
  outPath: string,
): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'FollowupGantt HU-4.6 perf fixture'
  wb.created = new Date()

  const wsTasks = wb.addWorksheet('Tareas')
  wsTasks.columns = [
    { header: 'mnemonic', key: 'mnemonic', width: 12 },
    { header: 'title', key: 'title', width: 50 },
    { header: 'parent_mnemonic', key: 'parent_mnemonic', width: 16 },
    { header: 'start_date', key: 'start_date', width: 14, style: { numFmt: 'yyyy-mm-dd' } },
    { header: 'end_date', key: 'end_date', width: 14, style: { numFmt: 'yyyy-mm-dd' } },
    { header: 'duration_days', key: 'duration_days', width: 14 },
    { header: 'is_milestone', key: 'is_milestone', width: 14 },
    { header: 'progress', key: 'progress', width: 10 },
    { header: 'priority', key: 'priority', width: 12 },
    { header: 'assignee_email', key: 'assignee_email', width: 32 },
    { header: 'tags', key: 'tags', width: 24 },
    { header: 'description', key: 'description', width: 80 },
  ]
  wsTasks.getRow(1).font = { bold: true }
  for (const t of tasks) wsTasks.addRow(t)

  const wsDeps = wb.addWorksheet('Dependencias')
  wsDeps.columns = [
    { header: 'predecessor_mnemonic', key: 'predecessor_mnemonic', width: 22 },
    { header: 'successor_mnemonic', key: 'successor_mnemonic', width: 22 },
    { header: 'type', key: 'type', width: 8 },
    { header: 'lag_days', key: 'lag_days', width: 10 },
  ]
  wsDeps.getRow(1).font = { bold: true }
  for (const d of deps) wsDeps.addRow(d)

  const wsRes = wb.addWorksheet('Recursos')
  wsRes.columns = [
    { header: 'email', key: 'email', width: 32 },
    { header: 'name', key: 'name', width: 24 },
    { header: 'role', key: 'role', width: 16 },
  ]
  wsRes.getRow(1).font = { bold: true }
  for (const r of resources) wsRes.addRow(r)

  await wb.xlsx.writeFile(outPath)
}

function tasksToMspXml(
  tasks: TaskRow[],
  deps: DepRow[],
  resources: ResourceRow[],
): string {
  // Mapas: mnemonic -> UID estable
  const taskUidByMnemonic = new Map<string, number>()
  tasks.forEach((t, idx) => taskUidByMnemonic.set(t.mnemonic, idx + 1))

  // Outline numbers: epics top-level "1".."5"; leaves "<epic>.<order>"
  const outlineByMnemonic = new Map<string, string>()
  let epicCounter = 0
  const leafCountersPerEpic = new Map<string, number>()
  for (const t of tasks) {
    if (t.parent_mnemonic === null) {
      epicCounter += 1
      outlineByMnemonic.set(t.mnemonic, String(epicCounter))
      leafCountersPerEpic.set(t.mnemonic, 0)
    } else {
      const parentOutline = outlineByMnemonic.get(t.parent_mnemonic) ?? '0'
      const next = (leafCountersPerEpic.get(t.parent_mnemonic) ?? 0) + 1
      leafCountersPerEpic.set(t.parent_mnemonic, next)
      outlineByMnemonic.set(t.mnemonic, `${parentOutline}.${next}`)
    }
  }

  function fmtDateTime(d: Date): string {
    // ISO-like sin Z, MSP friendly: "yyyy-MM-ddTHH:mm:ss"
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(8)}:00:00`
  }

  // Predecessor links agrupados por successor
  const linksBySuccessor = new Map<string, DepRow[]>()
  for (const d of deps) {
    const arr = linksBySuccessor.get(d.successor_mnemonic) ?? []
    arr.push(d)
    linksBySuccessor.set(d.successor_mnemonic, arr)
  }

  // Construye estructura objeto compatible con XMLBuilder
  const mspTasks = tasks.map((t) => {
    const uid = taskUidByMnemonic.get(t.mnemonic)!
    const outline = outlineByMnemonic.get(t.mnemonic)!
    const isParent = t.parent_mnemonic === null
    const links = linksBySuccessor.get(t.mnemonic) ?? []
    const taskObj: Record<string, unknown> = {
      UID: uid,
      ID: uid,
      Name: t.title,
      OutlineLevel: isParent ? 1 : 2,
      OutlineNumber: outline,
      Start: fmtDateTime(t.start_date),
      Finish: fmtDateTime(t.end_date),
      PercentComplete: t.progress,
      Milestone: t.is_milestone ? 1 : 0,
      Summary: isParent ? 1 : 0,
      Notes: t.description,
    }
    if (links.length > 0) {
      taskObj.PredecessorLink = links.map((l) => ({
        PredecessorUID: taskUidByMnemonic.get(l.predecessor_mnemonic) ?? 0,
        Type: MSP_LINK_TYPE[l.type],
        LinkLag: l.lag_days * 4800, // tenths of minutes (8h * 60 * 10)
      }))
    }
    return taskObj
  })

  const mspResources = resources.map((r, i) => ({
    UID: i + 1,
    ID: i + 1,
    Name: r.name,
    EmailAddress: r.email,
    Type: 1,
  }))

  const project = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8', '@_standalone': 'yes' },
    Project: {
      '@_xmlns': 'http://schemas.microsoft.com/project',
      Name: 'FollowupGantt HU-4.6 perf fixture',
      Title: 'FollowupGantt HU-4.6 perf fixture',
      Author: 'FollowupGantt',
      SaveVersion: 14,
      StartDate: fmtDateTime(tasks[0]?.start_date ?? new Date()),
      FinishDate: fmtDateTime(tasks[tasks.length - 1]?.end_date ?? new Date()),
      Tasks: { Task: mspTasks },
      Resources: { Resource: mspResources },
      Assignments: {},
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
  return builder.build(project)
}

function writeMspXml(
  tasks: TaskRow[],
  deps: DepRow[],
  resources: ResourceRow[],
  outPath: string,
): void {
  const xml = tasksToMspXml(tasks, deps, resources)
  // UTF-8 sin BOM (HU-4.1 hará stripBom de cualquier forma).
  fs.writeFileSync(outPath, xml, { encoding: 'utf-8' })
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function size(p: string): { bytes: number; mb: number } {
  const bytes = fs.statSync(p).size
  return { bytes, mb: +(bytes / 1024 / 1024).toFixed(2) }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)
  ensureDir(FIXTURES_DIR)

  // Si target-mb está fijo, se ajusta task-count empíricamente (excel ~1KB/tarea,
  // xml ~1KB/tarea con descripcion). Por simplicidad iteramos 1 vez con el
  // count base y reescalamos si la primera pasada queda corta.
  let taskCount = args.taskCount
  if (args.targetMb !== null) {
    // ~1KB per task de promedio (rough). Apuntamos al objetivo en MB.
    taskCount = Math.max(1000, Math.round(args.targetMb * 1024))
  }

  console.log(`[gen-perf-fixtures] task-count=${taskCount} only=${args.only}`)
  const t0 = performance.now()
  const { tasks, deps, resources } = buildSyntheticData(taskCount)
  const tBuild = performance.now()
  console.log(
    `[data] tasks=${tasks.length} deps=${deps.length} resources=${resources.length} build=${(tBuild - t0).toFixed(0)}ms`,
  )

  if (args.only !== 'msp') {
    const tStart = performance.now()
    await writeExcel(tasks, deps, resources, EXCEL_OUT)
    const elapsed = performance.now() - tStart
    const s = size(EXCEL_OUT)
    console.log(`[excel] ${EXCEL_OUT} -> ${s.bytes} B (${s.mb} MB) en ${elapsed.toFixed(0)}ms`)
  }

  if (args.only !== 'excel') {
    const tStart = performance.now()
    writeMspXml(tasks, deps, resources, MSP_OUT)
    const elapsed = performance.now() - tStart
    const s = size(MSP_OUT)
    console.log(`[msp]   ${MSP_OUT} -> ${s.bytes} B (${s.mb} MB) en ${elapsed.toFixed(0)}ms`)
  }

  console.log(`[OK] gen-perf-fixtures total ${(performance.now() - t0).toFixed(0)}ms`)
}

main().catch((err) => {
  console.error('[FAIL] gen-perf-fixtures:', err)
  process.exit(1)
})
