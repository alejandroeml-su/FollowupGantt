import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Ola P1 · Equipo 3 — Tests de los server actions de Custom Fields.
 *
 * Mockeamos `next/cache` (revalidate*, unstable_cache) y `@/lib/prisma`
 * para no tocar BD ni runtime Next. La función `unstable_cache` recibe
 * un loader; en este mock devolvemos el loader sin envolver para no
 * agregar capa async extra que dificulte el assert.
 */

// ─────────────────────────── Mocks ───────────────────────────

const projectFindUnique = vi.fn()
const defFindUnique = vi.fn()
const defFindFirst = vi.fn()
const defFindMany = vi.fn()
const defCreate = vi.fn()
const defUpdate = vi.fn()
const defDelete = vi.fn()
const taskFindUnique = vi.fn()
const valueUpsert = vi.fn()
const valueDeleteMany = vi.fn()
const valueFindMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    project: {
      findUnique: (...args: unknown[]) => projectFindUnique(...args),
    },
    customFieldDef: {
      findUnique: (...args: unknown[]) => defFindUnique(...args),
      findFirst: (...args: unknown[]) => defFindFirst(...args),
      findMany: (...args: unknown[]) => defFindMany(...args),
      create: (...args: unknown[]) => defCreate(...args),
      update: (...args: unknown[]) => defUpdate(...args),
      delete: (...args: unknown[]) => defDelete(...args),
    },
    task: {
      findUnique: (...args: unknown[]) => taskFindUnique(...args),
    },
    customFieldValue: {
      upsert: (...args: unknown[]) => valueUpsert(...args),
      deleteMany: (...args: unknown[]) => valueDeleteMany(...args),
      findMany: (...args: unknown[]) => valueFindMany(...args),
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  // unstable_cache(loader, _key, _opts) → devuelve el loader directo;
  // suficiente para nuestras lecturas sintéticas.
  unstable_cache: (loader: () => unknown) => loader,
}))

// `@prisma/client` se importa real porque el SUT usa `Prisma.JsonNull`
// como sentinela. Vitest carga el módulo real sin instanciar PrismaClient
// (la BD vive detrás de `@/lib/prisma`, que ya está mockeado arriba).

// ─────────────────────────── Reset ───────────────────────────

beforeEach(() => {
  projectFindUnique.mockReset()
  projectFindUnique.mockResolvedValue({ id: 'p1' })

  defFindUnique.mockReset()
  defFindUnique.mockResolvedValue(null)

  defFindFirst.mockReset()
  defFindFirst.mockResolvedValue(null)

  defFindMany.mockReset()
  defFindMany.mockResolvedValue([])

  defCreate.mockReset()
  defCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'def-1',
    projectId: 'p1',
    createdAt: new Date(),
    ...data,
  }))

  defUpdate.mockReset()
  defUpdate.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
    id: where.id,
    projectId: 'p1',
    key: 'key',
    label: 'label',
    type: 'TEXT',
    required: false,
    options: null,
    position: 1,
    createdAt: new Date(),
    defaultValue: null,
    ...data,
  }))

  defDelete.mockReset()
  defDelete.mockResolvedValue({ id: 'def-1' })

  taskFindUnique.mockReset()
  taskFindUnique.mockResolvedValue({ id: 't1', projectId: 'p1' })

  valueUpsert.mockReset()
  valueUpsert.mockImplementation(async (args: { where: { fieldId_taskId: { fieldId: string; taskId: string } }; create: { value: unknown }; update?: { value?: unknown } }) => ({
    id: 'val-1',
    fieldId: args.where.fieldId_taskId.fieldId,
    taskId: args.where.fieldId_taskId.taskId,
    value: args.update?.value ?? args.create.value,
  }))

  valueDeleteMany.mockReset()
  valueDeleteMany.mockResolvedValue({ count: 1 })

  valueFindMany.mockReset()
  valueFindMany.mockResolvedValue([])
})

// ─────────────────────────── Tests ───────────────────────────

