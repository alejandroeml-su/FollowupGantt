import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/component/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'tests/a11y/**', 'tests/perf/**', 'node_modules/**'],
    // P3-5D · Bajado de 15s → 5s tras refactor de
    // `dependencies-update.test.ts` (eliminados `mockResolvedValueOnce`
    // encadenados, lift de `import` a `beforeAll`, mocks granulares por
    // collaborator). Validado 10/10 corridas verde con paralelismo
    // por defecto. 5s sigue siendo margen amplio: el peor caso real es
    // `excel-writer.test.ts` con I/O exceljs ~4s.
    testTimeout: 5_000,
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
