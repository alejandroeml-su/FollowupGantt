/**
 * Seed del proyecto base "Sync" (auto-historial de FollowupGantt).
 *
 * Carga en la base de datos un proyecto agile completo que refleja la
 * historia real de desarrollo del propio sistema:
 *   - Gerencia "Tecnología" → Área "Desarrollo de Sistemas"
 *   - Proyecto "Sync · FollowupGantt" (status ACTIVE)
 *   - 5 Releases (R1.0 → R5.0)
 *   - 10 Epics (uno por Wave P0 → post-P10)
 *   - 9 Sprints (uno por wave)
 *   - ~50 tasks de tipo AGILE_STORY con subtasks y bugfixes
 *   - DoR/DoD del proyecto
 *
 * Uso:
 *   DATABASE_URL=postgresql://... tsx prisma/seed-sync-project.ts
 *
 * Idempotente: usa upsert para todas las entidades. Re-ejecutar es seguro.
 *
 * Pre-condiciones:
 *   - Existe al menos un User con id=`SYNC_OWNER_USER_ID` (env) o el primer
 *     User encontrado en BD se usa como owner. Si no hay usuarios, falla.
 *   - Existe (o se crea) un Workspace default.
 */

import {
  PrismaClient,
  Priority,
  TaskStatus,
  TaskType,
  ReleaseScopeMode,
  EpicStatus,
} from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const ID = {
  workspace: 'sync_ws_default',
  gerencia: 'sync_ger_tecnologia',
  area: 'sync_area_dev_sistemas',
  project: 'sync_proj_main',
  releases: {
    r1: 'sync_rel_1_mvp',
    r2: 'sync_rel_2_hardening',
    r3: 'sync_rel_3_ai_enterprise',
    r4: 'sync_rel_4_agile_maturity',
    r5: 'sync_rel_5_portfolio',
  },
  epics: {
    p0: 'sync_epic_p0_foundation',
    p1: 'sync_epic_p1_auth_time',
    p2_5: 'sync_epic_p2_5_multitenant',
    p6: 'sync_epic_p6_realtime',
    p7: 'sync_epic_p7_ai',
    p8: 'sync_epic_p8_enterprise',
    p9: 'sync_epic_p9_agile_maturity',
    p10: 'sync_epic_p10_portfolio',
    post: 'sync_epic_post_p10_ux_brand',
    debt: 'sync_epic_tech_debt',
  },
  sprints: [
    'sync_sprint_p0',
    'sync_sprint_p1',
    'sync_sprint_p2_5',
    'sync_sprint_p6',
    'sync_sprint_p7',
    'sync_sprint_p8',
    'sync_sprint_p9_r1',
    'sync_sprint_p9_r2',
    'sync_sprint_p10',
    'sync_sprint_post_p10',
  ],
}

type TaskSeed = {
  id: string
  title: string
  description?: string
  type?: TaskType
  status: TaskStatus
  priority: Priority
  storyPoints?: number
  startDate?: Date
  endDate?: Date
  progress?: number
  parentId?: string
  epicId?: string
  sprintId?: string
  isMilestone?: boolean
  subtasks?: Omit<TaskSeed, 'subtasks'>[]
}

const D = (s: string) => new Date(`${s}T00:00:00.000Z`)

/** Helper: pluck primer User para owner si no se pasa env. */
async function pickOwnerUser(): Promise<string | null> {
  if (process.env.SYNC_OWNER_USER_ID) return process.env.SYNC_OWNER_USER_ID
  const u = await prisma.user.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } })
  return u?.id ?? null
}

