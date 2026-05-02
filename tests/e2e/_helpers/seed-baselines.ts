/**
 * Sprint 6.5 (cierre) · Helper de seed determinístico para líneas base.
 *
 * ─────────────────────────────────────────────────────────────────────
 * MOTIVACIÓN
 * ─────────────────────────────────────────────────────────────────────
 * Los specs de HU-3.1 / 3.2 / 3.3 / 3.4 estaban `test.describe.skip` a
 * la espera de un seed determinístico para `prisma.Baseline`. Forzar la
 * captura desde el botón antes de cada test acoplaba la prueba del
 * overlay/trend a HU-3.1 (captura) y rompía la independencia entre
 * specs. Este helper permite preparar baselines en BD sin pasar por el
 * UI, manteniendo la captura misma como objeto de pruebas separadas.
 *
 * ─────────────────────────────────────────────────────────────────────
 * GARANTÍAS
 * ─────────────────────────────────────────────────────────────────────
 *  1. Los IDs (proyecto + baseline + tareas) deben llevar prefijo `e2e_`
 *     para que el cleanup sea seguro y no toque datos productivos.
 *  2. `seedBaseline` es idempotente vía upsert: re-ejecuciones con el
 *     mismo fixture no rompen unique-constraints ni duplican filas.
 *  3. `cleanupBaseline` borra SOLO el id explícitamente provisto. No
 *     borra el proyecto ni las tareas — esa responsabilidad pertenece
 *     a `cleanupSeed` (helper hermano).
 *  4. El `snapshotData` cumple `BaselineSnapshotSchema` (schemaVersion=1)
 *     — si en el futuro cambia el shape, este helper falla loud y obliga
 *     a actualizar la suite.
 *
 * ─────────────────────────────────────────────────────────────────────
 * USO TÍPICO
 * ─────────────────────────────────────────────────────────────────────
 *
 *   const fixture = makeBaselineFixtureFromProject({
 *     projectId: 'e2e_proj_overlay',
 *     version: 1,
 *     daysAgo: 30,
 *     tasks: [{ id: 'e2e_task_a', plannedStart: ..., plannedEnd: ... }],
 *   })
 *   await seedBaseline(fixture)
 *   // … run tests …
 *   await cleanupBaseline(fixture.baselineId)
 */

