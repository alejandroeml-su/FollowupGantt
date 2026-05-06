import { describe, it, expect } from 'vitest'
import {
  extractMentions,
  diffNewMentions,
  isBroadcastHandle,
} from '@/lib/mentions/parse'

describe('extractMentions', () => {
  it('texto vacío o null → []', () => {
    expect(extractMentions('')).toEqual([])
    expect(extractMentions(null)).toEqual([])
    expect(extractMentions(undefined)).toEqual([])
  })

  it('una mención simple', () => {
    expect(extractMentions('hola @edwin')).toEqual(['edwin'])
  })

  it('mención al inicio', () => {
    expect(extractMentions('@edwin revisa esto')).toEqual(['edwin'])
  })

  it('mención al final', () => {
    expect(extractMentions('asignar a @maria')).toEqual(['maria'])
  })

  it('múltiples menciones en orden de aparición', () => {
    expect(extractMentions('hola @edwin y @maria, después @luis'))
      .toEqual(['edwin', 'maria', 'luis'])
  })

  it('dedupe — la misma mención dos veces solo aparece una', () => {
    expect(extractMentions('@edwin @maria @edwin')).toEqual(['edwin', 'maria'])
  })

  it('mención seguida de puntuación → handle limpio', () => {
    expect(extractMentions('@edwin, revisa @maria.')).toEqual(['edwin', 'maria'])
  })

  it('handle con punto interno (luis.perez)', () => {
    expect(extractMentions('cc @luis.perez')).toEqual(['luis.perez'])
  })

  it('handle con guion (juan-carlos)', () => {
    expect(extractMentions('cc @juan-carlos')).toEqual(['juan-carlos'])
  })

  it('email con dominio cuenta como una sola mención', () => {
    expect(extractMentions('avisa a @luis@avante.com')).toEqual(['luis@avante.com'])
  })

  it('email + handle simple coexisten', () => {
    expect(extractMentions('@edwin y @luis@avante.com')).toEqual(['edwin', 'luis@avante.com'])
  })

  it('tildes y ñ son válidos', () => {
    expect(extractMentions('@maría @niño @José')).toEqual(['maría', 'niño', 'José'])
  })

  it('@todos broadcast', () => {
    expect(extractMentions('@todos revisen esto')).toEqual(['todos'])
  })

  it('ignora menciones dentro de bloques de código backticks', () => {
    expect(extractMentions('código `@interno` y mención real @edwin'))
      .toEqual(['edwin'])
  })

  it('ignora @ aislada sin handle', () => {
    expect(extractMentions('email is name @ domain dot com')).toEqual([])
  })

  it('multiline preserva todas las menciones', () => {
    expect(extractMentions('Línea 1 con @edwin\nLínea 2 con @maria'))
      .toEqual(['edwin', 'maria'])
  })

  it('numeros en handles funcionan (@user123)', () => {
    expect(extractMentions('@user123 revisa')).toEqual(['user123'])
  })
})

describe('diffNewMentions', () => {
  it('detecta solo menciones agregadas en el nuevo texto', () => {
    expect(diffNewMentions('hola @ana', 'hola @ana y @luis'))
      .toEqual(['luis'])
  })

  it('texto idéntico → []', () => {
    expect(diffNewMentions('hola @ana', 'hola @ana')).toEqual([])
  })

  it('texto inicial null/empty considera todas como nuevas', () => {
    expect(diffNewMentions(null, 'hola @ana @luis')).toEqual(['ana', 'luis'])
    expect(diffNewMentions('', 'hola @maria')).toEqual(['maria'])
  })

  it('eliminar menciones no las marca como nuevas', () => {
    expect(diffNewMentions('@a @b @c', '@a @c')).toEqual([])
  })

  it('reemplazar menciones — solo las nuevas se notifican', () => {
    expect(diffNewMentions('@ana @luis', '@ana @maria')).toEqual(['maria'])
  })
})

describe('isBroadcastHandle', () => {
  it('reconoce variantes', () => {
    expect(isBroadcastHandle('todos')).toBe(true)
    expect(isBroadcastHandle('TODOS')).toBe(true)
    expect(isBroadcastHandle('everyone')).toBe(true)
    expect(isBroadcastHandle('all')).toBe(true)
  })

  it('handle normal no es broadcast', () => {
    expect(isBroadcastHandle('edwin')).toBe(false)
    expect(isBroadcastHandle('maria')).toBe(false)
  })
})
