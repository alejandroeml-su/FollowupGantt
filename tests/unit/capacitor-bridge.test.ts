import { describe, it, expect, beforeEach, afterEach } from 'vitest'

/**
 * Wave P21-A · Tests defensivos del bridge Capacitor.
 *
 * Verifica que los helpers `src/lib/mobile/capacitor-bridge.ts`:
 *   1. Detectan correctamente la ausencia de `window.Capacitor` (web).
 *   2. Detectan correctamente la presencia (Android/iOS).
 *   3. Manejan errores del runtime nativo sin lanzar.
 *   4. Son SSR-safe (no asumen `window`).
 *
 * Importamos dinámicamente para que cada test pueda manipular el
 * `window.Capacitor` global ANTES de la primera importación si fuera
 * necesario; en la práctica las funciones leen `window.Capacitor` en
 * cada llamada, así que basta con mutar el global entre tests.
 */

import {
  isCapacitor,
  isNativeMobile,
  getPlatform,
} from '@/lib/mobile/capacitor-bridge'

type CapacitorMock = {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
}

declare global {
  interface Window {
    Capacitor?: CapacitorMock
  }
}

function setCapacitor(cap: CapacitorMock | undefined) {
  if (cap === undefined) {
    delete (window as Window & { Capacitor?: CapacitorMock }).Capacitor
  } else {
    ;(window as Window & { Capacitor?: CapacitorMock }).Capacitor = cap
  }
}

describe('capacitor-bridge · web (sin Capacitor)', () => {
  beforeEach(() => setCapacitor(undefined))
  afterEach(() => setCapacitor(undefined))

  it('isCapacitor() devuelve false cuando window.Capacitor no existe', () => {
    expect(isCapacitor()).toBe(false)
  })

  it('getPlatform() devuelve "web" cuando no hay runtime nativo', () => {
    expect(getPlatform()).toBe('web')
  })

  it('isNativeMobile() devuelve false en web', () => {
    expect(isNativeMobile()).toBe(false)
  })
})

describe('capacitor-bridge · runtime nativo (Android/iOS)', () => {
  afterEach(() => setCapacitor(undefined))

  it('isCapacitor() devuelve true cuando isNativePlatform → true', () => {
    setCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => 'android',
    })
    expect(isCapacitor()).toBe(true)
  })

  it('isCapacitor() devuelve false cuando isNativePlatform → false', () => {
    setCapacitor({
      isNativePlatform: () => false,
      getPlatform: () => 'web',
    })
    expect(isCapacitor()).toBe(false)
  })

  it('getPlatform() reporta "android" en Android', () => {
    setCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => 'android',
    })
    expect(getPlatform()).toBe('android')
    expect(isNativeMobile()).toBe(true)
  })

  it('getPlatform() reporta "ios" en iOS', () => {
    setCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
    })
    expect(getPlatform()).toBe('ios')
    expect(isNativeMobile()).toBe(true)
  })

  it('getPlatform() cae a "web" si getPlatform() devuelve un valor desconocido', () => {
    setCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => 'unknown-platform',
    })
    expect(getPlatform()).toBe('web')
  })
})

describe('capacitor-bridge · runtime con APIs rotas (defensivo)', () => {
  afterEach(() => setCapacitor(undefined))

  it('isCapacitor() no lanza si isNativePlatform() throws — devuelve false', () => {
    setCapacitor({
      isNativePlatform: () => {
        throw new Error('boom')
      },
    })
    expect(() => isCapacitor()).not.toThrow()
    expect(isCapacitor()).toBe(false)
  })

  it('getPlatform() no lanza si getPlatform() throws — devuelve "web"', () => {
    setCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => {
        throw new Error('boom')
      },
    })
    expect(() => getPlatform()).not.toThrow()
    expect(getPlatform()).toBe('web')
  })

  it('isCapacitor() devuelve true cuando Capacitor existe pero sin isNativePlatform (fallback)', () => {
    setCapacitor({})
    expect(isCapacitor()).toBe(true)
  })

  it('getPlatform() devuelve "web" cuando Capacitor existe pero sin getPlatform', () => {
    setCapacitor({})
    expect(getPlatform()).toBe('web')
  })
})
