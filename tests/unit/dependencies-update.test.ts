import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * HU-1.4 · Tests de la server action `updateDependency`.
 *
 * Estrategia: mockeamos `next/cache` (revalidate*), `@/lib/prisma`,
 * `wouldCreateCycle` y `invalidateCpmCache` para no tocar BD ni runtime
 * Next. Verificamos:
 *   1. Cambio de tipo válido → llama prisma.update con el tipo Prisma correcto.
 *   2. Cambio de tipo que cierra ciclo → lanza `[CYCLE_DETECTED]`.
 *   3. Lag fuera de rango → lanza `[INVALID_LAG]`.
 *   4. Dep inexistente → lanza `[NOT_FOUND]`.
 *   5. Sin tipo ni lag → lanza `[INVALID_INPUT]`.
 *   6. Cambio de lag dentro de rango (sin cambiar tipo) → no consulta deps
 *      del proyecto (skip de la verificación de ciclo, optimización).
 */

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

// Override findMany de dependencies en el servicio: necesita un mock por ID
// para excluir la propia arista. El mock de `depFindMany` arriba retorna ambas.
beforeEach(() => {
  update.mockClear()
  findUnique.mockReset()
  taskFindMany.mockClear()
  depFindMany.mockClear()
  wouldCreateCycleMock.mockReset()
  wouldCreateCycleMock.mockReturnValue(false)
  invalidateCpmCacheMock.mockClear()
  // Inyectar el mock de depFindMany sobre el cliente prisma — `taskDependency.findMany`
  // hay que añadirlo dinámicamente porque la primera mock-factory no lo incluyó:
  // (vitest cachea el módulo, por eso lo seteamos por test).
})

// El módulo dependencies.ts también consulta `prisma.taskDependency.findMany`
// para validar ciclo; tenemos que extender el mock. Re-mock dinámico:
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

describe('updateDependency', () => {
  it('cambia el tipo correctamente y mapea a enum Prisma', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'dep-1',
      predecessorId: 't1',
      successorId: 't2',
      type: 'FINISH_TO_START',
      predecessor: { projectId: 'proj-1' },
    })

    const { updateDependency } = await import('@/lib/actions/dependencies')
    const out = await updateDependency({ id: 'dep-1', type: 'SS' })

    expect(out).toEqual({ id: 'dep-1' })
    // verificar que el data enviado a prisma.update incluye el enum correcto
    const lastCall = update.mock.calls.at(-1)?.[0] as { data: { type?: string } }
    expect(lastCall.data.type).toBe('START_TO_START')
    // Cache invalidado para el proyecto correcto
    expect(invalidateCpmCacheMock).toHaveBeenCalledWith('proj-1')
  })

  it('rechaza cambio de tipo que cerraría un ciclo', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'dep-1',
      predecessorId: 't1',
      successorId: 't2',
      type: 'FINISH_TO_START',
      predecessor: { projectId: 'proj-1' },
    })
    wouldCreateCycleMock.mockReturnValueOnce(true)

    const { updateDependency } = await import('@/lib/actions/dependencies')
    await expect(
      updateDependency({ id: 'dep-1', type: 'SS' }),
    ).rejects.toThrow(/\[CYCLE_DETECTED\]/)
    expect(update).not.toHaveBeenCalled()
  })

  it('rechaza lag fuera de rango (>365)', async () => {
    const { updateDependency } = await import('@/lib/actions/dependencies')
    await expect(
      updateDependency({ id: 'dep-1', lagDays: 999 }),
    ).rejects.toThrow(/\[INVALID_LAG\]/)
  })

  it('rechaza lag fuera de rango (<-30)', async () => {
    const { updateDependency } = await import('@/lib/actions/dependencies')
    await expect(
      updateDependency({ id: 'dep-1', lagDays: -100 }),
    ).rejects.toThrow(/\[INVALID_LAG\]/)
  })

  it('rechaza lag no entero', async () => {
    const { updateDependency } = await import('@/lib/actions/dependencies')
    await expect(
      updateDependency({ id: 'dep-1', lagDays: 1.5 }),
    ).rejects.toThrow(/\[INVALID_LAG\]/)
  })

  it('lanza NOT_FOUND si la dependencia no existe', async () => {
    findUnique.mockResolvedValueOnce(null)

    const { updateDependency } = await import('@/lib/actions/dependencies')
    await expect(
      updateDependency({ id: 'no-existe', type: 'FF' }),
    ).rejects.toThrow(/\[NOT_FOUND\]/)
  })

  it('rechaza input vacío (sin type ni lagDays)', async () => {
    const { updateDependency } = await import('@/lib/actions/dependencies')
    await expect(
      updateDependency({ id: 'dep-1' }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('cambia solo el lag sin tocar tipo y skipea verificación de ciclo', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'dep-1',
      predecessorId: 't1',
      successorId: 't2',
      type: 'FINISH_TO_START',
      predecessor: { projectId: 'proj-1' },
    })

    const { updateDependency } = await import('@/lib/actions/dependencies')
    await updateDependency({ id: 'dep-1', lagDays: 3 })

    const lastCall = update.mock.calls.at(-1)?.[0] as {
      data: { type?: string; lagDays?: number }
    }
    expect(lastCall.data.lagDays).toBe(3)
    expect(lastCall.data.type).toBeUndefined()
    // No debe haber llamado a wouldCreateCycle (optimización)
    expect(wouldCreateCycleMock).not.toHaveBeenCalled()
    expect(invalidateCpmCacheMock).toHaveBeenCalledWith('proj-1')
  })

  it('rechaza tipo inválido (zod) con [INVALID_TYPE]', async () => {
    const { updateDependency } = await import('@/lib/actions/dependencies')
    await expect(
      updateDependency({
        id: 'dep-1',
        // @ts-expect-error verificar el rejecto runtime
        type: 'XX',
      }),
    ).rejects.toThrow(/\[INVALID_TYPE\]/)
  })
})
