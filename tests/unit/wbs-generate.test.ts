import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  setLLMClient,
  type LLMClient,
  type GenerateTextResponse,
  redactPII,
} from '@/lib/ai/llm'
import {
  generateWBSFromBriefLLM,
  extractFirstJSON,
} from '@/lib/ai/wbs/generate-wbs'
import { hashBrief, buildUserPrompt } from '@/lib/ai/wbs/prompt-templates'
import {
  wbsSchema,
  assertDepth,
  sanitizeDependencies,
  breakCycles,
  type WBSGenerated,
} from '@/lib/ai/wbs/wbs-schema'

/**
 * Wave P7 · P7-2 — Tests del path LLM y schema.
 *
 * Mockeamos el adapter `@/lib/ai/llm` mediante `setLLMClient()`. Cada test
 * inyecta una respuesta canned y valida que `generateWBSFromBriefLLM`:
 *   - parsea fences markdown,
 *   - rechaza JSON inválido o fuera de schema,
 *   - sanitiza dependencias y rompe ciclos,
 *   - aplica `projectName` override,
 *   - propaga métricas (tokens, fromCache, provider).
 *
 * También cubrimos:
 *   - `redactPII` con email / RFC / teléfono.
 *   - `extractFirstJSON` con casos edge.
 *   - `assertDepth` lanza al exceder profundidad.
 *   - `sanitizeDependencies` y `breakCycles` directos.
 */

const sampleWBS: WBSGenerated = {
  projectName: 'CRM',
  description: 'Implementación de CRM con módulos de ventas, marketing y soporte.',
  estimatedDurationDays: 90,
  phases: [
    {
      name: 'Discovery',
      order: 0,
      tasks: [
        {
          title: 'Levantamiento',
          type: 'PMI_TASK',
          estimatedDays: 5,
          priority: 'HIGH',
        },
        {
          title: 'Diseño',
          type: 'PMI_TASK',
          estimatedDays: 5,
          priority: 'HIGH',
          dependsOn: ['Levantamiento'],
        },
      ],
    },
    {
      name: 'Build',
      order: 1,
      tasks: [
        {
          title: 'Implementar backend',
          type: 'AGILE_STORY',
          estimatedDays: 10,
          priority: 'CRITICAL',
          dependsOn: ['Diseño'],
        },
      ],
    },
  ],
}

function buildClient(text: string, opts: Partial<GenerateTextResponse> = {}): LLMClient {
  return {
    async generateText() {
      return {
        text,
        tokensUsed: opts.tokensUsed ?? 100,
        fromCache: opts.fromCache ?? false,
        provider: opts.provider ?? 'mock',
      }
    },
  }
}

beforeEach(() => {
  setLLMClient(null)
})
afterEach(() => {
  setLLMClient(null)
})

// ─────────────────────────── redactPII ─────────────────────────────────

describe('redactPII', () => {
  it('redacta email y teléfono', () => {
    const out = redactPII('Contacta a juan.perez@example.com o al +52 55 1234 5678')
    expect(out).not.toContain('juan.perez@example.com')
    expect(out).toContain('[EMAIL_REDACTED]')
    expect(out).toContain('[PHONE_REDACTED]')
  })

  it('redacta RFC mexicano', () => {
    const out = redactPII('RFC: ABCD850101AB1')
    expect(out).toContain('[ID_REDACTED]')
  })

  it('no toca texto sin PII', () => {
    expect(redactPII('Proyecto interno sin datos sensibles')).toBe(
      'Proyecto interno sin datos sensibles',
    )
  })
})

// ─────────────────────────── extractFirstJSON ─────────────────────────

describe('extractFirstJSON', () => {
  it('extrae JSON limpio sin fences', () => {
    expect(extractFirstJSON('{"a": 1}')).toBe('{"a": 1}')
  })

  it('extrae JSON dentro de fences markdown', () => {
    const out = extractFirstJSON('```json\n{"a": 1}\n```')
    expect(out).toBe('{"a": 1}')
  })

  it('balancea llaves anidadas e ignora llaves dentro de strings', () => {
    const out = extractFirstJSON('prefijo {"a": "{abierta"} sufijo')
    expect(out).toBe('{"a": "{abierta"}')
  })

  it('retorna null cuando no hay JSON', () => {
    expect(extractFirstJSON('sólo texto plano')).toBeNull()
  })

  it('retorna null si el JSON está incompleto', () => {
    expect(extractFirstJSON('{"a": 1')).toBeNull()
  })
})

