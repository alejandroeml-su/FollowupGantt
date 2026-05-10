/**
 * Wave P16-B · Project Onboarding Kit (auto-seeding).
 *
 * Cuando se crea un proyecto con methodology SCRUM o HYBRID, sembramos
 * automáticamente artefactos ágiles base para reducir time-to-value:
 *
 *   - DoR template (Definition of Ready · 5 items default)
 *   - DoD template (Definition of Done · 6 items default)
 *   - Communications Plan (3 audiencias: Sponsor, Equipo, Stakeholders)
 *   - Sprint 0 "Onboarding" (1 semana, status PLANNING)
 *   - 5 tasks template en Sprint 0:
 *     · Kick-off + alineación con Sponsor
 *     · Levantamiento de requerimientos
 *     · Diseño técnico inicial
 *     · Setup del entorno
 *     · Retrospectiva inicial
 *
 * Reglas:
 *   - Sólo aplica al CREAR un proyecto (caller decide cuándo invocar).
 *   - Sólo aplica si methodology ∈ {SCRUM, HYBRID}.
 *   - Idempotente: si el proyecto ya tenía DoR/DoD/CommPlan no los pisa
 *     (preserva contenido pre-existente). Sprint 0 sólo se crea si NO
 *     existe ningún sprint todavía en el proyecto.
 *   - Respeta `Project.dodHardEnforce` (si ya estaba TRUE lo deja, no lo
 *     fuerza a FALSE).
 *   - Audit log: `project.onboarding_kit_seeded` con metadata { count }.
 *
 * Diseño: helper puro que recibe `tx` (Prisma transaction client) opcional
 * para componerse dentro de la transacción de `applyGeneratedWBS`. Si no se
 * pasa `tx`, abre una propia.
 */

import type { Prisma, ProjectMethodology } from '@prisma/client'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'
import {
  DEFAULT_DOR_TEMPLATE,
  DEFAULT_DOD_TEMPLATE,
  normalizeChecklistTemplate,
} from '@/lib/dor-dod/types'
import {
  normalizeCommPlan,
  type CommunicationItem,
  type CommunicationsPlan,
} from '@/lib/communications/types'

// ─────────────────── Templates por defecto ─────────────────────────────

/** Tareas template para Sprint 0 · Onboarding. */
export const DEFAULT_ONBOARDING_TASKS: ReadonlyArray<{
  title: string
  description: string
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  storyPoints: number
}> = [
  {
    title: 'Kick-off + alineación con Sponsor',
    description:
      'Reunión inicial con el Sponsor para confirmar objetivos, alcance, restricciones y criterios de éxito. Acta firmada.',
    priority: 'HIGH',
    storyPoints: 3,
  },
  {
    title: 'Levantamiento de requerimientos',
    description:
      'Entrevistas con stakeholders, recopilación de necesidades funcionales y no-funcionales, registro en backlog inicial.',
    priority: 'HIGH',
    storyPoints: 5,
  },
  {
    title: 'Diseño técnico inicial',
    description:
      'Decisiones de arquitectura, stack, integraciones críticas y diagrama de alto nivel.',
    priority: 'MEDIUM',
    storyPoints: 5,
  },
  {
    title: 'Setup del entorno',
    description:
      'Crear repos, ambientes (dev/staging), credenciales, accesos y CI/CD básico.',
    priority: 'MEDIUM',
    storyPoints: 3,
  },
  {
    title: 'Retrospectiva inicial',
    description:
      'Cerrar Sprint 0 con retro: qué aprendimos del onboarding, qué ajustamos para Sprint 1.',
    priority: 'LOW',
    storyPoints: 1,
  },
] as const

/** Communications Plan default (3 audiencias canónicas). */
export const DEFAULT_COMM_PLAN_ITEMS: ReadonlyArray<Omit<CommunicationItem, 'id'>> = [
  {
    audience: 'Sponsor / Patrocinador',
    frequency: 'BIWEEKLY',
    channel: 'STATUS_REPORT',
    owner: 'Project Manager',
    nextDelivery: null,
    notes:
      'Status report ejecutivo: avance EVM, riesgos, decisiones pendientes y próximos hitos.',
  },
  {
    audience: 'Equipo de proyecto',
    frequency: 'DAILY',
    channel: 'MEETING',
    owner: 'Scrum Master',
    nextDelivery: null,
    notes:
      'Daily Scrum 15 min: ¿qué hice ayer? ¿qué haré hoy? ¿qué impedimentos tengo?',
  },
  {
    audience: 'Stakeholders externos',
    frequency: 'MONTHLY',
    channel: 'EMAIL',
    owner: 'Project Manager',
    nextDelivery: null,
    notes:
      'Resumen mensual con avance por hitos, demos disponibles y riesgos visibles.',
  },
] as const

// ─────────────────── Tipos del resultado ───────────────────────────────

export interface SeededKit {
  dorSeeded: boolean
  dodSeeded: boolean
  commPlanSeeded: boolean
  sprintCreated: boolean
  sprintId: string | null
  tasksCreated: number
}

export interface SeedKitInput {
  projectId: string
  methodology: ProjectMethodology
  /** Quién dispara la creación (para audit + ownership de Sprint/Tasks). */
  actorId?: string | null
  /** Si se pasa, usa esta tx del caller. Si no, abre una propia. */
  tx?: Prisma.TransactionClient
}

// ─────────────────── Helper interno: build comm plan ───────────────────

function buildDefaultCommPlan(): CommunicationsPlan {
  const items: CommunicationItem[] = DEFAULT_COMM_PLAN_ITEMS.map((i) => ({
    ...i,
    id: `c-${Math.random().toString(36).slice(2, 10)}`,
  }))
  return {
    items,
    updatedAt: new Date().toISOString(),
  }
}

