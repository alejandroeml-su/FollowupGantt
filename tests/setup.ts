import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Limpia el DOM entre tests
afterEach(() => cleanup())

// `server-only` es un marker package de React/Next que en build-time
// genera un error si se importa desde código cliente. En tests no aplica;
// stubeamos con módulo vacío para que cualquier `import 'server-only'`
// pase. Necesario para el módulo `@/lib/auth/*` (Ola P1).
vi.mock('server-only', () => ({}))

// Mock global para next/cache (usado por todas las server actions)
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

// Wave P6 · B3 — Mock global de `@/lib/supabase`. El cliente real invoca
// `createClient(url, key)` a nivel módulo y lanza si la URL falta. En
// tests jamás queremos esa instanciación; los tests que ejercitan
// Realtime inyectan un cliente mockeado mediante `injectedClient`.
// Tests específicos pueden hacer `vi.mock('@/lib/supabase', ...)` por
// archivo y este mock global se sobrescribe sin conflictos.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: () => {
      throw new Error(
        '[supabase mock global] usa `injectedClient` o re-mockea por archivo',
      )
    },
    removeChannel: () => undefined,
    auth: {},
    from: () => ({}),
  },
}))

// Mock global de next/navigation para componentes que usan useRouter
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/list',
  useSearchParams: () => new URLSearchParams(),
}))

// matchMedia stub (usado por algunos componentes de Radix)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// crypto.randomUUID para el Toaster
if (!globalThis.crypto?.randomUUID) {
  // @ts-expect-error jsdom puede no exponerlo
  globalThis.crypto = { ...globalThis.crypto, randomUUID: () => Math.random().toString(36).slice(2) }
}