import { PrismaClient, type Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
// Path relativo deliberado: el `tsconfig.json` raíz excluye `tests/`, así
// que el alias `@/*` no es resuelto por algunas runtimes de Playwright.
// El relativo `../../../src/...` es lossless y portable entre Node y CI.
import {
  BaselineSnapshotSchema,
  type BaselineSnapshot,
} from '../../../src/lib/scheduling/baseline-snapshot'

// ───────────────────────────── Tipos ─────────────────────────────

export type SeedBaselineTask = {
  /** ID de tarea ya seedeada por `seedProject` (debe llevar prefijo `e2e_`). */
  id: string
  /**
   * Mnemónico legible. Si se omite, se deriva del id (`e2e_task_a` →
   * `E2E-A`) — solo cosmético para el aria-label del overlay.
   */
  mnemonic?: string | null
  title?: string
  plannedStart: Date
  plannedEnd: Date
  plannedValue?: number | null
  earnedValue?: number | null
  actualCost?: number | null
  /** 0–100. Se usa para derivar EV cuando earnedValue es undefined. */
  progress?: number
  status?: string
}

export type SeedBaselineFixture = {
  /** Proyecto al que pertenece la baseline. Debe llevar prefijo `e2e_`. */
  projectId: string
  /** ID determinístico de la baseline. Debe llevar prefijo `e2e_baseline_`. */
  baselineId: string
  /** Versión monótona positiva. Único por (projectId, version). */
  version: number
  /** Etiqueta opcional ≤80 chars (HU-3.1). */
  label: string | null
  /**
   * Fecha simulada de captura. Útil ponerla en el pasado para que el
   * overlay genere delta visible (variance) al comparar con las fechas
   * reales actuales.
   */
  capturedAt: Date
  /** Tareas con sus métricas EVM en el momento del snapshot. */
  tasks: SeedBaselineTask[]
}

// ───────────────────────────── Cliente ─────────────────────────────

let cachedClient: PrismaClient | null = null

function ensureEnvLoaded(): void {
  if (process.env.DATABASE_URL) return
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dotenv = require('dotenv') as typeof import('dotenv')
  dotenv.config({ path: '.env.local' })
  if (!process.env.DATABASE_URL) dotenv.config({ path: '.env' })
}

function getClient(): PrismaClient {
  if (cachedClient) return cachedClient
  ensureEnvLoaded()
  if (!process.env.DATABASE_URL) {
    throw new Error(
      '[E2E_SEED_NO_DB] DATABASE_URL no está disponible. seedBaseline ' +
        'requiere acceso a Postgres. Verifica .env / .env.local o la env de CI.',
    )
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  const adapter = new PrismaPg(pool)
  cachedClient = new PrismaClient({ adapter })
  return cachedClient
}

// ───────────────────────────── Validación ─────────────────────────────

function assertE2EBaselineId(id: string): void {
  if (!id.startsWith('e2e_baseline_')) {
    throw new Error(
      `[E2E_SEED_BAD_PREFIX] baselineId debe iniciar con "e2e_baseline_": ${id}`,
    )
  }
}

function assertE2EProjectId(id: string): void {
  if (!id.startsWith('e2e_')) {
    throw new Error(
      `[E2E_SEED_BAD_PREFIX] projectId debe iniciar con "e2e_": ${id}`,
    )
  }
}

function assertE2ETaskId(id: string): void {
  if (!id.startsWith('e2e_')) {
    throw new Error(
      `[E2E_SEED_BAD_PREFIX] taskId debe iniciar con "e2e_": ${id}`,
    )
  }
}

// ───────────────────────────── Builders ─────────────────────────────

function deriveMnemonic(taskId: string): string {
  // Convención: "e2e_task_a_overlay" → "E2E-A-OVERLAY". El detalle no es
  // funcional, solo sirve para que el aria-label de la barra fantasma
  // sea humano-leíble durante depuración.
  const stripped = taskId.replace(/^e2e_(task_)?/i, '')
  return `E2E-${stripped.replace(/_/g, '-').toUpperCase()}`
}

/**
 * Construye el snapshot conforme `BaselineSnapshotSchema`. Si el caller
 * no provee plannedValue / earnedValue, derivamos valores razonables:
 *   - plannedValue = 100 por defecto (PV uniforme).
 *   - earnedValue = progress * pv / 100.
 *   - actualCost = earnedValue (CPI=1) por defecto.
 *
 * Esto da un dataset coherente para HU-3.4 (SV/SPI) sin obligar al spec
 * a especificar números arbitrarios.
 */
function buildSnapshot(fixture: SeedBaselineFixture): BaselineSnapshot {
  const snap: BaselineSnapshot = {
    schemaVersion: 1,
    capturedAt: fixture.capturedAt.toISOString(),
    label: fixture.label,
    tasks: fixture.tasks.map((t) => {
      const pv = t.plannedValue ?? 100
      const progress = t.progress ?? 0
      const ev = t.earnedValue ?? Math.round((progress * pv) / 100)
      const ac = t.actualCost ?? ev
      return {
        id: t.id,
        mnemonic: t.mnemonic ?? deriveMnemonic(t.id),
        title: t.title ?? `[E2E baseline] ${t.id}`,
        plannedStart: t.plannedStart.toISOString(),
        plannedEnd: t.plannedEnd.toISOString(),
        plannedValue: pv,
        earnedValue: ev,
        actualCost: ac,
        progress,
        status: t.status ?? (progress >= 100 ? 'DONE' : progress > 0 ? 'IN_PROGRESS' : 'TODO'),
      }
    }),
  }
  // Validamos antes de persistir — si el shape se desvía del schema, el
  // test falla loud aquí en vez de dejar un JSON inválido en BD.
  return BaselineSnapshotSchema.parse(snap)
}

// ───────────────────────────── API pública ─────────────────────────────

/**
 * Inserta o actualiza una baseline E2E con su snapshot. Idempotente.
 *
 * Pre-condiciones:
 *  - El proyecto referenciado por `fixture.projectId` ya debe existir
 *    (típicamente sembrado vía `seedProject` antes).
 *  - Las tareas referenciadas en `fixture.tasks[].id` deben existir.
 *
 * Si una baseline con el mismo `baselineId` ya existe, se actualizan
 * label / version / capturedAt / snapshotData. La versión es única por
 * `(projectId, version)` — si el caller reusa una versión existente
 * para otro id, Prisma lanza P2002 y propagamos.
 */
export async function seedBaseline(
  fixture: SeedBaselineFixture,
): Promise<{ baselineId: string }> {
  assertE2EBaselineId(fixture.baselineId)
  assertE2EProjectId(fixture.projectId)
  for (const t of fixture.tasks) assertE2ETaskId(t.id)

  const prisma = getClient()
  const snapshot = buildSnapshot(fixture)

  await prisma.baseline.upsert({
    where: { id: fixture.baselineId },
    update: {
      version: fixture.version,
      label: fixture.label,
      createdAt: fixture.capturedAt,
      // El cast es necesario porque Prisma JSON acepta InputJsonValue.
      // El zod parse en `buildSnapshot` ya garantizó shape correcto.
      snapshotData: snapshot as unknown as Prisma.InputJsonValue,
      projectId: fixture.projectId,
    },
    create: {
      id: fixture.baselineId,
      version: fixture.version,
      label: fixture.label,
      createdAt: fixture.capturedAt,
      snapshotData: snapshot as unknown as Prisma.InputJsonValue,
      projectId: fixture.projectId,
    },
  })

  return { baselineId: fixture.baselineId }
}

/**
 * Borra una baseline E2E por id. Defensivo: solo acepta IDs prefijados
 * con `e2e_baseline_`. No falla si el id no existe — cleanup best-effort.
 */
export async function cleanupBaseline(baselineId: string): Promise<void> {
  assertE2EBaselineId(baselineId)
  const prisma = getClient()
  await prisma.baseline.deleteMany({ where: { id: baselineId } })
}

/**
 * Borra TODAS las baselines de un proyecto E2E. Útil en `afterAll` para
 * limpiar capturas que el test pudo crear por UI (HU-3.1) además del
 * fixture seedeado. Defensivo: solo acepta projectId prefijado con `e2e_`.
 */
export async function cleanupBaselinesForProject(
  projectId: string,
): Promise<void> {
  assertE2EProjectId(projectId)
  const prisma = getClient()
  await prisma.baseline.deleteMany({ where: { projectId } })
}

// ───────────────────────────── Builders cómodos ─────────────────────────────

/**
 * Construye un `SeedBaselineFixture` típico desde un proyecto ya
 * sembrado. Pensado para 80 % de los tests: solo necesitas decir
 * "hace N días, con estas tareas y estos plannedStart/End".
 */
export function makeBaselineFixtureFromProject(opts: {
  projectId: string
  /** Sufijo opcional para distinguir baselines del mismo proyecto. */
  suffix?: string
  version: number
  label?: string | null
  daysAgo: number
  tasks: Array<{
    id: string
    plannedStart: Date
    plannedEnd: Date
    progress?: number
    plannedValue?: number
    earnedValue?: number | null
  }>
}): SeedBaselineFixture {
  const sx = opts.suffix
    ? `_${opts.suffix.replace(/[^a-z0-9]/gi, '').toLowerCase()}`
    : ''
  const baselineId = `e2e_baseline_v${opts.version}${sx}_${opts.projectId.replace(/^e2e_/, '')}`
  const now = new Date()
  const capturedAt = new Date(now.getTime() - opts.daysAgo * 86_400_000)
  return {
    projectId: opts.projectId,
    baselineId,
    version: opts.version,
    label: opts.label ?? null,
    capturedAt,
    tasks: opts.tasks.map((t) => ({
      id: t.id,
      plannedStart: t.plannedStart,
      plannedEnd: t.plannedEnd,
      plannedValue: t.plannedValue ?? 100,
      earnedValue: t.earnedValue ?? null,
      progress: t.progress ?? 0,
    })),
  }
}
