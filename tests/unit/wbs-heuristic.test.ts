import { describe, it, expect } from 'vitest'

import {
  generateWBSFromBriefHeuristic,
  pickTemplate,
} from '@/lib/ai/wbs/heuristic-wbs'
import { wbsSchema, sanitizeDependencies, breakCycles } from '@/lib/ai/wbs/wbs-schema'

/**
 * Wave P7 · P7-2 — Tests del fallback heurístico determinista. Cubrimos:
 *   - Detección de template por keywords (3 templates + default).
 *   - Estructura: 3 fases × ≥4 tasks, schema válido.
 *   - Determinismo: dos llamadas idénticas devuelven WBS idénticos.
 *   - Estimación con teamSize ajusta `estimatedDurationDays`.
 *   - Sin ciclos ni dependencias rotas (sanitizers no remueven nada).
 */

describe('pickTemplate · keyword matching', () => {
  it('detecta software-project para CRM/web/aplicación', () => {
    expect(pickTemplate('Necesito una aplicación CRM web').id).toBe('software-project')
  })

  it('detecta marketing-campaign para "campaña de marketing"', () => {
    expect(pickTemplate('Lanzar campaña de marketing en redes sociales').id).toBe(
      'marketing-campaign',
    )
  })

  it('detecta infrastructure-deploy para "migración a AWS"', () => {
    expect(pickTemplate('Migración de infraestructura a AWS con kubernetes').id).toBe(
      'infrastructure-deploy',
    )
  })

  it('cae a software-project como default cuando no hay match', () => {
    const m = pickTemplate('asunto desconocido sin keywords relevantes ñ')
    expect(m.id).toBe('software-project')
    expect(m.score).toBe(0)
  })
})

describe('generateWBSFromBriefHeuristic · estructura', () => {
  it('software-project genera 3 fases válidas contra schema', () => {
    const { wbs, templateId } = generateWBSFromBriefHeuristic(
      'Implementar CRM con módulo de ventas y soporte',
    )
    expect(templateId).toBe('software-project')
    const parsed = wbsSchema.safeParse(wbs)
    expect(parsed.success).toBe(true)
    expect(wbs.phases).toHaveLength(3)
    expect(wbs.phases.every((p) => p.tasks.length >= 4)).toBe(true)
  })

  it('marketing-campaign deriva projectName del brief si no se da', () => {
    const { wbs } = generateWBSFromBriefHeuristic(
      'Campaña de lanzamiento de marca para Q4. Foco en awareness.',
    )
    expect(wbs.projectName.length).toBeGreaterThan(0)
    expect(wbs.projectName.length).toBeLessThanOrEqual(80)
    // El brief pega marketing-campaign por keywords.
    expect(wbs.phases.length).toBe(3)
  })

  it('infrastructure-deploy honra projectName explícito', () => {
    const { wbs } = generateWBSFromBriefHeuristic('Migración cloud AWS', {
      projectName: 'Proyecto Phoenix',
    })
    expect(wbs.projectName).toBe('Proyecto Phoenix')
  })

  it('todas las fases tienen order único y secuencial', () => {
    const { wbs } = generateWBSFromBriefHeuristic('plataforma web')
    const orders = wbs.phases.map((p) => p.order)
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('todas las tasks tienen estimatedDays >=1 y <=90', () => {
    const { wbs } = generateWBSFromBriefHeuristic('software a desarrollar')
    for (const phase of wbs.phases) {
      for (const t of phase.tasks) {
        expect(t.estimatedDays).toBeGreaterThanOrEqual(1)
        expect(t.estimatedDays).toBeLessThanOrEqual(90)
      }
    }
  })
})

describe('generateWBSFromBriefHeuristic · determinismo y team scaling', () => {
  it('dos invocaciones idénticas producen WBS idéntico', () => {
    const a = generateWBSFromBriefHeuristic('CRM con módulo de ventas', { teamSize: 3 })
    const b = generateWBSFromBriefHeuristic('CRM con módulo de ventas', { teamSize: 3 })
    expect(JSON.stringify(a.wbs)).toBe(JSON.stringify(b.wbs))
  })

  it('teamSize > 1 reduce estimatedDurationDays vs teamSize=1', () => {
    const small = generateWBSFromBriefHeuristic('plataforma web', { teamSize: 1 })
    const big = generateWBSFromBriefHeuristic('plataforma web', { teamSize: 10 })
    expect(big.wbs.estimatedDurationDays).toBeLessThanOrEqual(
      small.wbs.estimatedDurationDays,
    )
  })

  it('forceTemplate sobreescribe la inferencia por keywords', () => {
    const { templateId } = generateWBSFromBriefHeuristic('CRM software web', {
      forceTemplate: 'marketing-campaign',
    })
    expect(templateId).toBe('marketing-campaign')
  })
})

describe('generateWBSFromBriefHeuristic · dependencias internas', () => {
  it('todas las dependsOn referencian tasks existentes (sin orphans)', () => {
    const { wbs } = generateWBSFromBriefHeuristic('proyecto de software')
    const before = sanitizeDependencies(structuredClone(wbs)).warnings.length
    expect(before).toBe(0)
  })

  it('no produce ciclos en software-project', () => {
    const { wbs } = generateWBSFromBriefHeuristic('software web app')
    const before = breakCycles(structuredClone(wbs)).warnings.length
    expect(before).toBe(0)
  })

  it('no produce ciclos en infrastructure-deploy', () => {
    const { wbs } = generateWBSFromBriefHeuristic('despliegue cloud kubernetes')
    const before = breakCycles(structuredClone(wbs)).warnings.length
    expect(before).toBe(0)
  })
})
