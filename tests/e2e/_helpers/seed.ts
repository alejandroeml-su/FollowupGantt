/**
 * Sprint 6.5 · Helper de seed determinístico para tests E2E del Gantt.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ESTRATEGIA (decisión técnica autónoma · 2026-05-01)
 * ─────────────────────────────────────────────────────────────────────
 * El proyecto comparte una sola Postgres (Supabase productiva en local,
 * Postgres efímera en CI). NO existe una BD de pruebas separada en el
 * dev local, por lo que el helper debe ser:
 *
 *   1. Idempotente: usa `upsert` con IDs prefijados con `e2e_` para que
 *      re-runs consecutivos no rompan datos.
 *   2. Defensivo: nunca toca registros sin prefijo `e2e_`. El cleanup
 *      sólo borra IDs explícitamente sembrados por este helper.
 *   3. Consciente del entorno: `prisma/seed.ts` (data con prefijo
 *      `test_*`) ya creó un proyecto base — nuestro helper crea un
 *      proyecto INDEPENDIENTE con prefijo `e2e_` para no chocar.
 *
 * Uso típico:
 *
 *   import { seedProject, GANTT_FIXTURE } from './_helpers/seed'
 *   test.beforeAll(async () => { await seedProject(GANTT_FIXTURE) })
 *   test.afterAll(async () => { await cleanupSeed(GANTT_FIXTURE) })
 *
 * ─────────────────────────────────────────────────────────────────────
 * IMPORTANTE: el helper requiere `DATABASE_URL` en process.env. Si
 * Playwright corre desde el dev server local (sin CI env), el helper
 * carga `.env` vía `dotenv` automáticamente al primer uso.
 * ─────────────────────────────────────────────────────────────────────
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

// Tipos del payload del helper. Mantenemos un alias 2-letras para alinear
// con la API del front (la conversión a enum Prisma se hace internamente).
export type DepType2L = 'FS' | 'SS' | 'FF' | 'SF'

export type SeedTask = {
  /** ID Prisma (debe llevar prefijo `e2e_` por convención del helper). */
  id: string
  title: string
  mnemonic?: string
  /** Días desde `startBase` (ver SeedFixture). */
  startOffset: number
  durationDays: number
  isMilestone?: boolean
}

export type SeedDependency = {
  predecessorId: string
  successorId: string
  type?: DepType2L
  lagDays?: number
}

export type SeedFixture = {
  /** ID determinístico del proyecto. Debe llevar prefijo `e2e_`. */
  projectId: string
  /** Nombre legible del proyecto (incluir `[E2E]` para ser identificable). */
  projectName: string
  /** Fecha base UTC para `startOffset`. Default: 2026-05-01. */
  startBase?: string
  /** Tareas a sembrar (con IDs explícitos). */
  tasks: SeedTask[]
  /** Dependencias a sembrar entre tareas del fixture. */
  deps: SeedDependency[]
}

const DEP_TYPE_MAP: Record<
  DepType2L,
  'FINISH_TO_START' | 'START_TO_START' | 'FINISH_TO_FINISH' | 'START_TO_FINISH'
> = {
  FS: 'FINISH_TO_START',
  SS: 'START_TO_START',
  FF: 'FINISH_TO_FINISH',
  SF: 'START_TO_FINISH',
}

const E2E_USER_ID = 'e2e_user_seed'
const E2E_GERENCIA_ID = 'e2e_ger_seed'
const E2E_AREA_ID = 'e2e_area_seed'

let cachedClient: PrismaClient | null = null

/**
 * Carga `.env` y `.env.local` perezosamente, sólo si DATABASE_URL no está ya
 * inyectada por el entorno (CI). Necesario porque Playwright corre en un
 * proceso Node separado de Next.js — no hereda el .env automáticamente.
 */
function ensureEnvLoaded(): void {
  if (process.env.DATABASE_URL) return
  // Carga lazy — evita penalizar tests que sí tienen env inyectado.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dotenv = require('dotenv') as typeof import('dotenv')
  // .env.local tiene precedencia sobre .env (convención Next.js).
  dotenv.config({ path: '.env.local' })
  if (!process.env.DATABASE_URL) dotenv.config({ path: '.env' })
}

function getClient(): PrismaClient {
  if (cachedClient) return cachedClient
  ensureEnvLoaded()
  if (!process.env.DATABASE_URL) {
    throw new Error(
      '[E2E_SEED_NO_DB] DATABASE_URL no está disponible. El helper de seed ' +
        'requiere acceso a Postgres. Verifica .env / .env.local o, en CI, que ' +
        'el job exporte DATABASE_URL antes de invocar Playwright.',
    )
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  const adapter = new PrismaPg(pool)
  cachedClient = new PrismaClient({ adapter })
  return cachedClient
}

function startBaseDate(fixture: SeedFixture): Date {
  const iso = fixture.startBase ?? '2026-05-01T00:00:00Z'
  return new Date(iso)
}

function addDaysUTC(d: Date, days: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + days)
  return out
}

