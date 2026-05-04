import { describe, it, expect } from 'vitest'
import {
  parseRuleShape,
  safeParseRulePersisted,
  ruleShapeSchema,
} from '@/lib/automation/validation'

/**
 * Ola P5 · Equipo P5-5 — Tests de validación zod del shape de reglas.
 */

describe('parseRuleShape', () => {
  it('acepta shape mínimo válido', () => {
    const r = parseRuleShape({
      trigger: { event: 'form.submitted' },
      conditions: [],
      actions: [{ kind: 'sendWebhook', url: 'https://example.com/x' }],
    })
    expect(r.trigger.event).toBe('form.submitted')
    expect(r.actions).toHaveLength(1)
  })

  it('rechaza trigger.event desconocido', () => {
    expect(() =>
      parseRuleShape({
        trigger: { event: 'foo.bar' },
        actions: [{ kind: 'sendWebhook', url: 'https://x' }],
      }),
    ).toThrow()
  })

  it('rechaza actions vacías', () => {
    expect(() =>
      parseRuleShape({
        trigger: { event: 'form.submitted' },
        conditions: [],
        actions: [],
      }),
    ).toThrow()
  })

  it('rechaza más de 5 actions', () => {
    const actions = Array.from({ length: 6 }, () => ({
      kind: 'sendWebhook' as const,
      url: 'https://x',
    }))
    expect(() =>
      parseRuleShape({
        trigger: { event: 'form.submitted' },
        actions,
      }),
    ).toThrow()
  })

  it('rechaza más de 10 conditions', () => {
    const conditions = Array.from({ length: 11 }, () => ({
      field: 'a',
      op: '=' as const,
      value: 'x',
    }))
    expect(() =>
      parseRuleShape({
        trigger: { event: 'form.submitted' },
        conditions,
        actions: [{ kind: 'sendWebhook', url: 'https://x' }],
      }),
    ).toThrow()
  })

  it('rechaza op no soportado', () => {
    expect(() =>
      parseRuleShape({
        trigger: { event: 'form.submitted' },
        conditions: [{ field: 'a', op: 'regex', value: 'x' }],
        actions: [{ kind: 'sendWebhook', url: 'https://x' }],
      }),
    ).toThrow()
  })

  it('rechaza url inválida en sendWebhook', () => {
    expect(() =>
      parseRuleShape({
        trigger: { event: 'form.submitted' },
        actions: [{ kind: 'sendWebhook', url: 'not-a-url' }],
      }),
    ).toThrow()
  })

  it('valida discriminador kind en actions', () => {
    expect(() =>
      parseRuleShape({
        trigger: { event: 'form.submitted' },
        actions: [{ kind: 'unknown' } as never],
      }),
    ).toThrow()
  })

  it('acepta createTask con priority opcional', () => {
    const r = parseRuleShape({
      trigger: { event: 'task.created' },
      actions: [
        { kind: 'createTask', projectId: 'p', title: 'T', priority: 'HIGH' },
      ],
    })
    expect(r.actions[0]).toMatchObject({ priority: 'HIGH' })
  })

  it('acepta updateField con field permitido', () => {
    const r = parseRuleShape({
      trigger: { event: 'status.changed' },
      actions: [{ kind: 'updateField', taskId: 't1', field: 'progress', value: 100 }],
    })
    expect(r.actions[0]).toMatchObject({ field: 'progress' })
  })

  it('rechaza updateField.field no permitido', () => {
    expect(() =>
      parseRuleShape({
        trigger: { event: 'status.changed' },
        actions: [
          {
            kind: 'updateField',
            taskId: 't1',
            field: 'title' as never,
            value: 'X',
          },
        ],
      }),
    ).toThrow()
  })
})

describe('safeParseRulePersisted', () => {
  it('devuelve null si el trigger es inválido', () => {
    const r = safeParseRulePersisted({
      id: 'r1',
      name: 'X',
      isActive: true,
      trigger: { event: 'invalid' },
      conditions: [],
      actions: [{ kind: 'sendWebhook', url: 'https://x' }],
    })
    expect(r).toBeNull()
  })

  it('devuelve null si actions están vacías', () => {
    const r = safeParseRulePersisted({
      id: 'r1',
      name: 'X',
      isActive: true,
      trigger: { event: 'form.submitted' },
      conditions: [],
      actions: [],
    })
    expect(r).toBeNull()
  })

  it('parsea regla persistida válida', () => {
    const r = safeParseRulePersisted({
      id: 'r1',
      name: 'X',
      isActive: true,
      trigger: { event: 'form.submitted' },
      conditions: [{ field: 'a', op: '=', value: 'x' }],
      actions: [{ kind: 'sendWebhook', url: 'https://x' }],
    })
    expect(r).not.toBeNull()
    expect(r?.id).toBe('r1')
  })

  it('tolera conditions undefined → array vacío', () => {
    const r = safeParseRulePersisted({
      id: 'r1',
      name: 'X',
      isActive: true,
      trigger: { event: 'form.submitted' },
      conditions: undefined,
      actions: [{ kind: 'sendWebhook', url: 'https://x' }],
    })
    expect(r).not.toBeNull()
    expect(r?.conditions).toEqual([])
  })
})

describe('ruleShapeSchema', () => {
  it('expone safeParse desde zod', () => {
    const r = ruleShapeSchema.safeParse({
      trigger: { event: 'form.submitted' },
      actions: [{ kind: 'sendWebhook', url: 'https://x' }],
    })
    expect(r.success).toBe(true)
  })
})
