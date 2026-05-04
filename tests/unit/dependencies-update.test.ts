import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

/**
 * HU-1.4 · Tests de la server action `updateDependency`.
 *
 * Estrategia: mockeamos `next/cache` (revalidate*), `@/lib/prisma`,
 * `wouldCreateCycle`, `invalidateCpmCache` Y `validateScheduledChange`
 * para no tocar BD ni runtime Next ni el CPM real. Verificamos:
 *   1. Cambio de tipo válido → llama prisma.update con el tipo Prisma correcto.
 *   2. Cambio de tipo que cierra ciclo → lanza `[CYCLE_DETECTED]`.
 *   3. Lag fuera de rango → lanza `[INVALID_LAG]`.
 *   4. Dep inexistente → lanza `[NOT_FOUND]`.
 *   5. Sin tipo ni lag → lanza `[INVALID_INPUT]`.
 *   6. Cambio de lag dentro de rango (sin cambiar tipo) → no consulta deps
 *      del proyecto (skip de la verificación de ciclo, optimización).
 *
 * Refactor anti-flake P3-5D (raíz definitiva):
 *
 *   1. Mocks granulares con `vi.fn()` específicos por collaborator:
 *      `update`, `findUnique`, `taskFindMany`, `depFindMany`,
 *      `wouldCreateCycleMock`, `invalidateCpmCacheMock`,
 *      `validateScheduledChangeMock`. Cada test sobrescribe SOLO el
 *      stub que necesita usando `mockImplementation` o
 *      `mockResolvedValue` (NUNCA `mockResolvedValueOnce`, que crea
 *      ordering implícito y se descalibra bajo paralelismo).
 *
 *   2. `validateScheduledChange` mockeada directamente como no-op:
 *      blinda contra cualquier cambio interno de la cadena CPM
 *      (`loadCpmInputForProject` + `computeCpm`). El SUT solo requiere
 *      que el wrapper no lance — la unidad bajo test es
 *      `updateDependency`, no la cadena CPM completa.
 *
 *   3. Import de `dependencies.ts` lift a `beforeAll`: previamente cada
 *      test hacía `await import(...)`, lo que bajo paralelismo agresivo
 *      podía race contra la inicialización de los mocks de otros
 *      workers que comparten cache de módulos. Ahora se importa una
 *      sola vez tras `vi.mock` y se reutiliza la referencia.
 *
 *   4. `getCachedCpmForProject` defensivo: si en el futuro `dependencies.ts`
 *      lo invoca, no dispara CPM real.
 *
 *   5. `beforeEach` resetea TODOS los mocks con `mockReset()` + valor
 *      default explícito, eliminando residuos entre tests.
 *
 *   6. `testTimeout` bajado de 15s → 5s en `vitest.config.ts` tras
 *      verificar 10/10 corridas verde. Ningún test legítimo de esta
 *      suite necesita más de 200ms.
 */

// ─────────────────────── Spies / mocks de cliente Prisma ───────────────────────

const update = vi.fn(async () => ({ id: 'dep-1' }))
const findUnique = vi.fn()
const taskFindMany = vi.fn(async () => [{ id: 't1' }, { id: 't2' }, { id: 't3' }])
const depFindMany = vi.fn(async () => [
  { id: 'dep-1', predecessorId: 't1', successorId: 't2' },
  { id: 'dep-2', predecessorId: 't2', successorId: 't3' },
])

