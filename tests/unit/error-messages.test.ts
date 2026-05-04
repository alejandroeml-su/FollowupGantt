import { describe, it, expect } from 'vitest'
import {
  ERROR_CODE_KEYS,
  parseErrorCode,
  translateError,
} from '@/lib/i18n/error-messages'

/**
 * Ola P4 · P4-4 — Tests para el mapeo de errores tipados a strings i18n.
 *
 * El proyecto usa la convención `[CODE] detalle libre` en server actions
 * (ver `src/lib/auth/*`, `src/lib/actions/*`). El mapeo client-side debe:
 *   1. Reconocer el `[CODE]` y devolver la traducción correspondiente.
 *   2. Tolerar errores sin `[CODE]` (zod issues, mensajes ya formateados).
 *   3. No filtrar códigos internos al usuario cuando no estén mapeados.
 */

describe('error-messages · mapeo i18n', () => {
  it('parseErrorCode extrae el código entre brackets', () => {
    expect(parseErrorCode('[UNAUTHORIZED] Sesión requerida')).toBe(
      'UNAUTHORIZED',
    )
    expect(parseErrorCode('[INVALID_INPUT]: campo email')).toBe('INVALID_INPUT')
    expect(parseErrorCode('  [FORBIDDEN] x')).toBe('FORBIDDEN')
  })

  it('parseErrorCode devuelve undefined cuando no hay match', () => {
    expect(parseErrorCode('error genérico sin code')).toBeUndefined()
    expect(parseErrorCode('')).toBeUndefined()
    expect(parseErrorCode('[lowercase] ignorado')).toBeUndefined()
  })

  it('traduce códigos conocidos al español por defecto', () => {
    expect(translateError('[UNAUTHORIZED] Sesión requerida')).toBe(
      'Sesión requerida. Inicia sesión para continuar.',
    )
    expect(translateError('[FORBIDDEN] No tienes acceso')).toBe(
      'No tienes permisos para realizar esta acción.',
    )
    expect(translateError('[INVALID_CREDENTIALS]')).toBe(
      'Credenciales inválidas.',
    )
  })

  it('traduce los mismos códigos al inglés cuando se especifica locale', () => {
    expect(translateError('[UNAUTHORIZED] Sesión requerida', 'en')).toBe(
      'Session required. Sign in to continue.',
    )
    expect(translateError('[NOT_FOUND] x', 'en')).toBe(
      'The requested resource does not exist.',
    )
  })

  it('acepta una instancia de Error como entrada', () => {
    const err = new Error('[FORBIDDEN] No autorizado')
    expect(translateError(err)).toBe(
      'No tienes permisos para realizar esta acción.',
    )
  })

  it('códigos no mapeados caen al genérico (sin filtrar internos)', () => {
    expect(translateError('[INTERNAL_KAFKA_BROKER_DOWN] crash')).toBe(
      'Error desconocido.',
    )
    expect(translateError('[INTERNAL_KAFKA_BROKER_DOWN] crash', 'en')).toBe(
      'Unknown error.',
    )
  })

  it('mensajes sin [CODE] se devuelven tal cual', () => {
    expect(translateError('Email inválido')).toBe('Email inválido')
    expect(translateError('Password too short')).toBe('Password too short')
  })

  it('inputs vacíos o no string caen a error.unknown', () => {
    expect(translateError('')).toBe('Error desconocido.')
    expect(translateError(null)).toBe('Error desconocido.')
    expect(translateError(undefined)).toBe('Error desconocido.')
    expect(translateError({} as unknown)).toBe('Error desconocido.')
  })

  it('ERROR_CODE_KEYS expone el catálogo en lectura', () => {
    expect(ERROR_CODE_KEYS.UNAUTHORIZED).toBe('error.unauthorized')
    expect(ERROR_CODE_KEYS.FORBIDDEN).toBe('error.forbidden')
    // Cobertura mínima de codes documentados en repo:
    expect(Object.keys(ERROR_CODE_KEYS)).toEqual(
      expect.arrayContaining([
        'UNAUTHORIZED',
        'FORBIDDEN',
        'NOT_FOUND',
        'INVALID_INPUT',
        'INVALID_CREDENTIALS',
        'INVALID_SESSION',
        'CONFLICT',
        'RATE_LIMITED',
      ]),
    )
  })
})