async function main() {
  console.log('🌱 Seed Sync project base · iniciando…')

  const ownerId = await pickOwnerUser()
  if (!ownerId) {
    throw new Error(
      'No hay usuarios en BD. Crea al menos uno antes de correr este seed (auth login o seed.ts).',
    )
  }
  console.log(`   Owner: ${ownerId}`)

  // ── Workspace ─────────────────────────────────────────────────
  const ws = await prisma.workspace.upsert({
    where: { id: ID.workspace },
    update: { name: 'Avante · Default' },
    create: {
      id: ID.workspace,
      name: 'Avante · Default',
      slug: 'avante-default',
      ownerId,
    },
  })
  console.log(`   ✓ Workspace ${ws.name}`)

  // Asegurar membership del owner.
  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: ws.id, userId: ownerId } },
    update: {},
    create: { workspaceId: ws.id, userId: ownerId, role: 'OWNER' },
  })

  // ── Gerencia + Área ───────────────────────────────────────────
  await prisma.gerencia.upsert({
    where: { id: ID.gerencia },
    update: { name: 'Tecnología' },
    create: { id: ID.gerencia, name: 'Tecnología' },
  })
  await prisma.area.upsert({
    where: { id: ID.area },
    update: { name: 'Desarrollo de Sistemas', gerenciaId: ID.gerencia },
    create: {
      id: ID.area,
      name: 'Desarrollo de Sistemas',
      gerenciaId: ID.gerencia,
    },
  })
  console.log('   ✓ Gerencia Tecnología → Área Desarrollo de Sistemas')

  // ── Proyecto ──────────────────────────────────────────────────
  await prisma.project.upsert({
    where: { id: ID.project },
    update: {
      name: 'Sync · FollowupGantt',
      description:
        'Plataforma interna PMI+Agile+ITIL · auto-historial del proyecto desde Wave P0 hasta post-P10. Tipo agile.',
      status: 'ACTIVE',
      areaId: ID.area,
      managerId: ownerId,
      workspaceId: ws.id,
      cpi: 1.05,
      spi: 1.12,
      budget: 5000 as unknown as never, // Decimal
      budgetCurrency: 'USD',
      // DoR/DoD a nivel producto (regla ágil cumplida en PR #132).
      dorTemplate: [
        'Historia con criterios de aceptación claros',
        'Estimación en story points (Fibonacci)',
        'Dependencias técnicas identificadas',
        'Mocks/diseños revisados con UIUX',
        'Tests unitarios contemplados',
      ],
      dodTemplate: [
        'Código mergeado a master vía PR',
        'TypeScript + ESLint en verde',
        'Tests unit cubren caminos felices y edge cases',
        'Server actions con audit trail',
        'WCAG AA respetado en componentes UI',
        'Documentación inline (JSDoc) en exports',
      ],
    },
    create: {
      id: ID.project,
      name: 'Sync · FollowupGantt',
      description:
        'Plataforma interna PMI+Agile+ITIL · auto-historial del proyecto desde Wave P0 hasta post-P10. Tipo agile.',
      status: 'ACTIVE',
      areaId: ID.area,
      managerId: ownerId,
      workspaceId: ws.id,
      cpi: 1.05,
      spi: 1.12,
      budget: 5000 as unknown as never,
      budgetCurrency: 'USD',
      dorTemplate: [
        'Historia con criterios de aceptación claros',
        'Estimación en story points (Fibonacci)',
        'Dependencias técnicas identificadas',
        'Mocks/diseños revisados con UIUX',
        'Tests unitarios contemplados',
      ],
      dodTemplate: [
        'Código mergeado a master vía PR',
        'TypeScript + ESLint en verde',
        'Tests unit cubren caminos felices y edge cases',
        'Server actions con audit trail',
        'WCAG AA respetado en componentes UI',
        'Documentación inline (JSDoc) en exports',
      ],
    },
  })
  console.log('   ✓ Project Sync (status=ACTIVE, agile)')

  // ── Releases ──────────────────────────────────────────────────
  const releases = [
    { id: ID.releases.r1, name: 'R1.0 MVP Core', version: '1.0.0', plannedDate: D('2026-04-30'), releasedDate: D('2026-05-04'), description: 'Schema base, Gantt custom, CPM, autenticación, time tracking.' },
    { id: ID.releases.r2, name: 'R2.0 Hardening & Realtime', version: '2.0.0', plannedDate: D('2026-05-04'), releasedDate: D('2026-05-04'), description: 'RLS, Sentry, E2E, Realtime, Web Push, multi-tenancy.' },
    { id: ID.releases.r3, name: 'R3.0 AI & Enterprise', version: '3.0.0', plannedDate: D('2026-05-05'), releasedDate: D('2026-05-05'), description: 'LLM real, Resource Mgmt, Risk Register, Cost Mgmt, Storage, Calendars.' },
    { id: ID.releases.r4, name: 'R4.0 Agile Maturity', version: '4.0.0', plannedDate: D('2026-05-07'), releasedDate: D('2026-05-07'), description: 'Epics, User Story formal, Backlog, Releases, Sprint Planning, DoR/DoD, Retrospective.' },
    { id: ID.releases.r5, name: 'R5.0 Enterprise Portfolio + Sync', version: '5.0.0', plannedDate: D('2026-05-30'), releasedDate: D('2026-05-08'), description: 'Wave P10 Portfolio + UX overhaul + rebrand a Sync. Entregada 22 días antes del deadline.' },
  ]
  for (const r of releases) {
    await prisma.release.upsert({
      where: { id: r.id },
      update: {
        name: r.name, version: r.version, description: r.description,
        plannedDate: r.plannedDate, releasedDate: r.releasedDate,
        ownerId, projectId: ID.project, scopeMode: 'EPIC' as ReleaseScopeMode,
      },
      create: {
        id: r.id, name: r.name, version: r.version, description: r.description,
        plannedDate: r.plannedDate, releasedDate: r.releasedDate,
        ownerId, projectId: ID.project, scopeMode: 'EPIC' as ReleaseScopeMode,
      },
    })
  }
  console.log(`   ✓ ${releases.length} Releases`)

  // ── Epics (uno por Wave) ──────────────────────────────────────
  const epics = [
    { id: ID.epics.p0, name: 'Wave P0 · Foundation', releaseId: ID.releases.r1, color: '#6366f1', status: 'DONE' as EpicStatus, position: 0 },
    { id: ID.epics.p1, name: 'Wave P1 · Auth & Time Tracking', releaseId: ID.releases.r1, color: '#8b5cf6', status: 'DONE' as EpicStatus, position: 1 },
    { id: ID.epics.p2_5, name: 'Wave P2-P5 · Multi-tenancy & Workspaces', releaseId: ID.releases.r2, color: '#ec4899', status: 'DONE' as EpicStatus, position: 2 },
    { id: ID.epics.p6, name: 'Wave P6 · Realtime & Web Push', releaseId: ID.releases.r2, color: '#06b6d4', status: 'DONE' as EpicStatus, position: 3 },
    { id: ID.epics.p7, name: 'Wave P7 · AI Knowledge Manager', releaseId: ID.releases.r3, color: '#f59e0b', status: 'DONE' as EpicStatus, position: 4 },
    { id: ID.epics.p8, name: 'Wave P8 · Enterprise (Resource/Risk/Cost)', releaseId: ID.releases.r3, color: '#ef4444', status: 'DONE' as EpicStatus, position: 5 },
    { id: ID.epics.p9, name: 'Wave P9 · Agile Maturity (R1 + R2)', releaseId: ID.releases.r4, color: '#10b981', status: 'DONE' as EpicStatus, position: 6 },
    { id: ID.epics.p10, name: 'Wave P10 · Enterprise Portfolio', releaseId: ID.releases.r5, color: '#22b9e8', status: 'DONE' as EpicStatus, position: 7 },
    { id: ID.epics.post, name: 'Post-P10 · UX overhaul + Rebrand a Sync', releaseId: ID.releases.r5, color: '#67d6f8', status: 'DONE' as EpicStatus, position: 8 },
    { id: ID.epics.debt, name: 'Tech Debt continuo', releaseId: null, color: '#64748b', status: 'IN_PROGRESS' as EpicStatus, position: 9 },
  ]
  for (const e of epics) {
    await prisma.epic.upsert({
      where: { id: e.id },
      update: { name: e.name, color: e.color, status: e.status, projectId: ID.project, position: e.position, ownerId },
      create: { id: e.id, name: e.name, color: e.color, status: e.status, projectId: ID.project, position: e.position, ownerId },
    })
    if (e.releaseId) {
      await prisma.releaseEpic.upsert({
        where: { releaseId_epicId: { releaseId: e.releaseId, epicId: e.id } },
        update: { position: e.position },
        create: { releaseId: e.releaseId, epicId: e.id, position: e.position },
      })
    }
  }
  console.log(`   ✓ ${epics.length} Epics asociadas a sus Releases`)

  // ── Sprints ───────────────────────────────────────────────────
  const sprints = [
    { id: 'sync_sprint_p0', name: 'Sprint P0 · Foundation', goal: 'Schema base + Gantt custom funcional', startDate: D('2026-04-29'), endDate: D('2026-04-30'), capacity: 25 },
    { id: 'sync_sprint_p1', name: 'Sprint P1 · Auth & Time Tracking', goal: 'Login OAuth + 2FA + timer manual + costo rollup', startDate: D('2026-05-01'), endDate: D('2026-05-02'), capacity: 30 },
    { id: 'sync_sprint_p2_5', name: 'Sprint P2-P5 · Multi-tenancy', goal: 'Workspaces + roles + audit log', startDate: D('2026-05-03'), endDate: D('2026-05-04'), capacity: 35 },
    { id: 'sync_sprint_p6', name: 'Sprint P6 · Realtime', goal: 'Supabase Realtime + Web Push + presence', startDate: D('2026-05-04'), endDate: D('2026-05-04'), capacity: 20 },
    { id: 'sync_sprint_p7', name: 'Sprint P7 · AI Knowledge Manager', goal: 'LLM real (Claude+OpenAI) + Insights', startDate: D('2026-05-05'), endDate: D('2026-05-05'), capacity: 18 },
    { id: 'sync_sprint_p8', name: 'Sprint P8 · Enterprise', goal: 'Resource skills + Risk Monte Carlo + Cost EVM', startDate: D('2026-05-05'), endDate: D('2026-05-06'), capacity: 30 },
    { id: 'sync_sprint_p9_r1', name: 'Sprint P9 R1 · Agile Foundation', goal: 'Epics + User Story formal + Backlog + Releases', startDate: D('2026-05-07'), endDate: D('2026-05-07'), capacity: 28 },
    { id: 'sync_sprint_p9_r2', name: 'Sprint P9 R2 · Agile Process', goal: 'Sprint Planning + DoR/DoD + Retrospective', startDate: D('2026-05-07'), endDate: D('2026-05-07'), capacity: 14 },
    { id: 'sync_sprint_p10', name: 'Sprint P10 · Enterprise Portfolio', goal: 'Portfolio Dashboard + Risks + EVM + Allocation', startDate: D('2026-05-07'), endDate: D('2026-05-07'), capacity: 49 },
    { id: 'sync_sprint_post_p10', name: 'Sprint Post-P10 · UX & Rebrand', goal: 'Sprint CRUD UI + Sync rebrand + Timeline + grid jerárquico', startDate: D('2026-05-08'), endDate: D('2026-05-08'), capacity: 32 },
  ]
  for (const s of sprints) {
    await prisma.sprint.upsert({
      where: { id: s.id },
      update: { name: s.name, goal: s.goal, startDate: s.startDate, endDate: s.endDate, capacity: s.capacity, projectId: ID.project, status: 'COMPLETED', endedAt: s.endDate, velocityActual: s.capacity },
      create: { id: s.id, name: s.name, goal: s.goal, startDate: s.startDate, endDate: s.endDate, capacity: s.capacity, projectId: ID.project, status: 'COMPLETED', endedAt: s.endDate, velocityActual: s.capacity },
    })
  }
  console.log(`   ✓ ${sprints.length} Sprints (todos COMPLETED)`)

  // ── Tasks (HUs principales por wave) ──────────────────────────
  const tasks: TaskSeed[] = [
    // Wave P0
    { id: 'sync_t_p0_gantt', title: 'HU-P0.1 Gantt custom (no librería)', type: 'AGILE_STORY', status: 'DONE', priority: 'CRITICAL', storyPoints: 13, startDate: D('2026-04-29'), endDate: D('2026-04-30'), progress: 100, epicId: ID.epics.p0, sprintId: 'sync_sprint_p0',
      subtasks: [
        { id: 'sync_t_p0_gantt_s1', title: 'Diseño layout SVG/canvas', status: 'DONE', priority: 'HIGH', storyPoints: 5, progress: 100 },
        { id: 'sync_t_p0_gantt_s2', title: 'CPM forward/backward pass', status: 'DONE', priority: 'HIGH', storyPoints: 5, progress: 100 },
        { id: 'sync_t_p0_gantt_s3', title: 'Tests unit ciclos + warnings', status: 'DONE', priority: 'MEDIUM', storyPoints: 3, progress: 100 },
      ],
    },
    { id: 'sync_t_p0_baseline', title: 'HU-P0.2 Baseline overlay zustand', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 5, startDate: D('2026-04-29'), endDate: D('2026-04-30'), progress: 100, epicId: ID.epics.p0, sprintId: 'sync_sprint_p0' },
    { id: 'sync_t_p0_xml', title: 'HU-P0.3 fast-xml-parser + exceljs', type: 'AGILE_STORY', status: 'DONE', priority: 'MEDIUM', storyPoints: 5, startDate: D('2026-04-29'), endDate: D('2026-04-30'), progress: 100, epicId: ID.epics.p0, sprintId: 'sync_sprint_p0' },

    // Wave P1
    { id: 'sync_t_p1_oauth', title: 'HU-P1.1 OAuth + sesiones cookie firmada', type: 'AGILE_STORY', status: 'DONE', priority: 'CRITICAL', storyPoints: 8, startDate: D('2026-05-01'), endDate: D('2026-05-01'), progress: 100, epicId: ID.epics.p1, sprintId: 'sync_sprint_p1' },
    { id: 'sync_t_p1_2fa', title: 'HU-P1.2 2FA TOTP (RFC 6238)', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 5, startDate: D('2026-05-01'), endDate: D('2026-05-02'), progress: 100, epicId: ID.epics.p1, sprintId: 'sync_sprint_p1' },
    { id: 'sync_t_p1_time', title: 'HU-P1.3 Time tracking timer + manual', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 8, startDate: D('2026-05-01'), endDate: D('2026-05-02'), progress: 100, epicId: ID.epics.p1, sprintId: 'sync_sprint_p1' },
    { id: 'sync_t_p1_custom', title: 'HU-P1.4 Custom fields configurables', type: 'AGILE_STORY', status: 'DONE', priority: 'MEDIUM', storyPoints: 5, startDate: D('2026-05-02'), endDate: D('2026-05-02'), progress: 100, epicId: ID.epics.p1, sprintId: 'sync_sprint_p1' },

    // Wave P2-P5
    { id: 'sync_t_p2_ws', title: 'HU-P4.1 Multi-tenancy Workspaces', type: 'AGILE_STORY', status: 'DONE', priority: 'CRITICAL', storyPoints: 13, startDate: D('2026-05-03'), endDate: D('2026-05-04'), progress: 100, epicId: ID.epics.p2_5, sprintId: 'sync_sprint_p2_5' },
    { id: 'sync_t_p3_audit', title: 'HU-P3.2 Audit Log centralizado (ITIL/SOC2)', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 8, startDate: D('2026-05-03'), endDate: D('2026-05-04'), progress: 100, epicId: ID.epics.p2_5, sprintId: 'sync_sprint_p2_5' },
    { id: 'sync_t_p2_goals', title: 'HU-P2.4 Goals & OKRs', type: 'AGILE_STORY', status: 'DONE', priority: 'MEDIUM', storyPoints: 5, startDate: D('2026-05-04'), endDate: D('2026-05-04'), progress: 100, epicId: ID.epics.p2_5, sprintId: 'sync_sprint_p2_5' },
    { id: 'sync_t_p4_api', title: 'HU-P4.2 API REST pública + Webhooks', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 8, startDate: D('2026-05-04'), endDate: D('2026-05-04'), progress: 100, epicId: ID.epics.p2_5, sprintId: 'sync_sprint_p2_5' },

    // Wave P6
    { id: 'sync_t_p6_realtime', title: 'HU-P6.1 Supabase Realtime + presence', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 8, startDate: D('2026-05-04'), endDate: D('2026-05-04'), progress: 100, epicId: ID.epics.p6, sprintId: 'sync_sprint_p6' },
    { id: 'sync_t_p6_push', title: 'HU-P6.2 Web Push API + VAPID', type: 'AGILE_STORY', status: 'DONE', priority: 'MEDIUM', storyPoints: 5, startDate: D('2026-05-04'), endDate: D('2026-05-04'), progress: 100, epicId: ID.epics.p6, sprintId: 'sync_sprint_p6' },
    { id: 'sync_t_p6_rls', title: 'HU-P6.3 RLS hardening Supabase', type: 'AGILE_STORY', status: 'DONE', priority: 'CRITICAL', storyPoints: 5, startDate: D('2026-05-04'), endDate: D('2026-05-04'), progress: 100, epicId: ID.epics.p6, sprintId: 'sync_sprint_p6' },

    // Wave P7
    { id: 'sync_t_p7_llm', title: 'HU-P7.1 LLM real (Claude + OpenAI fallback)', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 8, startDate: D('2026-05-05'), endDate: D('2026-05-05'), progress: 100, epicId: ID.epics.p7, sprintId: 'sync_sprint_p7' },
    { id: 'sync_t_p7_insights', title: 'HU-P7.2 Insights heurísticos (categorización + risk)', type: 'AGILE_STORY', status: 'DONE', priority: 'MEDIUM', storyPoints: 5, startDate: D('2026-05-05'), endDate: D('2026-05-05'), progress: 100, epicId: ID.epics.p7, sprintId: 'sync_sprint_p7' },
    { id: 'sync_t_p7_standup', title: 'HU-P7.4 Daily Standup IA + Slack', type: 'AGILE_STORY', status: 'DONE', priority: 'MEDIUM', storyPoints: 5, startDate: D('2026-05-05'), endDate: D('2026-05-05'), progress: 100, epicId: ID.epics.p7, sprintId: 'sync_sprint_p7' },

    // Wave P8
    { id: 'sync_t_p8_resource', title: 'HU-P8.1 Resource Management (Skills)', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 8, startDate: D('2026-05-05'), endDate: D('2026-05-05'), progress: 100, epicId: ID.epics.p8, sprintId: 'sync_sprint_p8' },
    { id: 'sync_t_p8_risk', title: 'HU-P8.2 Risk Register + Monte Carlo', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 8, startDate: D('2026-05-05'), endDate: D('2026-05-06'), progress: 100, epicId: ID.epics.p8, sprintId: 'sync_sprint_p8' },
    { id: 'sync_t_p8_cost', title: 'HU-P8.3 Cost Management + Expenses + EVM', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 8, startDate: D('2026-05-06'), endDate: D('2026-05-06'), progress: 100, epicId: ID.epics.p8, sprintId: 'sync_sprint_p8' },

    // Wave P9 R1
    { id: 'sync_t_p9_epics', title: 'HU-9.1 Epic management', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 5, startDate: D('2026-05-07'), endDate: D('2026-05-07'), progress: 100, epicId: ID.epics.p9, sprintId: 'sync_sprint_p9_r1' },
    { id: 'sync_t_p9_userstory', title: 'HU-9.3 User Story formal con CAs', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 5, startDate: D('2026-05-07'), endDate: D('2026-05-07'), progress: 100, epicId: ID.epics.p9, sprintId: 'sync_sprint_p9_r1' },
    { id: 'sync_t_p9_backlog', title: 'HU-9.6 Backlog priorizable + bulk assign', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 5, startDate: D('2026-05-07'), endDate: D('2026-05-07'), progress: 100, epicId: ID.epics.p9, sprintId: 'sync_sprint_p9_r1' },
    { id: 'sync_t_p9_releases', title: 'HU-9.4 + 9.5 Releases + Roadmap', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 8, startDate: D('2026-05-07'), endDate: D('2026-05-07'), progress: 100, epicId: ID.epics.p9, sprintId: 'sync_sprint_p9_r1' },

    // Wave P9 R2
    { id: 'sync_t_p9_planning', title: 'HU-9.7 Sprint Planning UI con capacity', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 5, startDate: D('2026-05-07'), endDate: D('2026-05-07'), progress: 100, epicId: ID.epics.p9, sprintId: 'sync_sprint_p9_r2' },
    { id: 'sync_t_p9_dor_dod', title: 'HU-9.8 DoR/DoD por proyecto', type: 'AGILE_STORY', status: 'DONE', priority: 'MEDIUM', storyPoints: 3, startDate: D('2026-05-07'), endDate: D('2026-05-07'), progress: 100, epicId: ID.epics.p9, sprintId: 'sync_sprint_p9_r2' },
    { id: 'sync_t_p9_retro', title: 'HU-9.9 Sprint Retrospective module', type: 'AGILE_STORY', status: 'DONE', priority: 'MEDIUM', storyPoints: 5, startDate: D('2026-05-07'), endDate: D('2026-05-07'), progress: 100, epicId: ID.epics.p9, sprintId: 'sync_sprint_p9_r2' },

    // Wave P10
    { id: 'sync_t_p10_dashboard', title: 'HU-10.1 Portfolio Dashboard ejecutivo', type: 'AGILE_STORY', status: 'DONE', priority: 'CRITICAL', storyPoints: 13, startDate: D('2026-05-07'), endDate: D('2026-05-07'), progress: 100, epicId: ID.epics.p10, sprintId: 'sync_sprint_p10' },
    { id: 'sync_t_p10_calendars', title: 'HU-10.2 Calendarios laborales + UserAvailability', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 5, startDate: D('2026-05-07'), endDate: D('2026-05-07'), progress: 100, epicId: ID.epics.p10, sprintId: 'sync_sprint_p10' },
    { id: 'sync_t_p10_velocity', title: 'HU-10.3 Velocity + Monte Carlo forecasting', type: 'AGILE_STORY', status: 'DONE', priority: 'MEDIUM', storyPoints: 5, startDate: D('2026-05-07'), endDate: D('2026-05-07'), progress: 100, epicId: ID.epics.p10, sprintId: 'sync_sprint_p10' },
    { id: 'sync_t_p10_crossdeps', title: 'HU-10.4 Cross-project dependencies', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 8, startDate: D('2026-05-07'), endDate: D('2026-05-07'), progress: 100, epicId: ID.epics.p10, sprintId: 'sync_sprint_p10' },
    { id: 'sync_t_p10_risks', title: 'HU-10.5 Riesgos consolidados portfolio', type: 'AGILE_STORY', status: 'DONE', priority: 'MEDIUM', storyPoints: 5, startDate: D('2026-05-07'), endDate: D('2026-05-07'), progress: 100, epicId: ID.epics.p10, sprintId: 'sync_sprint_p10' },
    { id: 'sync_t_p10_evm', title: 'HU-10.6 EVM consolidado + Excel export', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 8, startDate: D('2026-05-07'), endDate: D('2026-05-07'), progress: 100, epicId: ID.epics.p10, sprintId: 'sync_sprint_p10' },
    { id: 'sync_t_p10_allocation', title: 'HU-10.7 Allocation cross-project heatmap', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 8, startDate: D('2026-05-07'), endDate: D('2026-05-07'), progress: 100, epicId: ID.epics.p10, sprintId: 'sync_sprint_p10' },

    // Post-P10 (UX overhaul + rebrand)
    { id: 'sync_t_post_sprintui', title: 'Sprint CRUD UI + Sprint Backlog tabs', type: 'AGILE_STORY', status: 'DONE', priority: 'CRITICAL', storyPoints: 5, startDate: D('2026-05-08'), endDate: D('2026-05-08'), progress: 100, epicId: ID.epics.post, sprintId: 'sync_sprint_post_p10' },
    { id: 'sync_t_post_agile_nav', title: 'Grupo Agile en Sidebar + clusters ProjectDetail', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 3, startDate: D('2026-05-08'), endDate: D('2026-05-08'), progress: 100, epicId: ID.epics.post, sprintId: 'sync_sprint_post_p10' },
    { id: 'sync_t_post_agile_rules', title: 'Cumplimiento definición Estructura y Trazabilidad Ágil', type: 'AGILE_STORY', status: 'DONE', priority: 'CRITICAL', storyPoints: 5, startDate: D('2026-05-08'), endDate: D('2026-05-08'), progress: 100, epicId: ID.epics.post, sprintId: 'sync_sprint_post_p10' },
    { id: 'sync_t_post_treegrid', title: 'Grid jerárquico Backlog Epic→Story→Task→Subtask', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 5, startDate: D('2026-05-08'), endDate: D('2026-05-08'), progress: 100, epicId: ID.epics.post, sprintId: 'sync_sprint_post_p10' },
    { id: 'sync_t_post_rebrand', title: 'Rebrand a "Sync" + icono cloud-engranaje', type: 'AGILE_STORY', status: 'DONE', priority: 'MEDIUM', storyPoints: 3, startDate: D('2026-05-08'), endDate: D('2026-05-08'), progress: 100, epicId: ID.epics.post, sprintId: 'sync_sprint_post_p10' },
    { id: 'sync_t_post_inline', title: 'Editores inline /list + cascade selection', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 5, startDate: D('2026-05-08'), endDate: D('2026-05-08'), progress: 100, epicId: ID.epics.post, sprintId: 'sync_sprint_post_p10' },
    { id: 'sync_t_post_timeline', title: 'US-4.2 Timeline View con zoom y agrupación', type: 'AGILE_STORY', status: 'DONE', priority: 'HIGH', storyPoints: 5, startDate: D('2026-05-08'), endDate: D('2026-05-08'), progress: 100, epicId: ID.epics.post, sprintId: 'sync_sprint_post_p10' },

    // Bugfixes documentados
    { id: 'sync_t_fix_sw_v2', title: 'fix: Service Worker servía chunks Next stale (PR #105)', type: 'ITIL_TICKET', status: 'DONE', priority: 'HIGH', storyPoints: 2, startDate: D('2026-05-06'), endDate: D('2026-05-06'), progress: 100, epicId: ID.epics.debt },
    { id: 'sync_t_fix_drawer', title: 'fix: drawer no abría niveles 3+ (DFS recursivo PR #110)', type: 'ITIL_TICKET', status: 'DONE', priority: 'HIGH', storyPoints: 2, startDate: D('2026-05-06'), endDate: D('2026-05-06'), progress: 100, epicId: ID.epics.debt },
    { id: 'sync_t_fix_mentions', title: 'fix: mentions @firstName lookup laxo (PR #112)', type: 'ITIL_TICKET', status: 'DONE', priority: 'MEDIUM', storyPoints: 1, startDate: D('2026-05-06'), endDate: D('2026-05-06'), progress: 100, epicId: ID.epics.debt },
    { id: 'sync_t_fix_dark', title: 'fix: dark mode legibilidad (refined palette PR #114)', type: 'ITIL_TICKET', status: 'DONE', priority: 'MEDIUM', storyPoints: 2, startDate: D('2026-05-06'), endDate: D('2026-05-06'), progress: 100, epicId: ID.epics.debt },
    { id: 'sync_t_fix_p126_revert', title: 'fix: rescate seguro de PR #136 que habría revertido 9 PRs', type: 'ITIL_TICKET', status: 'DONE', priority: 'CRITICAL', storyPoints: 1, startDate: D('2026-05-08'), endDate: D('2026-05-08'), progress: 100, epicId: ID.epics.debt },
    { id: 'sync_t_fix_subtask_click', title: 'fix: click en nombre de subtarea abre su drawer (PR #141)', type: 'ITIL_TICKET', status: 'DONE', priority: 'MEDIUM', storyPoints: 1, startDate: D('2026-05-08'), endDate: D('2026-05-08'), progress: 100, epicId: ID.epics.debt },
    { id: 'sync_t_fix_portfolio_link', title: 'fix: "Ver portafolio →" apunta a /portfolio (PR #140)', type: 'ITIL_TICKET', status: 'DONE', priority: 'MEDIUM', storyPoints: 1, startDate: D('2026-05-08'), endDate: D('2026-05-08'), progress: 100, epicId: ID.epics.debt },

    // Hito de release
    { id: 'sync_milestone_v5', title: '🎯 v5.0 · Sync rebrand + Wave P10 entregada', type: 'PMI_TASK', status: 'DONE', priority: 'CRITICAL', startDate: D('2026-05-08'), endDate: D('2026-05-08'), isMilestone: true, progress: 100, epicId: ID.epics.post, sprintId: 'sync_sprint_post_p10' },
  ]

  // Carga raíces.
  let position = 0
  for (const t of tasks) {
    await prisma.task.upsert({
      where: { id: t.id },
      update: {
        title: t.title,
        description: t.description,
        type: t.type ?? 'AGILE_STORY',
        status: t.status,
        priority: t.priority,
        storyPoints: t.storyPoints,
        startDate: t.startDate,
        endDate: t.endDate,
        progress: t.progress ?? 0,
        isMilestone: t.isMilestone ?? false,
        projectId: ID.project,
        epicId: t.epicId,
        sprintId: t.sprintId,
        assigneeId: ownerId,
        position: position++,
      },
      create: {
        id: t.id,
        title: t.title,
        description: t.description,
        type: t.type ?? 'AGILE_STORY',
        status: t.status,
        priority: t.priority,
        storyPoints: t.storyPoints,
        startDate: t.startDate,
        endDate: t.endDate,
        progress: t.progress ?? 0,
        isMilestone: t.isMilestone ?? false,
        projectId: ID.project,
        epicId: t.epicId,
        sprintId: t.sprintId,
        assigneeId: ownerId,
        position: position++,
      },
    })
    // Subtasks anidadas (un nivel).
    if (t.subtasks) {
      let subPos = 0
      for (const sub of t.subtasks) {
        await prisma.task.upsert({
          where: { id: sub.id },
          update: {
            title: sub.title,
            type: 'AGILE_STORY',
            status: sub.status,
            priority: sub.priority,
            storyPoints: sub.storyPoints,
            progress: sub.progress ?? 0,
            projectId: ID.project,
            parentId: t.id,
            assigneeId: ownerId,
            position: subPos++,
            startDate: sub.startDate ?? t.startDate,
            endDate: sub.endDate ?? t.endDate,
          },
          create: {
            id: sub.id,
            title: sub.title,
            type: 'AGILE_STORY',
            status: sub.status,
            priority: sub.priority,
            storyPoints: sub.storyPoints,
            progress: sub.progress ?? 0,
            projectId: ID.project,
            parentId: t.id,
            assigneeId: ownerId,
            position: subPos++,
            startDate: sub.startDate ?? t.startDate,
            endDate: sub.endDate ?? t.endDate,
          },
        })
      }
    }
  }
  console.log(`   ✓ ${tasks.length} tasks raíz + subtasks`)

  console.log('')
  console.log('🎉 Seed completado.')
  console.log('')
  console.log('Para verificar: abrir Sync → /portfolio o /projects → Proyecto "Sync · FollowupGantt"')
}

main()
  .catch((e) => {
    console.error('❌ Seed falló:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
