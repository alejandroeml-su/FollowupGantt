/**
 * HU-4.6 · Config de Vitest separada para tests de performance.
 *
 * Mantiene `vitest.config.ts` intacto (lo usan unit + component tests con
 * el resto del equipo) y permite correr la suite perf bajo demanda:
 *
 *   RUN_PERF=1 npx vitest run --config vitest.perf.config.ts
 *
 * Diferencias clave vs. el config principal:
 *   - environment: 'node' (no necesitamos jsdom; los fixtures se manejan
 *     con fs/exceljs, todo I/O nativo).
 *   - include: sólo `tests/perf/**`.
 *   - sin setup.ts (los tests perf no usan testing-library/cleanup).
 *   - testTimeout más generoso (60s) para márgenes en runs de 5MB.
 */
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/perf/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', 'tests/e2e/**', 'tests/a11y/**'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Sin paralelismo: los tests perf miden tiempo absoluto y la concurrencia
    // entre workers podría contaminar las métricas.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
