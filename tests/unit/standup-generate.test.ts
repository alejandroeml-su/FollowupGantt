/**
 * Ola P7 · Equipo P7-4 · Daily Standup — Tests del generador.
 *
 * Cubre:
 *   - Parser zod del schema (válido, inválido).
 *   - Heurística genera output válido contra el schema.
 *   - `generateStandup` con generator inyectado (ramo "LLM ok").
 *   - Cache TTL: segundo call devuelve mismo objeto.
 *   - `force: true` bypassea cache.
 *   - Generator que arroja → fallback heurístico.
 *   - Generator que devuelve payload inválido → fallback heurístico.
 *   - Tono casual / formal afecta summaryShort heurístico.
 *
 * No depende de Prisma ni Anthropic.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  generateStandup,
  clearStandupCache,
  _internalStandupCacheSize,
} from '@/lib/ai/standup/generate-standup'
import { buildHeuristicStandup } from '@/lib/ai/standup/heuristic-standup'
import { parseStandup } from '@/lib/ai/standup/standup-schema'
import type {
  StandupContext,
  StandupTaskSnapshot,
} from '@/lib/ai/standup/build-standup-context'

function snapshot(partial: Partial<StandupTaskSnapshot>): StandupTaskSnapshot {
  return {
    id: partial.id ?? 't1',
    title: partial.title ?? 'Task',
    status: partial.status ?? 'IN_PROGRESS',
    progress: partial.progress ?? 0,
    endDate: partial.endDate ?? null,
    isMilestone: partial.isMilestone ?? false,
    assigneeId: partial.assigneeId ?? 'u1',
    assigneeName: partial.assigneeName ?? 'Alice',
    assigneeEmail: partial.assigneeEmail ?? 'alice@x.com',
    projectId: partial.projectId ?? 'p1',
    projectName: partial.projectName ?? 'Operación X',
    blockerReason: partial.blockerReason ?? null,
  }
}

function ctxFor(partial: Partial<StandupContext> = {}): StandupContext {
  return {
    scope: 'project',
    scopeId: 'p1',
    date: '2026-05-04',
    yesterday: partial.yesterday ?? [],
    today: partial.today ?? [],
    blockers: partial.blockers ?? [],
    recentComments: partial.recentComments ?? [],
    meta: partial.meta ?? {
      projectName: 'Operación X',
      projectId: 'p1',
      sprintName: null,
      upcomingMilestones: [],
      participants: ['Alice'],
    },
  }
}

beforeEach(() => {
  clearStandupCache()
  delete process.env.ANTHROPIC_API_KEY
})

// ────────────────────────── Schema ─────────────────────────────────────

describe('standupSchema · parseStandup', () => {
  it('acepta payload válido completo', () => {
    const standup = parseStandup({
      date: '2026-05-04',
      participants: ['Alice'],
      yesterday: [{ user: 'Alice', items: ['Cerré X'] }],
      today: [{ user: 'Alice', items: ['Sigo con Y'] }],
      blockers: [],
      summaryShort: 'Buen día.',
      summaryFull: '**Hoy**: avance.',
    })
    expect(standup.date).toBe('2026-05-04')
  })

  it('rechaza date no ISO', () => {
    expect(() =>
      parseStandup({
        date: 'mañana',
        participants: [],
        yesterday: [],
        today: [],
        blockers: [],
        summaryShort: 's',
        summaryFull: 'f',
      }),
    ).toThrow(/\[INVALID_STANDUP\]/)
  })

  it('rechaza summaryShort > 240 chars', () => {
    expect(() =>
      parseStandup({
        date: '2026-05-04',
        participants: [],
        yesterday: [],
        today: [],
        blockers: [],
        summaryShort: 'x'.repeat(241),
        summaryFull: 'f',
      }),
    ).toThrow(/\[INVALID_STANDUP\]/)
  })
})

// ────────────────────────── Heurística ─────────────────────────────────

describe('buildHeuristicStandup', () => {
  it('produce output válido contra el schema con tareas mixtas', () => {
    const ctx = ctxFor({
      yesterday: [snapshot({ id: 'y', title: 'Cerré PR' })],
      today: [snapshot({ id: 't', title: 'Implementar tests' })],
      blockers: [
        snapshot({
          id: 'b',
          title: 'Bloqueada',
          assigneeName: null,
          assigneeId: null,
          blockerReason: 'NO_ASSIGNEE',
        }),
      ],
    })
    const standup = buildHeuristicStandup(ctx)
    expect(() => parseStandup(standup)).not.toThrow()
    expect(standup.yesterday).toHaveLength(1)
    expect(standup.today).toHaveLength(1)
    expect(standup.blockers).toHaveLength(1)
    expect(standup.blockers[0].suggestedAction).toMatch(/Asignar/)
  })

  it('produce summaryShort distinto entre tono casual y formal', () => {
    const ctx = ctxFor({
      today: [snapshot({ title: 'Algo' })],
    })
    const formal = buildHeuristicStandup(ctx, { tone: 'formal' })
    const casual = buildHeuristicStandup(ctx, { tone: 'casual' })
    expect(formal.summaryShort).not.toEqual(casual.summaryShort)
    expect(casual.summaryShort).toMatch(/Buen día/)
  })

  it('soporta proyectos sin tareas (output válido vacío)', () => {
    const ctx = ctxFor({})
    const standup = buildHeuristicStandup(ctx)
    expect(() => parseStandup(standup)).not.toThrow()
    expect(standup.yesterday).toEqual([])
    expect(standup.blockers).toEqual([])
  })
})

// ────────────────────────── generateStandup ────────────────────────────

describe('generateStandup · cache + fallback', () => {
  it('usa el generator inyectado y devuelve standup válido', async () => {
    const ctx = ctxFor({
      today: [snapshot({ title: 'Tarea X' })],
    })
    const generator = async () => ({
      date: ctx.date,
      participants: ['Alice'],
      yesterday: [],
      today: [{ user: 'Alice', items: ['Tarea X'] }],
      blockers: [],
      summaryShort: 'Resumen LLM',
      summaryFull: 'Detalle LLM',
    })
    const out = await generateStandup(ctx, { generator })
    expect(out.summaryShort).toBe('Resumen LLM')
  })

  it('cache hit en segundo call con mismo scope + tone', async () => {
    const ctx = ctxFor({})
    let calls = 0
    const generator = async () => {
      calls += 1
      return {
        date: ctx.date,
        participants: [],
        yesterday: [],
        today: [],
        blockers: [],
        summaryShort: `call#${calls}`,
        summaryFull: 'detalle',
      }
    }
    const a = await generateStandup(ctx, { generator })
    const b = await generateStandup(ctx, { generator })
    expect(calls).toBe(1)
    expect(a.summaryShort).toBe(b.summaryShort)
    expect(_internalStandupCacheSize()).toBe(1)
  })

  it('force=true bypassea cache', async () => {
    const ctx = ctxFor({})
    let calls = 0
    const generator = async () => {
      calls += 1
      return {
        date: ctx.date,
        participants: [],
        yesterday: [],
        today: [],
        blockers: [],
        summaryShort: `call#${calls}`,
        summaryFull: 'detalle',
      }
    }
    const a = await generateStandup(ctx, { generator })
    const b = await generateStandup(ctx, { generator, force: true })
    expect(calls).toBe(2)
    expect(a.summaryShort).not.toBe(b.summaryShort)
  })

  it('fallback heurístico si generator arroja', async () => {
    const ctx = ctxFor({
      today: [snapshot({ title: 'Cae en heurística' })],
    })
    const generator = async () => {
      throw new Error('LLM 500')
    }
    const out = await generateStandup(ctx, { generator })
    // El heurístico siempre incluye el bullet con el título.
    expect(JSON.stringify(out)).toContain('Cae en heurística')
    // Y el summaryShort es el formal por default.
    expect(out.summaryShort).toMatch(/Reporte de avance|completadas/)
  })

  it('fallback heurístico si LLM devuelve payload inválido', async () => {
    const ctx = ctxFor({
      today: [snapshot({ title: 'A' })],
    })
    const generator = async () => ({ broken: true })
    const out = await generateStandup(ctx, { generator })
    // Debe ser parseable (es del heurístico).
    expect(() => parseStandup(out)).not.toThrow()
  })

  it('sin generator y sin ANTHROPIC_API_KEY usa heurística', async () => {
    const ctx = ctxFor({
      today: [snapshot({ title: 'Sin LLM' })],
    })
    const out = await generateStandup(ctx)
    expect(() => parseStandup(out)).not.toThrow()
    expect(JSON.stringify(out)).toContain('Sin LLM')
  })

  it('usa now() inyectado para verificar TTL', async () => {
    const ctx = ctxFor({})
    let nowMs = 1_700_000_000_000
    const generator = async () => ({
      date: ctx.date,
      participants: [],
      yesterday: [],
      today: [],
      blockers: [],
      summaryShort: 'r',
      summaryFull: 'r',
    })
    await generateStandup(ctx, { generator, now: () => nowMs })
    // Avanzamos +13h → el cache expiró.
    nowMs += 13 * 60 * 60 * 1000
    let secondCalls = 0
    const generator2 = async () => {
      secondCalls += 1
      return {
        date: ctx.date,
        participants: [],
        yesterday: [],
        today: [],
        blockers: [],
        summaryShort: 'r2',
        summaryFull: 'r2',
      }
    }
    await generateStandup(ctx, { generator: generator2, now: () => nowMs })
    expect(secondCalls).toBe(1)
  })
})