describe('createFieldDef', () => {
  it('crea una definición TEXT con position incremental', async () => {
    defFindFirst.mockResolvedValueOnce({ position: 3 })
    const { createFieldDef } = await import('@/lib/actions/custom-fields')
    const out = await createFieldDef('p1', {
      key: 'cliente_codigo',
      label: 'Código de cliente',
      type: 'TEXT',
    })
    expect(out.id).toBe('def-1')
    const callArg = defCreate.mock.calls.at(-1)?.[0] as { data: { position: number; type: string } }
    expect(callArg.data.position).toBe(4)
    expect(callArg.data.type).toBe('TEXT')
  })

  it('rechaza key con caracteres inválidos como [INVALID_INPUT]', async () => {
    const { createFieldDef } = await import('@/lib/actions/custom-fields')
    await expect(
      createFieldDef('p1', { key: 'Mi-Key', label: 'X', type: 'TEXT' }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('rechaza SELECT sin opciones como [INVALID_FIELD_TYPE]', async () => {
    const { createFieldDef } = await import('@/lib/actions/custom-fields')
    await expect(
      createFieldDef('p1', { key: 'estado', label: 'Estado', type: 'SELECT' }),
    ).rejects.toThrow(/\[INVALID_FIELD_TYPE\]/)
  })

  it('rechaza key duplicada como [FIELD_KEY_DUPLICATE]', async () => {
    defFindUnique.mockResolvedValueOnce({ id: 'existing' })
    const { createFieldDef } = await import('@/lib/actions/custom-fields')
    await expect(
      createFieldDef('p1', { key: 'duplicada', label: 'X', type: 'TEXT' }),
    ).rejects.toThrow(/\[FIELD_KEY_DUPLICATE\]/)
  })

  it('rechaza projectId desconocido como [NOT_FOUND]', async () => {
    projectFindUnique.mockResolvedValueOnce(null)
    const { createFieldDef } = await import('@/lib/actions/custom-fields')
    await expect(
      createFieldDef('p1', { key: 'k', label: 'X', type: 'TEXT' }),
    ).rejects.toThrow(/\[NOT_FOUND\]/)
  })

  it('crea SELECT con options válidas', async () => {
    const { createFieldDef } = await import('@/lib/actions/custom-fields')
    await createFieldDef('p1', {
      key: 'estado_externo',
      label: 'Estado externo',
      type: 'SELECT',
      options: [
        { value: 'open', label: 'Abierto' },
        { value: 'closed', label: 'Cerrado' },
      ],
    })
    const callArg = defCreate.mock.calls.at(-1)?.[0] as { data: { type: string; options: unknown } }
    expect(callArg.data.type).toBe('SELECT')
    expect(callArg.data.options).toEqual([
      { value: 'open', label: 'Abierto' },
      { value: 'closed', label: 'Cerrado' },
    ])
  })
})

describe('setTaskFieldValue', () => {
  it('valida valor TEXT y lo persiste con trim', async () => {
    defFindUnique.mockResolvedValueOnce({
      id: 'def-1',
      projectId: 'p1',
      type: 'TEXT',
      options: null,
      required: false,
    })
    const { setTaskFieldValue } = await import('@/lib/actions/custom-fields')
    const out = await setTaskFieldValue('t1', 'def-1', '  hola  ')
    expect(out.value).toBe('hola')
  })

  it('rechaza NUMBER recibiendo string como [FIELD_VALUE_INVALID]', async () => {
    defFindUnique.mockResolvedValueOnce({
      id: 'def-1',
      projectId: 'p1',
      type: 'NUMBER',
      options: null,
      required: false,
    })
    const { setTaskFieldValue } = await import('@/lib/actions/custom-fields')
    await expect(setTaskFieldValue('t1', 'def-1', '12')).rejects.toThrow(
      /\[FIELD_VALUE_INVALID\]/,
    )
  })

  it('valida SELECT contra options definidas', async () => {
    defFindUnique.mockResolvedValueOnce({
      id: 'def-1',
      projectId: 'p1',
      type: 'SELECT',
      options: [{ value: 'a', label: 'A' }],
      required: false,
    })
    const { setTaskFieldValue } = await import('@/lib/actions/custom-fields')
    await expect(setTaskFieldValue('t1', 'def-1', 'z')).rejects.toThrow(
      /\[FIELD_VALUE_INVALID\]/,
    )
  })

  it('rechaza tarea de proyecto distinto como [FIELD_VALUE_INVALID]', async () => {
    defFindUnique.mockResolvedValueOnce({
      id: 'def-1',
      projectId: 'p1',
      type: 'TEXT',
      options: null,
      required: false,
    })
    taskFindUnique.mockResolvedValueOnce({ id: 't1', projectId: 'p2' })
    const { setTaskFieldValue } = await import('@/lib/actions/custom-fields')
    await expect(setTaskFieldValue('t1', 'def-1', 'hi')).rejects.toThrow(
      /\[FIELD_VALUE_INVALID\]/,
    )
  })

  it('rechaza required + valor vacío como [FIELD_VALUE_INVALID]', async () => {
    defFindUnique.mockResolvedValueOnce({
      id: 'def-1',
      projectId: 'p1',
      type: 'TEXT',
      options: null,
      required: true,
    })
    const { setTaskFieldValue } = await import('@/lib/actions/custom-fields')
    await expect(setTaskFieldValue('t1', 'def-1', '   ')).rejects.toThrow(
      /\[FIELD_VALUE_INVALID\]/,
    )
  })

  it('valida URL http/https', async () => {
    defFindUnique.mockResolvedValueOnce({
      id: 'def-1',
      projectId: 'p1',
      type: 'URL',
      options: null,
      required: false,
    })
    const { setTaskFieldValue } = await import('@/lib/actions/custom-fields')
    await expect(setTaskFieldValue('t1', 'def-1', 'ftp://x')).rejects.toThrow(
      /\[FIELD_VALUE_INVALID\]/,
    )
  })

  it('valida MULTI_SELECT y deduplica', async () => {
    defFindUnique.mockResolvedValueOnce({
      id: 'def-1',
      projectId: 'p1',
      type: 'MULTI_SELECT',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
      required: false,
    })
    const { setTaskFieldValue } = await import('@/lib/actions/custom-fields')
    const out = await setTaskFieldValue('t1', 'def-1', ['a', 'b', 'a'])
    expect(out.value).toEqual(['a', 'b'])
  })
})

describe('clearTaskFieldValue', () => {
  it('elimina con deleteMany y es idempotente', async () => {
    valueDeleteMany.mockResolvedValueOnce({ count: 0 })
    const { clearTaskFieldValue } = await import('@/lib/actions/custom-fields')
    await expect(clearTaskFieldValue('t1', 'def-1')).resolves.toBeUndefined()
    expect(valueDeleteMany).toHaveBeenCalledWith({
      where: { taskId: 't1', fieldId: 'def-1' },
    })
  })
})

describe('deleteFieldDef', () => {
  it('borra def existente y revalida path', async () => {
    defFindUnique.mockResolvedValueOnce({ projectId: 'p1' })
    const { deleteFieldDef } = await import('@/lib/actions/custom-fields')
    await deleteFieldDef('def-1')
    expect(defDelete).toHaveBeenCalledWith({ where: { id: 'def-1' } })
  })

  it('si no existe no lanza ni borra (idempotente)', async () => {
    defFindUnique.mockResolvedValueOnce(null)
    const { deleteFieldDef } = await import('@/lib/actions/custom-fields')
    await expect(deleteFieldDef('def-x')).resolves.toBeUndefined()
    expect(defDelete).not.toHaveBeenCalled()
  })
})

describe('updateFieldDef', () => {
  it('valida tipo SELECT sin opciones lanzando [INVALID_FIELD_TYPE]', async () => {
    defFindUnique.mockResolvedValueOnce({
      id: 'def-1',
      projectId: 'p1',
      key: 'k',
      type: 'TEXT',
      options: null,
    })
    const { updateFieldDef } = await import('@/lib/actions/custom-fields')
    await expect(updateFieldDef('def-1', { type: 'SELECT' })).rejects.toThrow(
      /\[INVALID_FIELD_TYPE\]/,
    )
  })

  it('actualiza label y devuelve el registro', async () => {
    defFindUnique.mockResolvedValueOnce({
      id: 'def-1',
      projectId: 'p1',
      key: 'k',
      type: 'TEXT',
      options: null,
    })
    const { updateFieldDef } = await import('@/lib/actions/custom-fields')
    const out = await updateFieldDef('def-1', { label: 'Nuevo' })
    expect(out.id).toBe('def-1')
    const callArg = defUpdate.mock.calls.at(-1)?.[0] as { data: { label: string } }
    expect(callArg.data.label).toBe('Nuevo')
  })
})

describe('getFieldDefsForProject', () => {
  it('rechaza projectId vacío con [INVALID_INPUT]', async () => {
    const { getFieldDefsForProject } = await import('@/lib/actions/custom-fields')
    await expect(getFieldDefsForProject('')).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('lee defs con orden por position asc', async () => {
    defFindMany.mockResolvedValueOnce([
      { id: 'd1', position: 1, key: 'a' },
      { id: 'd2', position: 2, key: 'b' },
    ])
    const { getFieldDefsForProject } = await import('@/lib/actions/custom-fields')
    const out = await getFieldDefsForProject('p1')
    expect(out).toHaveLength(2)
    expect(defFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'p1' },
      }),
    )
  })
})
