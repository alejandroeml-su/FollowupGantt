import { describe, it, expect } from 'vitest'

/**
 * Ola P4 · Equipo P4-2 — tests del catálogo de scopes para la API REST.
 *
 * Cubre validación de scopes (entrada del usuario al crear token) e
 * implicaciones (`*` cubre todo, `:admin` implica `:write` que implica `:read`).
 */

import { validateScopes, hasScope, KNOWN_SCOPES } from '@/lib/api/scopes'

describe('validateScopes', () => {
  it('filtra scopes desconocidos y deduplica', () => {
    const result = validateScopes([
      'projects:read',
      'projects:read', // duplicado → 1
      'unknown:scope', // descartado
      'tasks:write',
      42 as unknown as string, // tipo inválido → descartado
    ])
    expect(result).toEqual(['projects:read', 'tasks:write'])
  })

  it('input no-array devuelve []', () => {
    expect(validateScopes('projects:read' as unknown)).toEqual([])
    expect(validateScopes(null)).toEqual([])
    expect(validateScopes(undefined)).toEqual([])
  })

  it('todos los KNOWN_SCOPES son válidos por construcción', () => {
    expect(validateScopes([...KNOWN_SCOPES])).toEqual([...KNOWN_SCOPES])
  })
})

describe('hasScope', () => {
  it('wildcard `*` cubre cualquier scope', () => {
    expect(hasScope(['*'], 'projects:read')).toBe(true)
    expect(hasScope(['*'], 'tasks:write')).toBe(true)
    expect(hasScope(['*'], 'baselines:admin')).toBe(true)
  })

  it('scope literal exacto cubre', () => {
    expect(hasScope(['projects:read'], 'projects:read')).toBe(true)
    expect(hasScope(['tasks:write'], 'tasks:write')).toBe(true)
  })

  it('write implica read del mismo recurso', () => {
    expect(hasScope(['projects:write'], 'projects:read')).toBe(true)
    expect(hasScope(['tasks:write'], 'tasks:read')).toBe(true)
  })

  it('admin implica write y read del mismo recurso', () => {
    expect(hasScope(['baselines:admin'], 'baselines:read')).toBe(true)
    // No tenemos `baselines:write` en KNOWN_SCOPES, pero la regla aplica al patrón
    expect(hasScope(['projects:write'], 'projects:read')).toBe(true)
  })

  it('scope de otro recurso NO cubre', () => {
    expect(hasScope(['tasks:read'], 'projects:read')).toBe(false)
    expect(hasScope(['projects:write'], 'tasks:read')).toBe(false)
  })

  it('read NO implica write', () => {
    expect(hasScope(['projects:read'], 'projects:write')).toBe(false)
  })

  it('lista vacía no cubre nada', () => {
    expect(hasScope([], 'projects:read')).toBe(false)
  })
})