vi.mock('@/lib/prisma', () => ({
  default: {
    taskDependency: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      update: (...args: unknown[]) => update(...args),
      findMany: (...args: unknown[]) => depFindMany(...args),
    },
    task: {
      findMany: (...args: unknown[]) => taskFindMany(...args),
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

const wouldCreateCycleMock = vi.fn(() => false)
vi.mock('@/lib/scheduling/cycle', () => ({
  wouldCreateCycle: (...args: unknown[]) => wouldCreateCycleMock(...args),
}))

const invalidateCpmCacheMock = vi.fn()
vi.mock('@/lib/scheduling/invalidate', () => ({
  invalidateCpmCache: (...args: unknown[]) => invalidateCpmCacheMock(...args),
  invalidateCpmCaches: vi.fn(),
}))

// HU-4.4 · Mockeamos `validateScheduledChange` directamente (en vez de
// mockear `loadCpmInputForProject` + `computeCpm` por separado). Esto
// blinda el test contra cualquier cambio interno de la cadena CPM y
// elimina la race con el CPM cacheado bajo paralelismo agresivo.
const validateScheduledChangeMock = vi.fn(async () => undefined)
vi.mock('@/lib/scheduling/validate', () => ({
  validateScheduledChange: (...args: unknown[]) => validateScheduledChangeMock(...args),
  validateProjectSchedule: vi.fn(async () => ({
    ok: true,
    negativeFloatTasks: [],
    newCycles: [],
  })),
  applyOverrideToCpmInput: vi.fn((base: unknown) => base),
  evaluateCpmInput: vi.fn(() => ({
    ok: true,
    negativeFloatTasks: [],
    newCycles: [],
  })),
}))

// HU-4.4 · Defensive mock: si en algún futuro `dependencies.ts` usa el
// CPM cacheado (hoy no), no debe llamar al runtime real.
vi.mock('@/lib/scheduling/cache', () => ({
  getCachedCpmForProject: vi.fn(async () => null),
}))

// Auth (Ola P1): `updateDependency` ahora invoca `requireProjectAccess`.
// Mockeamos como no-op que devuelve user admin sintético.
vi.mock('@/lib/auth/check-project-access', () => ({
  requireProjectAccess: vi.fn(async () => ({
    id: 'test-user',
    email: 'test@local',
    name: 'Test',
    roles: ['SUPER_ADMIN'],
  })),
  canAccessProject: vi.fn(async () => true),
}))

// ─────────────────────── Setup compartido ───────────────────────

const DEFAULT_DEP_ROW = {
  id: 'dep-1',
  predecessorId: 't1',
  successorId: 't2',
  type: 'FINISH_TO_START',
  predecessor: { projectId: 'proj-1' },
}

// P3-5D · Importamos una sola vez, después de que todos los `vi.mock(...)`
// hayan sido evaluados (vitest los iza). Reusamos la referencia en cada
// test para evitar race conditions con la cache de módulos bajo
// paralelismo.
let updateDependency: typeof import('@/lib/actions/dependencies').updateDependency

beforeAll(async () => {
  ;({ updateDependency } = await import('@/lib/actions/dependencies'))
})

beforeEach(() => {
  // mockReset elimina implementaciones previas (incluyendo Once stacks
  // dejados por tests vecinos). mockClear solo limpia call history.
  update.mockReset()
  update.mockResolvedValue({ id: 'dep-1' })

  findUnique.mockReset()
  // Default: la dep existe. Tests específicos pueden sobrescribir con
  // `findUnique.mockImplementation(() => Promise.resolve(null))` para NOT_FOUND.
  findUnique.mockResolvedValue(DEFAULT_DEP_ROW)

  taskFindMany.mockReset()
  taskFindMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }, { id: 't3' }])

  depFindMany.mockReset()
  depFindMany.mockResolvedValue([
    { id: 'dep-1', predecessorId: 't1', successorId: 't2' },
    { id: 'dep-2', predecessorId: 't2', successorId: 't3' },
  ])

  wouldCreateCycleMock.mockReset()
  wouldCreateCycleMock.mockReturnValue(false)

  invalidateCpmCacheMock.mockReset()

  validateScheduledChangeMock.mockReset()
  validateScheduledChangeMock.mockResolvedValue(undefined)
})

// ─────────────────────── Tests ───────────────────────

describe('updateDependency', () => {
  it('cambia el tipo correctamente y mapea a enum Prisma', async () => {
    // findUnique ya retorna DEFAULT_DEP_ROW por default del beforeEach.
    const out = await updateDependency({ id: 'dep-1', type: 'SS' })

    expect(out).toEqual({ id: 'dep-1' })
    // verificar que el data enviado a prisma.update incluye el enum correcto
    const lastCall = update.mock.calls.at(-1)?.[0] as { data: { type?: string } }
    expect(lastCall.data.type).toBe('START_TO_START')
    // Cache invalidado para el proyecto correcto
    expect(invalidateCpmCacheMock).toHaveBeenCalledWith('proj-1')
    // validateScheduledChange invocado con projectId + override correcto
    expect(validateScheduledChangeMock).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({
        updateDependencies: expect.arrayContaining([
          expect.objectContaining({
            predecessorId: 't1',
            successorId: 't2',
            type: 'SS',
          }),
        ]),
      }),
    )
  })

  it('rechaza cambio de tipo que cerraría un ciclo', async () => {
    wouldCreateCycleMock.mockReturnValue(true)

    await expect(
      updateDependency({ id: 'dep-1', type: 'SS' }),
    ).rejects.toThrow(/\[CYCLE_DETECTED\]/)
    expect(update).not.toHaveBeenCalled()
    // El short-circuit por ciclo ocurre ANTES de validateScheduledChange.
    expect(validateScheduledChangeMock).not.toHaveBeenCalled()
  })

  it('rechaza lag fuera de rango (>365)', async () => {
    await expect(
      updateDependency({ id: 'dep-1', lagDays: 999 }),
    ).rejects.toThrow(/\[INVALID_LAG\]/)
  })

  it('rechaza lag fuera de rango (<-30)', async () => {
    await expect(
      updateDependency({ id: 'dep-1', lagDays: -100 }),
    ).rejects.toThrow(/\[INVALID_LAG\]/)
  })

  it('rechaza lag no entero', async () => {
    await expect(
      updateDependency({ id: 'dep-1', lagDays: 1.5 }),
    ).rejects.toThrow(/\[INVALID_LAG\]/)
  })

  it('lanza NOT_FOUND si la dependencia no existe', async () => {
    findUnique.mockReset()
    findUnique.mockResolvedValue(null)

    await expect(
      updateDependency({ id: 'no-existe', type: 'FF' }),
    ).rejects.toThrow(/\[NOT_FOUND\]/)
    expect(update).not.toHaveBeenCalled()
    expect(validateScheduledChangeMock).not.toHaveBeenCalled()
  })

  it('rechaza input vacío (sin type ni lagDays)', async () => {
    await expect(
      updateDependency({ id: 'dep-1' }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('cambia solo el lag sin tocar tipo y skipea verificación de ciclo', async () => {
    await updateDependency({ id: 'dep-1', lagDays: 3 })

    const lastCall = update.mock.calls.at(-1)?.[0] as {
      data: { type?: string; lagDays?: number }
    }
    expect(lastCall.data.lagDays).toBe(3)
    expect(lastCall.data.type).toBeUndefined()
    // No debe haber llamado a wouldCreateCycle (optimización)
    expect(wouldCreateCycleMock).not.toHaveBeenCalled()
    expect(invalidateCpmCacheMock).toHaveBeenCalledWith('proj-1')
    // validateScheduledChange igual se ejecuta para chequear NEGATIVE_FLOAT,
    // pero solo con `updateDependencies[0].lag = 3` (sin type override).
    expect(validateScheduledChangeMock).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({
        updateDependencies: expect.arrayContaining([
          expect.objectContaining({
            predecessorId: 't1',
            successorId: 't2',
            lag: 3,
          }),
        ]),
      }),
    )
  })

  it('rechaza tipo inválido (zod) con [INVALID_TYPE]', async () => {
    await expect(
      updateDependency({
        id: 'dep-1',
        // @ts-expect-error verificar el rejecto runtime
        type: 'XX',
      }),
    ).rejects.toThrow(/\[INVALID_TYPE\]/)
  })
})