// ─────────────────────────── hashBrief / buildUserPrompt ──────────────

describe('hashBrief y buildUserPrompt', () => {
  it('hashBrief es determinístico y >= 8 chars', () => {
    const a = hashBrief('hola mundo')
    const b = hashBrief('hola mundo')
    expect(a).toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(8)
  })

  it('hashBrief discrimina briefs distintos', () => {
    expect(hashBrief('A')).not.toBe(hashBrief('B'))
  })

  it('buildUserPrompt redacta PII y respeta projectName', () => {
    const out = buildUserPrompt('contacto: foo@bar.com', { projectName: 'X' })
    expect(out).not.toContain('foo@bar.com')
    expect(out).toContain('[EMAIL_REDACTED]')
    expect(out).toContain('"X"')
  })
})

// ─────────────────────────── generateWBSFromBriefLLM ──────────────────

describe('generateWBSFromBriefLLM', () => {
  it('rechaza brief muy corto con [INVALID_INPUT]', async () => {
    await expect(generateWBSFromBriefLLM('corto')).rejects.toThrow(/INVALID_INPUT/)
  })

  it('lanza [LLM_FAILED] cuando el adapter devuelve texto vacío', async () => {
    setLLMClient(buildClient(''))
    await expect(
      generateWBSFromBriefLLM('Brief razonable de proyecto de software'),
    ).rejects.toThrow(/LLM_FAILED/)
  })

  it('lanza [INVALID_OUTPUT] si no hay JSON balanceado', async () => {
    setLLMClient(buildClient('texto plano sin JSON'))
    await expect(
      generateWBSFromBriefLLM('Brief razonable de proyecto de software'),
    ).rejects.toThrow(/INVALID_OUTPUT/)
  })

  it('lanza [INVALID_OUTPUT] si el JSON no cumple schema', async () => {
    setLLMClient(buildClient('{"foo": "bar"}'))
    await expect(
      generateWBSFromBriefLLM('Brief razonable de proyecto de software'),
    ).rejects.toThrow(/INVALID_OUTPUT/)
  })

  it('parsea JSON válido y devuelve métricas + WBS', async () => {
    setLLMClient(
      buildClient(JSON.stringify(sampleWBS), {
        tokensUsed: 250,
        fromCache: false,
        provider: 'mock',
      }),
    )
    const res = await generateWBSFromBriefLLM(
      'Implementar CRM con módulos de ventas y soporte',
    )
    expect(res.wbs.projectName).toBe('CRM')
    expect(res.tokensUsed).toBe(250)
    expect(res.provider).toBe('mock')
    expect(res.warnings).toEqual([])
  })

  it('honra projectName override', async () => {
    setLLMClient(buildClient(JSON.stringify(sampleWBS)))
    const res = await generateWBSFromBriefLLM(
      'Implementar CRM con módulos de ventas y soporte',
      { projectName: 'Proyecto X' },
    )
    expect(res.wbs.projectName).toBe('Proyecto X')
  })

  it('parsea JSON envuelto en fences markdown', async () => {
    const wrapped = '```json\n' + JSON.stringify(sampleWBS) + '\n```'
    setLLMClient(buildClient(wrapped))
    const res = await generateWBSFromBriefLLM(
      'Implementar CRM con módulos de ventas y soporte',
    )
    expect(res.wbs.projectName).toBe('CRM')
  })

  it('warnings cuando el LLM retorna dependsOn inexistente', async () => {
    const broken: WBSGenerated = structuredClone(sampleWBS)
    broken.phases[0].tasks[0].dependsOn = ['Tarea Inexistente']
    setLLMClient(buildClient(JSON.stringify(broken)))
    const res = await generateWBSFromBriefLLM(
      'Implementar CRM con módulos de ventas y soporte',
    )
    expect(res.warnings.length).toBeGreaterThan(0)
    expect(res.warnings[0]).toMatch(/no existe/i)
  })

  it('rompe ciclos directos sin lanzar', async () => {
    const cyc: WBSGenerated = structuredClone(sampleWBS)
    cyc.phases[0].tasks[0].dependsOn = ['Diseño']
    cyc.phases[0].tasks[1].dependsOn = ['Levantamiento']
    setLLMClient(buildClient(JSON.stringify(cyc)))
    const res = await generateWBSFromBriefLLM(
      'Implementar CRM con módulos de ventas y soporte',
    )
    expect(res.warnings.some((w) => w.toLowerCase().includes('ciclo'))).toBe(true)
  })
})

// ─────────────────────────── Schema helpers ───────────────────────────

