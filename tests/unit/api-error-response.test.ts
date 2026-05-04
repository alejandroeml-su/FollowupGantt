import { describe, it, expect } from 'vitest'

/**
 * Ola P4 · Equipo P4-2 — tests del helper de respuesta de error de la API.
 *
 * Cubre el shape canónico `{error:{code,message}}`, el mapeo código→status,
 * y la traducción de errores tipados de server actions (`[CODE] msg`) al
 * Response API.
 */

import {
  apiError,
  apiOk,
  parseTaggedError,
  errorResponseFromException,
  statusForCode,
} from '@/lib/api/error-response'

describe('statusForCode', () => {
  it('mapea códigos conocidos a status HTTP correctos', () => {
    expect(statusForCode('INVALID_INPUT')).toBe(400)
    expect(statusForCode('UNAUTHORIZED')).toBe(401)
    expect(statusForCode('FORBIDDEN')).toBe(403)
    expect(statusForCode('NOT_FOUND')).toBe(404)
    expect(statusForCode('CONFLICT')).toBe(409)
    expect(statusForCode('DEPENDENCY_EXISTS')).toBe(409)
    expect(statusForCode('CYCLE_DETECTED')).toBe(422)
    expect(statusForCode('NEGATIVE_FLOAT')).toBe(422)
    expect(statusForCode('PROJECT_EMPTY')).toBe(422)
  })

  it('código desconocido cae a 500', () => {
    expect(statusForCode('FOO_BAR')).toBe(500)
  })
})

describe('apiError / apiOk', () => {
  it('apiError construye Response con shape canónico', async () => {
    const res = apiError('INVALID_INPUT', 'falta campo title')
    expect(res.status).toBe(400)
    expect(res.headers.get('Content-Type')).toMatch(/application\/json/)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.json()
    expect(body).toEqual({
      error: { code: 'INVALID_INPUT', message: 'falta campo title' },
    })
  })

  it('apiOk default status 200 y permite override', async () => {
    const res200 = apiOk({ id: 'p1' })
    expect(res200.status).toBe(200)
    const body = await res200.json()
    expect(body).toEqual({ id: 'p1' })

    const res201 = apiOk({ id: 'p1' }, { status: 201 })
    expect(res201.status).toBe(201)
  })

  it('apiError honra status explícito por encima del mapeo automático', async () => {
    const res = apiError('UNAUTHORIZED', 'token expirado', 418)
    expect(res.status).toBe(418)
  })
})

describe('parseTaggedError', () => {
  it('parsea el patrón [CODE] msg', () => {
    expect(parseTaggedError(new Error('[NOT_FOUND] proyecto inexistente'))).toEqual({
      code: 'NOT_FOUND',
      message: 'proyecto inexistente',
    })
  })

  it('mensaje sin tag → INTERNAL_ERROR', () => {
    expect(parseTaggedError(new Error('algo explotó'))).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'algo explotó',
    })
  })

  it('non-Error → INTERNAL_ERROR + String(err)', () => {
    expect(parseTaggedError('boom')).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'boom',
    })
  })
})

describe('errorResponseFromException', () => {
  it('convierte error tipado en Response 422', async () => {
    const res = errorResponseFromException(new Error('[CYCLE_DETECTED] x'))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error.code).toBe('CYCLE_DETECTED')
  })

  it('error sin tag → 500', async () => {
    const res = errorResponseFromException(new Error('boom'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.code).toBe('INTERNAL_ERROR')
  })
})