/**
 * Inserta/actualiza un proyecto E2E con sus tareas y dependencias.
 *
 * Garantías:
 *  - Idempotente: re-llamadas con el mismo `fixture` resultan en el mismo
 *    estado final (ningún error por unique constraint).
 *  - No toca datos fuera de los IDs explícitos en `fixture`.
 *  - Si una tarea o dep ya existe (de un run previo no limpiado), la
 *    sobrescribe con los nuevos valores.
 *
 * @returns mapa ids útiles para el spec.
 */
export async function seedProject(fixture: SeedFixture): Promise<{
  projectId: string
  taskIds: string[]
  depIds: string[]
}> {
  // Validación temprana: todos los IDs deben llevar prefijo `e2e_` para que
  // el cleanup sea seguro. Esto previene que un fixture mal escrito pueda
  // sembrar datos sin posibilidad de borrarlos selectivamente.
  if (!fixture.projectId.startsWith('e2e_')) {
    throw new Error(
      `[E2E_SEED_BAD_PREFIX] projectId debe iniciar con "e2e_": ${fixture.projectId}`,
    )
  }
  for (const t of fixture.tasks) {
    if (!t.id.startsWith('e2e_')) {
      throw new Error(
        `[E2E_SEED_BAD_PREFIX] taskId debe iniciar con "e2e_": ${t.id}`,
      )
    }
  }

  const prisma = getClient()
  const base = startBaseDate(fixture)

  // 1) Recursos compartidos (user/gerencia/area). Se crean una vez y se
  // reutilizan entre fixtures. Los dejamos huérfanos en cleanup — el costo
  // de mantenerlos es trivial y otros tests pueden necesitarlos.
  await prisma.user.upsert({
    where: { id: E2E_USER_ID },
    update: {},
    create: {
      id: E2E_USER_ID,
      name: 'E2E Seed Bot',
      email: 'e2e.seed@avante.test',
    },
  })
  await prisma.gerencia.upsert({
    where: { id: E2E_GERENCIA_ID },
    update: {},
    create: { id: E2E_GERENCIA_ID, name: 'E2E_GER' },
  })
  await prisma.area.upsert({
    where: { id: E2E_AREA_ID },
    update: {},
    create: {
      id: E2E_AREA_ID,
      name: 'E2E Area',
      gerenciaId: E2E_GERENCIA_ID,
    },
  })

  // 2) Proyecto E2E. `update` reaplica name/areaId/manager por si cambió
  // entre runs.
  await prisma.project.upsert({
    where: { id: fixture.projectId },
    update: {
      name: fixture.projectName,
      status: 'ACTIVE',
      areaId: E2E_AREA_ID,
      managerId: E2E_USER_ID,
    },
    create: {
      id: fixture.projectId,
      name: fixture.projectName,
      status: 'ACTIVE',
      areaId: E2E_AREA_ID,
      managerId: E2E_USER_ID,
    },
  })

  // 3) Tareas. `update` aplica fechas/título/posición; `create` añade lo nuevo.
  // Las fechas se derivan de `startOffset` para mantener la fixture
  // independiente de la fecha real (los tests pueden sembrar tareas en el
  // mes que necesiten cambiando `startBase`).
  for (let i = 0; i < fixture.tasks.length; i++) {
    const t = fixture.tasks[i]
    const startDate = addDaysUTC(base, t.startOffset)
    const endDate = addDaysUTC(startDate, Math.max(0, t.durationDays - 1))
    await prisma.task.upsert({
      where: { id: t.id },
      update: {
        title: t.title,
        mnemonic: t.mnemonic,
        startDate,
        endDate,
        position: i + 1,
        isMilestone: t.isMilestone ?? false,
        projectId: fixture.projectId,
        assigneeId: E2E_USER_ID,
        archivedAt: null,
      },
      create: {
        id: t.id,
        title: t.title,
        mnemonic: t.mnemonic,
        startDate,
        endDate,
        position: i + 1,
        isMilestone: t.isMilestone ?? false,
        projectId: fixture.projectId,
        assigneeId: E2E_USER_ID,
      },
    })
  }

  // 4) Dependencias. Únicas por (pred, succ); para garantizar idempotencia
  // borramos primero las del proyecto que NO estén en el fixture y luego
  // upsertamos las del fixture. Esto evita dependencias huérfanas de runs
  // previos con fixtures distintos.
  const seedTaskIds = new Set(fixture.tasks.map((t) => t.id))
  const existingDeps = await prisma.taskDependency.findMany({
    where: {
      AND: [
        { predecessorId: { in: [...seedTaskIds] } },
        { successorId: { in: [...seedTaskIds] } },
      ],
    },
    select: {
      id: true,
      predecessorId: true,
      successorId: true,
    },
  })
  const wantedDeps = new Set(
    fixture.deps.map((d) => `${d.predecessorId}->${d.successorId}`),
  )
  const toDelete = existingDeps.filter(
    (d) => !wantedDeps.has(`${d.predecessorId}->${d.successorId}`),
  )
  if (toDelete.length > 0) {
    await prisma.taskDependency.deleteMany({
      where: { id: { in: toDelete.map((d) => d.id) } },
    })
  }

  const depIds: string[] = []
  for (const d of fixture.deps) {
    const upserted = await prisma.taskDependency.upsert({
      where: {
        predecessorId_successorId: {
          predecessorId: d.predecessorId,
          successorId: d.successorId,
        },
      },
      update: {
        type: DEP_TYPE_MAP[d.type ?? 'FS'],
        lagDays: d.lagDays ?? 0,
      },
      create: {
        predecessorId: d.predecessorId,
        successorId: d.successorId,
        type: DEP_TYPE_MAP[d.type ?? 'FS'],
        lagDays: d.lagDays ?? 0,
      },
      select: { id: true },
    })
    depIds.push(upserted.id)
  }

  return {
    projectId: fixture.projectId,
    taskIds: fixture.tasks.map((t) => t.id),
    depIds,
  }
}

