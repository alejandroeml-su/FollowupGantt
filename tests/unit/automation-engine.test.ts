import { describe, it, expect, vi } from 'vitest'
import {
  matchesTrigger,
  getFieldValue,
  evaluateCondition,
  evaluateAllConditions,
  runRuleActions,
  runAutomations,
  MAX_ACTIONS_PER_EXECUTION,
  type ActionAdapter,
} from '@/lib/automation/engine'
import type {
  AutomationAction,
  AutomationCondition,
  AutomationContext,
  AutomationRuleShape,
} from '@/lib/automation/types'

/**
 * Ola P5 · Equipo P5-5 — Tests del motor "if-this-then-that".
 */

function ctx(data: Record<string, unknown> = {}): AutomationContext {
  return { triggeredBy: 'test', data }
}

describe('getFieldValue', () => {
  it('resuelve paths simples', () => {
    expect(getFieldValue({ a: 1 }, 'a')).toBe(1)
  })
  it('resuelve paths anidados', () => {
    expect(getFieldValue({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42)
  })
  it('devuelve undefined cuando el path no existe', () => {
    expect(getFieldValue({ a: 1 }, 'a.b')).toBeUndefined()
    expect(getFieldValue({}, 'x')).toBeUndefined()
  })
  it('tolera nulls intermedios', () => {
    expect(getFieldValue({ a: null }, 'a.b')).toBeUndefined()
  })
})

describe('matchesTrigger', () => {
  it('true cuando el evento coincide y no hay match', () => {
    expect(
      matchesTrigger({ event: 'task.created' }, 'task.created', ctx()),
    ).toBe(true)
  })

  it('false cuando el evento no coincide', () => {
    expect(
      matchesTrigger({ event: 'task.created' }, 'form.submitted', ctx()),
    ).toBe(false)
  })

  it('aplica el filtro `match` sobre context.data', () => {
    expect(
      matchesTrigger(
        { event: 'task.created', match: { 'task.projectId': 'p1' } },
        'task.created',
        ctx({ task: { projectId: 'p1' } }),
      ),
    ).toBe(true)
    expect(
      matchesTrigger(
        { event: 'task.created', match: { 'task.projectId': 'p1' } },
        'task.created',
        ctx({ task: { projectId: 'p2' } }),
      ),
    ).toBe(false)
  })
})

describe('evaluateCondition', () => {
  const c = (cond: AutomationCondition, data: Record<string, unknown>) =>
    evaluateCondition(cond, ctx(data))

  it('=', () => {
    expect(c({ field: 'a', op: '=', value: 'x' }, { a: 'x' })).toBe(true)
    expect(c({ field: 'a', op: '=', value: 'y' }, { a: 'x' })).toBe(false)
  })
  it('!=', () => {
    expect(c({ field: 'a', op: '!=', value: 'x' }, { a: 'y' })).toBe(true)
  })
  it('>', () => {
    expect(c({ field: 'a', op: '>', value: 5 }, { a: 10 })).toBe(true)
    expect(c({ field: 'a', op: '>', value: 5 }, { a: 5 })).toBe(false)
  })
  it('<', () => {
    expect(c({ field: 'a', op: '<', value: 5 }, { a: 1 })).toBe(true)
  })
  it('contains (case-insensitive)', () => {
    expect(c({ field: 'a', op: 'contains', value: 'foo' }, { a: 'XfooY' })).toBe(true)
    expect(c({ field: 'a', op: 'contains', value: 'FOO' }, { a: 'xfooy' })).toBe(true)
    expect(c({ field: 'a', op: 'contains', value: 'baz' }, { a: 'foo' })).toBe(false)
  })
  it('coerciona string ↔ number en =', () => {
    expect(c({ field: 'a', op: '=', value: '5' }, { a: 5 })).toBe(true)
  })
})

describe('evaluateAllConditions', () => {
  it('AND vacío = true', () => {
    expect(evaluateAllConditions([], ctx())).toBe(true)
  })

  it('todas deben pasar', () => {
    const conds: AutomationCondition[] = [
      { field: 'a', op: '=', value: 'x' },
      { field: 'b', op: '>', value: 5 },
    ]
    expect(evaluateAllConditions(conds, ctx({ a: 'x', b: 10 }))).toBe(true)
    expect(evaluateAllConditions(conds, ctx({ a: 'x', b: 1 }))).toBe(false)
  })
})

// ─────────────────────────── Adapter mock ───────────────────────────

function mockAdapter(): ActionAdapter & {
  calls: { kind: string; payload: unknown }[]
} {
  const calls: { kind: string; payload: unknown }[] = []
  const adapter: ActionAdapter = {
    async createTask(p) {
      calls.push({ kind: 'createTask', payload: p })
      return { taskId: 't-new' }
    },
    async sendWebhook(p) {
      calls.push({ kind: 'sendWebhook', payload: p })
      return { status: 200 }
    },
    async updateField(p) {
      calls.push({ kind: 'updateField', payload: p })
      return { taskId: p.taskId, field: p.field }
    },
    async assignUser(p) {
      calls.push({ kind: 'assignUser', payload: p })
      return { taskId: p.taskId, userId: p.userId }
    },
  }
  return Object.assign(adapter, { calls })
}

describe('runRuleActions', () => {
  it('ejecuta acciones secuencialmente y devuelve ok', async () => {
    const adapter = mockAdapter()
    const actions: AutomationAction[] = [
      { kind: 'createTask', projectId: 'p1', title: 'T' },
      { kind: 'sendWebhook', url: 'https://hook.example/x' },
    ]
    const r = await runRuleActions(actions, adapter)
    expect(r).toHaveLength(2)
    expect(r.every((x) => x.ok)).toBe(true)
    expect(adapter.calls.map((c) => c.kind)).toEqual(['createTask', 'sendWebhook'])
  })

  it('respeta el límite anti-loop (5 acciones máximo)', async () => {
    const adapter = mockAdapter()
    const actions: AutomationAction[] = Array.from({ length: 8 }, () => ({
      kind: 'sendWebhook',
      url: 'https://hook.example/y',
    }))
    const r = await runRuleActions(actions, adapter)
    expect(r).toHaveLength(MAX_ACTIONS_PER_EXECUTION)
    expect(adapter.calls).toHaveLength(MAX_ACTIONS_PER_EXECUTION)
  })

  it('detiene la cadena al primer fallo', async () => {
    const adapter = mockAdapter()
    adapter.sendWebhook = async () => {
      throw new Error('boom')
    }
    const actions: AutomationAction[] = [
      { kind: 'createTask', projectId: 'p', title: 'T' },
      { kind: 'sendWebhook', url: 'https://hook' },
      { kind: 'createTask', projectId: 'p', title: 'T2' }, // no debería ejecutarse
    ]
    const r = await runRuleActions(actions, adapter)
    expect(r).toHaveLength(2)
    expect(r[0].ok).toBe(true)
    expect(r[1].ok).toBe(false)
    expect(r[1].error).toBe('boom')
  })

  it('marca ok=false con mensaje cuando una acción individual falla', async () => {
    const adapter = mockAdapter()
    adapter.createTask = async () => {
      throw new Error('db down')
    }
    const r = await runRuleActions(
      [{ kind: 'createTask', projectId: 'p', title: 'T' }],
      adapter,
    )
    expect(r[0].ok).toBe(false)
    expect(r[0].error).toBe('db down')
  })
})

// ─────────────────────────── Orquestador ───────────────────────────

const baseRule: AutomationRuleShape = {
  id: 'r1',
  name: 'Regla',
  isActive: true,
  trigger: { event: 'form.submitted' },
  conditions: [],
  actions: [{ kind: 'sendWebhook', url: 'https://hook' }],
}

describe('runAutomations', () => {
  it('dispara reglas activas que matchean el trigger', async () => {
    const adapter = mockAdapter()
    const record = vi.fn(async () => undefined)
    const out = await runAutomations(
      'form.submitted',
      ctx({ payload: { email: 'a@b.c' } }),
      {
        loadActiveRules: async () => [baseRule],
        adapter,
        recordExecution: record,
      },
    )
    expect(out).toHaveLength(1)
    expect(out[0].status).toBe('success')
    expect(record).toHaveBeenCalledWith(
      'r1',
      'test',
      'success',
      expect.objectContaining({ actions: expect.any(Array) }),
    )
  })

  it('skip cuando las condiciones no se cumplen', async () => {
    const adapter = mockAdapter()
    const record = vi.fn(async () => undefined)
    const rule: AutomationRuleShape = {
      ...baseRule,
      conditions: [{ field: 'payload.priority', op: '=', value: 'CRITICAL' }],
    }
    const out = await runAutomations(
      'form.submitted',
      ctx({ payload: { priority: 'LOW' } }),
      {
        loadActiveRules: async () => [rule],
        adapter,
        recordExecution: record,
      },
    )
    expect(out[0].status).toBe('skipped')
    expect(adapter.calls).toHaveLength(0)
  })

  it('skip y NO registra cuando el trigger no matchea (sin ruido en log)', async () => {
    const adapter = mockAdapter()
    const record = vi.fn(async () => undefined)
    const out = await runAutomations(
      'task.created',
      ctx(),
      {
        loadActiveRules: async () => [baseRule],
        adapter,
        recordExecution: record,
      },
    )
    expect(out).toHaveLength(0)
    expect(record).not.toHaveBeenCalled()
  })

  it('respeta isActive=false', async () => {
    const adapter = mockAdapter()
    const out = await runAutomations(
      'form.submitted',
      ctx(),
      {
        loadActiveRules: async () => [{ ...baseRule, isActive: false }],
        adapter,
        recordExecution: async () => undefined,
      },
    )
    expect(out).toHaveLength(0)
  })

  it('anti-loop: no dispara la misma regla via currentRuleId', async () => {
    const adapter = mockAdapter()
    const record = vi.fn(async () => undefined)
    const out = await runAutomations(
      'form.submitted',
      ctx(),
      {
        loadActiveRules: async () => [baseRule],
        adapter,
        recordExecution: record,
        currentRuleId: 'r1',
      },
    )
    expect(out).toHaveLength(1)
    expect(out[0].status).toBe('skipped')
    expect(out[0].skippedReason).toMatch(/self/i)
    expect(adapter.calls).toHaveLength(0)
  })

  it('marca status=failed si alguna acción falla', async () => {
    const adapter = mockAdapter()
    adapter.sendWebhook = async () => {
      throw new Error('boom')
    }
    const record = vi.fn(async () => undefined)
    const out = await runAutomations(
      'form.submitted',
      ctx(),
      {
        loadActiveRules: async () => [baseRule],
        adapter,
        recordExecution: record,
      },
    )
    expect(out[0].status).toBe('failed')
    expect(record).toHaveBeenCalledWith('r1', 'test', 'failed', expect.any(Object))
  })

  it('procesa múltiples reglas activas en orden', async () => {
    const adapter = mockAdapter()
    const r2: AutomationRuleShape = {
      ...baseRule,
      id: 'r2',
      actions: [{ kind: 'createTask', projectId: 'p', title: 'X' }],
    }
    const out = await runAutomations(
      'form.submitted',
      ctx(),
      {
        loadActiveRules: async () => [baseRule, r2],
        adapter,
        recordExecution: async () => undefined,
      },
    )
    expect(out).toHaveLength(2)
    expect(adapter.calls.map((c) => c.kind).sort()).toEqual(['createTask', 'sendWebhook'])
  })
})
