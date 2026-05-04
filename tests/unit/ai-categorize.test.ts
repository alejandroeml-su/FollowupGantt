import { describe, it, expect } from 'vitest'
import { categorizeTask, listCategories } from '@/lib/ai/categorize'

/**
 * Ola P5 · Equipo P5-4 — Tests de la heurística `categorizeTask`.
 *
 * Cobertura solicitada: ≥ 10 keywords/categorías distintas; mentions y
 * tags; OTHER fallback; determinismo.
 */

describe('categorizeTask · keywords ES', () => {
  it('detecta DESIGN en "Diseñar mockup en Figma"', () => {
    const r = categorizeTask('Diseñar mockup en Figma', null)
    expect(r.suggestedCategory).toBe('DESIGN')
    expect(r.suggestedTaskType).toBe('PMI_TASK')
    expect(r.confidence).toBeGreaterThan(0)
  })

  it('detecta RELEASE en "Despliegue del release de producción"', () => {
    const r = categorizeTask('Despliegue del release de producción', null)
    expect(r.suggestedCategory).toBe('RELEASE')
  })

  it('detecta BUG en "Bug crítico en login: error 500"', () => {
    const r = categorizeTask('Bug crítico en login: error 500', null)
    expect(r.suggestedCategory).toBe('BUG')
    expect(r.suggestedTaskType).toBe('ITIL_TICKET')
  })

  it('detecta MEETING en "Reunión semanal con el equipo"', () => {
    const r = categorizeTask('Reunión semanal con el equipo', null)
    expect(r.suggestedCategory).toBe('MEETING')
  })

  it('detecta DOCS en "Actualizar documentación en wiki"', () => {
    const r = categorizeTask('Actualizar documentación en wiki', null)
    expect(r.suggestedCategory).toBe('DOCS')
  })

  it('detecta REFACTOR en "Refactorizar el módulo de auth"', () => {
    const r = categorizeTask('Refactorizar el módulo de auth', null)
    expect(r.suggestedCategory).toBe('REFACTOR')
  })

  it('detecta TESTING en "Agregar tests unitarios al CPM"', () => {
    const r = categorizeTask('Agregar tests unitarios al CPM', null)
    expect(r.suggestedCategory).toBe('TESTING')
  })

  it('detecta RESEARCH en "Spike de investigación sobre observabilidad"', () => {
    const r = categorizeTask('Spike de investigación sobre observabilidad', null)
    expect(r.suggestedCategory).toBe('RESEARCH')
  })

  it('detecta INFRA en "Configurar pipeline de CI/CD en Kubernetes"', () => {
    const r = categorizeTask('Configurar pipeline de CI/CD en Kubernetes', null)
    expect(r.suggestedCategory).toBe('INFRA')
  })

  it('detecta SUPPORT en "Atender ticket de soporte de cliente"', () => {
    const r = categorizeTask('Atender ticket de soporte de cliente', null)
    expect(r.suggestedCategory).toBe('SUPPORT')
  })

  it('cae a OTHER cuando no hay keywords', () => {
    const r = categorizeTask('Tarea genérica xyz', null)
    expect(r.suggestedCategory).toBe('OTHER')
    expect(r.confidence).toBe(0)
    expect(r.reasoning[0]).toMatch(/Sin coincidencias/)
  })
})

describe('categorizeTask · mentions y tags', () => {
  it('extrae @email del texto', () => {
    const r = categorizeTask(
      'Reunión con @ana@example.com y @juan.perez@example.com',
      null,
    )
    expect(r.mentionedEmails).toEqual([
      'ana@example.com',
      'juan.perez@example.com',
    ])
  })

  it('extrae #tags del texto', () => {
    const r = categorizeTask('Bug crítico #frontend #login', null)
    expect(r.suggestedTags).toEqual(['frontend', 'login'])
  })

  it('combina mentions + tags en reasoning', () => {
    const r = categorizeTask(
      'Refactorizar #core con @ana@example.com',
      'Sprint actual',
    )
    expect(r.suggestedTags).toContain('core')
    expect(r.mentionedEmails).toContain('ana@example.com')
    expect(r.reasoning.some((x) => x.includes('Menciones detectadas'))).toBe(true)
    expect(r.reasoning.some((x) => x.includes('Etiquetas sugeridas'))).toBe(true)
  })

  it('no captura @x si no es email válido', () => {
    const r = categorizeTask('@alguien revisar esto', null)
    expect(r.mentionedEmails).toEqual([])
  })
})

describe('categorizeTask · determinismo y casos límite', () => {
  it('produce salida idéntica para el mismo input', () => {
    const a = categorizeTask('Bug en el deploy', 'detalles')
    const b = categorizeTask('Bug en el deploy', 'detalles')
    expect(a).toEqual(b)
  })

  it('respeta orden de prioridad en empates (BUG > RELEASE)', () => {
    // Mismo número de matches → gana BUG por CATEGORY_PRIORITY.
    const r = categorizeTask('Bug del despliegue', null)
    expect(r.suggestedCategory).toBe('BUG')
  })

  it('eleva la confianza cuando hay 3+ keywords distintas', () => {
    const r = categorizeTask('Bug error fallo crash', null)
    expect(r.confidence).toBe(1)
  })

  it('listCategories retorna las 11 categorías incluyendo OTHER', () => {
    const cats = listCategories()
    expect(cats.length).toBe(11)
    expect(cats).toContain('OTHER')
    expect(cats).toContain('BUG')
  })

  it('maneja description null y string vacío', () => {
    const r1 = categorizeTask('', null)
    expect(r1.suggestedCategory).toBe('OTHER')
    const r2 = categorizeTask('Test E2E', '')
    expect(r2.suggestedCategory).toBe('TESTING')
  })

  it('normaliza acentos y mayúsculas', () => {
    const r = categorizeTask('DOCUMENTACIÓN del API', null)
    expect(r.suggestedCategory).toBe('DOCS')
  })
})
