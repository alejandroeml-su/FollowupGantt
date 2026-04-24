import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Limpia el DOM entre tests
afterEach(() => cleanup())

// Mock global para next/cache (usado por todas las server actions)
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
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