describe('wbsSchema · validación', () => {
  it('acepta WBS mínimo', () => {
    expect(wbsSchema.safeParse(sampleWBS).success).toBe(true)
  })

  it('rechaza projectName vacío', () => {
    const bad = { ...sampleWBS, projectName: '' }
    expect(wbsSchema.safeParse(bad).success).toBe(false)
  })

  it('rechaza estimatedDays > 90 en una task', () => {
    const bad = structuredClone(sampleWBS)
    bad.phases[0].tasks[0].estimatedDays = 200
    expect(wbsSchema.safeParse(bad).success).toBe(false)
  })

  it('acepta fase sin tasks (límite 1+ vía system prompt)', () => {
    // Wave P14b: Anthropic structured output rechaza minItems · phases.tasks
    // ahora es `z.array(...)` sin `.min(1)`. El system prompt + post-LLM
    // sanitization se encargan de descartar fases vacías.
    const bad = structuredClone(sampleWBS)
    bad.phases[0].tasks = []
    expect(wbsSchema.safeParse(bad).success).toBe(true)
  })
})

describe('assertDepth', () => {
  it('lanza cuando children excede MAX_TASK_DEPTH', () => {
    const deep: WBSGenerated = structuredClone(sampleWBS)
    // Construir 5 niveles encadenados sobre la primera task.
    let cursor = deep.phases[0].tasks[0]
    for (let i = 0; i < 5; i++) {
      cursor.children = [
        { title: `lvl${i}`, type: 'PMI_TASK', estimatedDays: 1, priority: 'LOW' },
      ]
      cursor = cursor.children[0]
    }
    expect(() => assertDepth(deep)).toThrow(/INVALID_OUTPUT/)
  })

  it('no lanza con profundidad <= 4', () => {
    const ok = structuredClone(sampleWBS)
    expect(() => assertDepth(ok)).not.toThrow()
  })
})

describe('sanitizeDependencies y breakCycles', () => {
  it('sanitizeDependencies remueve self-loop y referencias inexistentes', () => {
    const bad = structuredClone(sampleWBS)
    bad.phases[0].tasks[0].dependsOn = ['Levantamiento', 'Inexistente']
    const { warnings } = sanitizeDependencies(bad)
    expect(warnings.length).toBe(2)
    expect(bad.phases[0].tasks[0].dependsOn).toEqual([])
  })

  it('breakCycles elimina la arista que cierra el ciclo', () => {
    const cyc = structuredClone(sampleWBS)
    cyc.phases[0].tasks[0].dependsOn = ['Diseño']
    cyc.phases[0].tasks[1].dependsOn = ['Levantamiento']
    const { warnings } = breakCycles(cyc)
    expect(warnings.length).toBeGreaterThan(0)
    // Una de las dos aristas debe quedar removida.
    const after =
      (cyc.phases[0].tasks[0].dependsOn ?? []).length +
      (cyc.phases[0].tasks[1].dependsOn ?? []).length
    expect(after).toBeLessThanOrEqual(1)
  })
})

// ─────────────────────────── Integración: server action ───────────────

describe('generateWBSFromBrief (action) · happy path', () => {
  beforeEach(() => {
    vi.doMock('@/lib/auth/get-current-user', () => ({
      requireUser: async () => ({ id: 'user-1', email: 'u@x.com', name: 'U' }),
      getCurrentUser: async () => ({ id: 'user-1', email: 'u@x.com', name: 'U' }),
    }))
  })

  it('cae al heurístico cuando el LLM lanza', async () => {
    setLLMClient({
      async generateText() {
        throw new Error('boom')
      },
    })
    const { generateWBSFromBrief } = await import('@/lib/actions/wbs-generator')
    const res = await generateWBSFromBrief({
      brief: 'Implementar CRM con módulos de ventas y soporte',
    })
    expect(res.source).toBe('heuristic')
    expect(res.templateId).toBeDefined()
    expect(res.wbs.phases.length).toBeGreaterThan(0)
    expect(res.llmError).toMatch(/boom/)
  })

  it('usa el LLM cuando responde con WBS válido', async () => {
    setLLMClient(buildClient(JSON.stringify(sampleWBS)))
    const { generateWBSFromBrief } = await import('@/lib/actions/wbs-generator')
    const res = await generateWBSFromBrief({
      brief: 'Implementar CRM con módulos de ventas y soporte',
    })
    expect(res.source).toBe('llm')
    expect(res.wbs.projectName).toBe('CRM')
  })
})