/**
 * Borra todos los recursos sembrados por `seedProject` para `fixture`.
 *
 * Orden de borrado (por restricciones FK):
 *   1. TaskDependency (cascadea desde Task pero por seguridad explícito)
 *   2. Task
 *   3. Project
 *
 * Los recursos compartidos (user/gerencia/area) NO se borran — pueden ser
 * reutilizados por otros fixtures.
 *
 * Nunca falla: si algo no existe, lo ignora. Si Prisma lanza, propaga el
 * error para que el test lo loguee, pero no cuelga el suite.
 */
export async function cleanupSeed(fixture: SeedFixture): Promise<void> {
  const prisma = getClient()
  const taskIds = fixture.tasks.map((t) => t.id)

  // 1) Borrar dependencias relacionadas con tareas del fixture (en cualquier
  // dirección — incluso las que se hayan creado dinámicamente en un test).
  await prisma.taskDependency.deleteMany({
    where: {
      OR: [
        { predecessorId: { in: taskIds } },
        { successorId: { in: taskIds } },
      ],
    },
  })

  // 2) Borrar tareas (cascadea comments/history/attachments por onDelete:Cascade).
  await prisma.task.deleteMany({
    where: { id: { in: taskIds } },
  })

  // 3) Borrar el proyecto.
  await prisma.project.deleteMany({
    where: { id: fixture.projectId },
  })
}

/**
 * Cierra la conexión Prisma (libera el pool). Llamar en `globalTeardown` si
 * se usa, o en `afterAll` del último spec del suite. Para tests aislados es
 * opcional — el proceso Playwright se cierra al final.
 */
export async function disconnectSeedClient(): Promise<void> {
  if (cachedClient) {
    await cachedClient.$disconnect()
    cachedClient = null
  }
}

// ─────────────────────────────────────────────────────────────────────
// FIXTURE estándar para los tests funcionales del Sprint 6.5.
// 3 tareas + 2 deps FS, mes 2026-05 (alineado con la fecha actual de los
// tests y con el seed determinístico de prisma/seed.ts).
// ─────────────────────────────────────────────────────────────────────

/**
 * Genera un fixture estándar (3 tareas + 2 deps FS) parametrizado por
 * `suffix` para aislar specs que corren en paralelo. Cada spec debe usar
 * un sufijo único (ej. 'creation', 'editor') para evitar colisiones de
 * cleanup entre workers.
 */
export function makeGanttFixture(suffix: string): SeedFixture {
  const sx = suffix.replace(/[^a-z0-9_]/gi, '').toLowerCase()
  return {
    projectId: `e2e_proj_dep_${sx}`,
    projectName: `[E2E] Sprint 6.5 · ${sx}`,
    startBase: '2026-05-01T00:00:00Z',
    tasks: [
      {
        id: `e2e_task_a_${sx}`,
        title: `[E2E ${sx}] Diseño`,
        mnemonic: `E2E-${sx}-1`,
        startOffset: 0,
        durationDays: 3,
      },
      {
        id: `e2e_task_b_${sx}`,
        title: `[E2E ${sx}] Desarrollo`,
        mnemonic: `E2E-${sx}-2`,
        startOffset: 5,
        durationDays: 5,
      },
      {
        id: `e2e_task_c_${sx}`,
        title: `[E2E ${sx}] QA`,
        mnemonic: `E2E-${sx}-3`,
        startOffset: 12,
        durationDays: 2,
      },
    ],
    deps: [
      {
        predecessorId: `e2e_task_a_${sx}`,
        successorId: `e2e_task_b_${sx}`,
        type: 'FS',
      },
      {
        predecessorId: `e2e_task_b_${sx}`,
        successorId: `e2e_task_c_${sx}`,
        type: 'FS',
      },
    ],
  }
}

/** Fixture default (legacy alias). Para nuevos specs usar `makeGanttFixture`. */
export const GANTT_FIXTURE: SeedFixture = makeGanttFixture('default')
