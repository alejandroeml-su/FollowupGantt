import { describe, it, expect } from 'vitest'

/**
 * Wave P17-B · Equipo B — tests del catálogo de scopes v2.
 *
 * Reglas:
 *   - `*` cubre todo.
 *   - `write:<resource>` implica `read:<resource>`.
 *   - Literal exacto cubre.
 *   - read NO implica write.
 */

import {
  validateV2Scopes,
  hasV2Scope,
  KNOWN_V2_SCOPES,
} from '@/lib/api/v2-scopes'

describe('validateV2Scopes', () => {
  it('filtra scopes desconocidos y deduplica', () => {
    const result = validateV2Scopes([
      'read:projects',
      'read:projects', // duplicado
      'unknown:thing',
      'write:tasks',
      42 as unknown as string,
    ])
    expect(result).toEqual(['read:projects', 'write:tasks'])
  })

  it('input no-array devuelve []', () => {
    expect(validateV2Scopes('read:projects')).toEqual([])
    expect(validateV2Scopes(null)).toEqual([])
    expect(validateV2Scopes(undefined)).toEqual([])
  })

  it('todos los KNOWN_V2_SCOPES son válidos por construcción', () => {
    expect(validateV2Scopes([...KNOWN_V2_SCOPES])).toEqual([
      ...KNOWN_V2_SCOPES,
    ])
  })
})

describe('hasV2Scope', () => {
  it('wildcard `*` cubre cualquier scope', () => {
    expect(hasV2Scope(['*'], 'read:projects')).toBe(true)
    expect(hasV2Scope(['*'], 'write:tasks')).toBe(true)
    expect(hasV2Scope(['*'], 'read:risks')).toBe(true)
  })

  it('scope literal exacto cubre', () => {
    expect(hasV2Scope(['read:projects'], 'read:projects')).toBe(true)
    expect(hasV2Scope(['write:tasks'], 'write:tasks')).toBe(true)
  })

  it('write implica read del mismo recurso', () => {
    expect(hasV2Scope(['write:projects'], 'read:projects')).toBe(true)
    expect(hasV2Scope(['write:tasks'], 'read:tasks')).toBe(true)
    expect(hasV2Scope(['write:risks'], 'read:risks')).toBe(true)
  })

  it('read NO implica write', () => {
    expect(hasV2Scope(['read:projects'], 'write:projects')).toBe(false)
    expect(hasV2Scope(['read:tasks'], 'write:tasks')).toBe(false)
  })

  it('scope de otro recurso NO cubre', () => {
    expect(hasV2Scope(['read:tasks'], 'read:projects')).toBe(false)
    expect(hasV2Scope(['write:projects'], 'write:tasks')).toBe(false)
  })

  it('lista vacía no cubre nada', () => {
    expect(hasV2Scope([], 'read:projects')).toBe(false)
  })
})
