import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * HU-2.1 · Tests del cache server-side de CPM.
 *
 * Estrategia: mockeamos `next/cache` (`unstable_cache` y `revalidateTag`)
 * y `prismaAdapter` para no tocar BD ni el runtime de Next. Verificamos
 * que `getCachedCpmForProject`:
 *   1. Llama a `unstable_cache` con keyParts y tag correctos.
 *   2. Devuelve un payload serializable (Date → ISO string, sin Map).
 *   3. `invalidateCpmCache(projectId)` invoca `revalidateTag('cpm:<id>')`.
 *
 * No verificamos memoización real (eso depende del runtime de Next; el
 * objetivo es asegurar el contrato con la API).
 */

const unstableCacheCalls: Array<{
  fn: (...args: unknown[]) => unknown
  keyParts: string[]
  options: { tags?: string[] }
}> = []
const revalidateTagCalls: Array<{ tag: string; profile: unknown }> = []

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(
    fn: T,
    keyParts: string[],
    options: { tags?: string[] },
  ) => {
    unstableCacheCalls.push({ fn, keyParts, options })
    // Retornamos la función sin cachear realmente — los asserts inspeccionan
    // los argumentos con los que `unstable_cache` fue invocado.
    return fn
  },
  revalidateTag: (tag: string, profile?: unknown) => {
    revalidateTagCalls.push({ tag, profile })
  },
}))

const loadCpmInputForProjectMock = vi.fn(async (projectId: string) => ({
  projectStart: new Date('2026-05-01T00:00:00Z'),
  tasks: [
    { id: `${projectId}-A`, duration: 2, isMilestone: false },
    { id: `${projectId}-B`, duration: 3, isMilestone: false },
  ],
  dependencies: [
    {
      predecessorId: `${projectId}-A`,
      successorId: `${projectId}-B`,
      type: 'FS' as const,
      lag: 0,
    },
  ],
}))

vi.mock('@/lib/scheduling/prismaAdapter', () => ({
  loadCpmInputForProject: (projectId: string) =>
    loadCpmInputForProjectMock(projectId),
}))

beforeEach(() => {
  unstableCacheCalls.length = 0
  revalidateTagCalls.length = 0
  loadCpmInputForProjectMock.mockClear()
})

describe('getCachedCpmForProject', () => {
  it('envuelve la lectura en unstable_cache con keyParts y tag por proyecto', async () => {
    const { getCachedCpmForProject } = await import('@/lib/scheduling/cache')
    const out = await getCachedCpmForProject('proj-1')

    expect(out).not.toBeNull()
    expect(unstableCacheCalls).toHaveLength(1)
    const call = unstableCacheCalls[0]
    expect(call.keyParts).toEqual(['cpm-by-project', 'proj-1'])
    expect(call.options.tags).toEqual(['cpm:proj-1'])
  })

  it('retorna payload serializable (sin Map, fechas como string ISO)', async () => {
    const { getCachedCpmForProject } = await import('@/lib/scheduling/cache')
    const out = await getCachedCpmForProject('proj-2')

    expect(out).not.toBeNull()
    expect(Array.isArray(out!.results)).toBe(true)
    for (const r of out!.results) {
      expect(typeof r.startDate).toBe('string')
      expect(typeof r.endDate).toBe('string')
      // ISO 8601 con Z al final (UTC).
      expect(r.startDate).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    }
    expect(typeof out!.projectDuration).toBe('number')
    expect(Array.isArray(out!.criticalPath)).toBe(true)
  })

  it('retorna null cuando el proyecto no tiene tareas', async () => {
    loadCpmInputForProjectMock.mockResolvedValueOnce({
      projectStart: new Date('2026-05-01T00:00:00Z'),
      tasks: [],
      dependencies: [],
    })
    const { getCachedCpmForProject } = await import('@/lib/scheduling/cache')
    const out = await getCachedCpmForProject('proj-empty')
    expect(out).toBeNull()
  })

  it('retorna null si projectId es vacío (no llama al adapter)', async () => {
    const { getCachedCpmForProject } = await import('@/lib/scheduling/cache')
    const out = await getCachedCpmForProject('')
    expect(out).toBeNull()
    expect(loadCpmInputForProjectMock).not.toHaveBeenCalled()
  })
})

describe('invalidateCpmCache', () => {
  it('llama revalidateTag con el tag por proyecto y profile "max"', async () => {
    const { invalidateCpmCache } = await import('@/lib/scheduling/invalidate')
    invalidateCpmCache('proj-9')
    expect(revalidateTagCalls).toEqual([{ tag: 'cpm:proj-9', profile: 'max' }])
  })

  it('no-op cuando projectId es null/undefined', async () => {
    const { invalidateCpmCache } = await import('@/lib/scheduling/invalidate')
    invalidateCpmCache(null)
    invalidateCpmCache(undefined)
    expect(revalidateTagCalls).toEqual([])
  })
})
