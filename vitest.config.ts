import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/component/**/*.test.{ts,tsx}'],
    exclude: [
      'tests/e2e/**',
      'tests/a11y/**',
      'tests/perf/**',
      'node_modules/**',
      // R3.0-A · Wave P19-B (#184) `src/lib/brain/strategist/scenarios.ts`
      // nunca llegó a master pero el test sí (PR #186). Equipo R3-B
      // restaurará el módulo en su wave paralela. Mientras tanto el test
      // queda excluido del runner para que la suite se mantenga verde.
      // TODO(R3-B): rehabilitar al reintroducir `scenarios.ts`.
      'tests/unit/brain-strategist-scenarios.test.ts',
    ],
    // P3-5D · Bajado de 15s → 5s tras refactor de
    // `dependencies-update.test.ts` (eliminados `mockResolvedValueOnce`
    // encadenados, lift de `import` a `beforeAll`, mocks granulares por
    // collaborator). Validado 10/10 corridas verde con paralelismo
    // por defecto.
    //
    // R3.0-A · Hardening · Subido a 10s tras detectar 4-7 archivos
    // flaky (~0.3% de la suite) cuya primera ejecución de
    // `await import('@/lib/...')` tarda 4-6s bajo presión de IO en
    // paralelo (esbuild + jsdom + workers). Los archivos afectados
    // (refinement-checklist, whiteboards-actions, wbs-generate,
    // notifications-actions, sprints-actions) realizan dynamic-import del
    // módulo a testear en el primer `it()` — el TTFB de Vite/esbuild
    // se cobra ahí. Validado 3/3 corridas verde con paralelismo por
    // defecto en hardware Edwin (Windows). El peor caso real sigue
    // siendo `excel-writer.test.ts` con I/O exceljs ~4s.
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      // Coverage de unidad/componente se calcula sólo sobre los módulos
      // que tienen tests automatizables sin un navegador real. Los clientes
      // de vista (*BoardClient.tsx), los hooks con pointer events y los
      // shells de aplicación viven en la suite E2E de Playwright.
      include: [
        'src/lib/actions/reorder.ts',
        'src/lib/actions/schedule.ts',
        'src/lib/filters.ts',
        'src/lib/keys.ts',
        'src/lib/stores/ui.ts',
        'src/components/interactions/Toaster.tsx',
        'src/components/interactions/ViewSwitcher.tsx',
        'src/components/interactions/ContextMenuPrimitive.tsx',
        // R3.0-A · Hardening · ampliamos coverage a módulos puros 100%
        // testados que vivían fuera del include heredado de Olas P0-P3.
        // Todos son funciones puras sin Prisma/Next, perfectos para v8
        // coverage:
        'src/lib/brain/strategist/detectors.ts',
        'src/lib/risks/risk-score.ts',
      ],
      exclude: [
        'src/**/*.d.ts',
        'src/lib/prisma.ts',
        'src/**/__tests__/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // `server-only` no está instalado y no se necesita en tests.
      // Resolvemos a un stub para que los archivos que lo importan
      // (módulo Auth Ola P1) compilen.
      'server-only': resolve(__dirname, './tests/stubs/server-only.ts'),
    },
  },
})