// ─────────────────── API pública ───────────────────────────────────────

/**
 * Verdadero si la metodología admite el Onboarding Kit ágil.
 * Soporta también string (`createProject` legacy con FormData lo recibe así).
 */
export function shouldSeedKit(methodology: string | null | undefined): boolean {
  if (!methodology) return false
  return methodology === 'SCRUM' || methodology === 'HYBRID'
}

/**
 * Siembra el Onboarding Kit en un proyecto recién creado.
 *
 * No-op si la metodología es PMI o no se reconoce. Los slots ya
 * configurados (DoR/DoD/CommPlan con contenido previo) se respetan.
 *
 * @returns Resumen de qué se sembró efectivamente.
 */
export async function seedOnboardingKit(
  input: SeedKitInput,
): Promise<SeededKit> {
  if (!input.projectId) {
    throw new Error('[INVALID_INPUT] projectId requerido')
  }
  if (!shouldSeedKit(input.methodology)) {
    return {
      dorSeeded: false,
      dodSeeded: false,
      commPlanSeeded: false,
      sprintCreated: false,
      sprintId: null,
      tasksCreated: 0,
    }
  }

  const runner = input.tx ?? prisma
  const result = await applyKitWithRunner(runner, input)

  // Audit fuera de la tx para no comprometer el commit. Best-effort.
  await recordAuditEventSafe({
    action: 'project.onboarding_kit_seeded',
    entityType: 'project',
    entityId: input.projectId,
    actorId: input.actorId ?? null,
    after: {
      methodology: input.methodology,
      dorSeeded: result.dorSeeded,
      dodSeeded: result.dodSeeded,
      commPlanSeeded: result.commPlanSeeded,
      sprintCreated: result.sprintCreated,
      tasksCreated: result.tasksCreated,
    },
    metadata: { sprintId: result.sprintId },
  })

  return result
}

// ─────────────────── Implementación ────────────────────────────────────

type Runner = Prisma.TransactionClient | typeof prisma

async function applyKitWithRunner(
  runner: Runner,
  input: SeedKitInput,
): Promise<SeededKit> {
  // 1. Cargar estado actual del proyecto (para no pisar contenido).
  const project = await runner.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      dorTemplate: true,
      dodTemplate: true,
      communicationsPlan: true,
    },
  })
  if (!project) {
    throw new Error(`[NOT_FOUND] proyecto ${input.projectId} no existe`)
  }

  let dorSeeded = false
  let dodSeeded = false
  let commPlanSeeded = false
  let sprintCreated = false
  let sprintId: string | null = null
  let tasksCreated = 0

  const projectUpdate: Prisma.ProjectUpdateInput = {}

  // 2. DoR template — sólo si está vacío.
  const existingDor = normalizeChecklistTemplate(project.dorTemplate)
  if (existingDor.length === 0) {
    projectUpdate.dorTemplate = [...DEFAULT_DOR_TEMPLATE] as Prisma.InputJsonValue
    dorSeeded = true
  }

  // 3. DoD template — sólo si está vacío.
  const existingDod = normalizeChecklistTemplate(project.dodTemplate)
  if (existingDod.length === 0) {
    projectUpdate.dodTemplate = [...DEFAULT_DOD_TEMPLATE] as Prisma.InputJsonValue
    dodSeeded = true
  }

  // 4. Communications Plan — sólo si está vacío.
  const existingCommPlan = normalizeCommPlan(project.communicationsPlan)
  if (existingCommPlan.items.length === 0) {
    projectUpdate.communicationsPlan = buildDefaultCommPlan() as unknown as Prisma.InputJsonValue
    commPlanSeeded = true
  }

  if (Object.keys(projectUpdate).length > 0) {
    await runner.project.update({
      where: { id: input.projectId },
      data: projectUpdate,
    })
  }

  // 5. Sprint 0 — sólo si el proyecto NO tiene sprints todavía.
  const existingSprintCount = await runner.sprint.count({
    where: { projectId: input.projectId },
  })

  if (existingSprintCount === 0) {
    const start = new Date()
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)
    const createdSprint = await runner.sprint.create({
      data: {
        name: 'Sprint 0 · Onboarding',
        goal:
          'Kick-off, alineación con Sponsor, levantamiento de requerimientos y setup del entorno.',
        projectId: input.projectId,
        startDate: start,
        endDate: end,
        status: 'PLANNING',
      },
      select: { id: true },
    })
    sprintCreated = true
    sprintId = createdSprint.id

    // 6. Tasks template para Sprint 0 (mnemónicos PROJ-N).
    // Generamos prefijo idéntico al `createTask` clásico (iniciales del
    // nombre del proyecto, sino "TASK"). Lookup ligero ya que Sprint 0
    // se crea sólo para proyectos vírgenes.
    const projectName = await runner.project.findUnique({
      where: { id: input.projectId },
      select: { name: true },
    })
    const prefix =
      projectName?.name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .substring(0, 4)
        .toUpperCase() || 'TASK'

    let position = 0
    for (const t of DEFAULT_ONBOARDING_TASKS) {
      const count = await runner.task.count({
        where: { projectId: input.projectId },
      })
      const mnemonic = `${prefix}-${count + 1}`
      await runner.task.create({
        data: {
          title: t.title,
          description: t.description,
          mnemonic,
          projectId: input.projectId,
          sprintId,
          status: 'TODO',
          type: 'AGILE_STORY',
          priority: t.priority,
          storyPoints: t.storyPoints,
          position: position++,
        },
      })
      tasksCreated++
    }
  }

  return {
    dorSeeded,
    dodSeeded,
    commPlanSeeded,
    sprintCreated,
    sprintId,
    tasksCreated,
  }
}
