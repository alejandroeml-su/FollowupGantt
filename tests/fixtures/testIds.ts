// EPIC-001 · Fixtures compartidos con prisma/seed.ts (seed determinista).
// Importar desde Playwright specs para evitar strings mágicos.

export const TEST_IDS = {
  user: 'test_user_alpha',
  gerencia: 'test_ger_ops',
  area: 'test_area_devops',
  project: 'test_proj_alpha',
  tasks: {
    t1: 'test_task_t1', // TODO · HIGH · 2026-05-01→05
    t2: 'test_task_t2', // TODO · MEDIUM · 2026-05-06→08 · FS-sucesora de t1
    t3: 'test_task_t3', // IN_PROGRESS · CRITICAL · 2026-05-10→15
    t4: 'test_task_t4', // REVIEW · LOW · MILESTONE 2026-05-16
    t5: 'test_task_t5', // DONE · MEDIUM · 2026-05-18→22
  },
  dates: {
    seedMonth: '2026-05',
  },
} as const
