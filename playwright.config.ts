import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.PORT ?? 3000)
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/unit/**', '**/component/**', '**/features/**', '**/perf/**'],
  // P3-4 (C3 expansion): subimos el timeout por test a 45s para cubrir specs
  // que combinan seed Prisma + navegación + acciones server (workspaces,
  // audit, leveling). Local dev a 30s causaba flake intermitente cuando la
  // primera build de Next.js ocurría dentro del primer test.
  timeout: 45_000,
  expect: { timeout: 5_000 },
  retries: process.env.CI ? 2 : 0,
  // Sprint 6.5: los specs `dependency-creation` y `dependency-editor` mutan
  // la misma BD (Postgres compartida en local; efímera en CI). Para evitar
  // race conditions entre workers, se serializa la suite con workers=1.
  // En CI los specs se reparten entre browsers (chromium/firefox/webkit) en
  // matrix-job — cada job tiene su propio Postgres efímero, así que workers
  // por job sigue siendo 1 sin perder paralelismo entre browsers.
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  // En CI, el workflow arranca Next.js manualmente (para orquestar el orden
  // con `prisma db push` y `tsx prisma/seed.ts`). Reusamos el server existente
  // y no lo arrancamos desde Playwright.
  webServer: process.env.CI
    ? {
        command: 'npm run start',
        url: BASE_URL,
        timeout: 120_000,
        reuseExistingServer: true,
      }
    : undefined,
})
