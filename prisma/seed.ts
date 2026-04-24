/**
 * EPIC-001 · @DBA · Seed determinista para entornos de TEST.
 *
 * Uso:
 *   DATABASE_URL=postgresql://... tsx prisma/seed.ts
 *
 * A diferencia de `seed.js` (producción/demo), este seed usa IDs y fechas
 * FIJOS para que los tests E2E y unit puedan referenciarlos sin flakiness.
 * Todas las entidades llevan el prefijo `test_` en sus IDs.
 */
import { PrismaClient, Priority, TaskStatus, TaskType } from '@prisma/client'

const prisma = new PrismaClient()

const FIXED = {
  userId: 'test_user_alpha',
  gerenciaId: 'test_ger_ops',
  areaId: 'test_area_devops',
  projectId: 'test_proj_alpha',
  tasks: [
    {
      id: 'test_task_t1',
      title: 'Diseñar wireframes navegación',
      status: 'TODO',
      priority: 'HIGH',
      type: 'AGILE_STORY',
      startDate: new Date('2026-05-01T00:00:00Z'),
      endDate: new Date('2026-05-05T00:00:00Z'),
      position: 1,
    },
    {
      id: 'test_task_t2',
      title: 'Validar con stakeholders',
      status: 'TODO',
      priority: 'MEDIUM',
      type: 'PMI_TASK',
      startDate: new Date('2026-05-06T00:00:00Z'),
      endDate: new Date('2026-05-08T00:00:00Z'),
      position: 2,
    },
    {
      id: 'test_task_t3',
      title: 'Implementar drag & drop',
      status: 'IN_PROGRESS',
      priority: 'CRITICAL',
      type: 'AGILE_STORY',
      startDate: new Date('2026-05-10T00:00:00Z'),
      endDate: new Date('2026-05-15T00:00:00Z'),
      position: 3,
    },
    {
      id: 'test_task_t4',
      title: 'Menú contextual (hito)',
      status: 'REVIEW',
      priority: 'LOW',
      type: 'ITIL_TICKET',
      startDate: new Date('2026-05-16T00:00:00Z'),
      endDate: new Date('2026-05-16T00:00:00Z'),
      position: 4,
      isMilestone: true,
    },
    {
      id: 'test_task_t5',
      title: 'Pruebas de aceptación',
      status: 'DONE',
      priority: 'MEDIUM',
      type: 'AGILE_STORY',
      startDate: new Date('2026-05-18T00:00:00Z'),
      endDate: new Date('2026-05-22T00:00:00Z'),
      position: 5,
    },
  ] as const,
}

async function main() {
  console.log('[seed-test] iniciando seed determinista...')

  const user = await prisma.user.upsert({
    where: { id: FIXED.userId },
    update: {},
    create: {
      id: FIXED.userId,
      name: 'Alpha Tester',
      email: 'alpha.tester@avante.test',
      role: 'PROJECT_MANAGER',
    },
  })

  const gerencia = await prisma.gerencia.upsert({
    where: { id: FIXED.gerenciaId },
    update: {},
    create: {
      id: FIXED.gerenciaId,
      name: 'OPERACIONES_TEST',
      description: 'Gerencia fija para entornos de prueba',
    },
  })

  const area = await prisma.area.upsert({
    where: { id: FIXED.areaId },
    update: {},
    create: {
      id: FIXED.areaId,
      name: 'DevOps',
      description: 'Área fija para tests',
      gerenciaId: gerencia.id,
    },
  })

  const project = await prisma.project.upsert({
    where: { id: FIXED.projectId },
    update: {},
    create: {
      id: FIXED.projectId,
      name: 'Proyecto Alpha (TEST)',
      description: 'Proyecto fijo para E2E',
      status: 'ACTIVE',
      areaId: area.id,
      managerId: user.id,
    },
  })

  // Tareas idempotentes
  for (const t of FIXED.tasks) {
    await prisma.task.upsert({
      where: { id: t.id },
      update: {},
      create: {
        id: t.id,
        title: t.title,
        status: t.status as TaskStatus,
        priority: t.priority as Priority,
        type: t.type as TaskType,
        startDate: t.startDate,
        endDate: t.endDate,
        position: t.position,
        isMilestone: (t as { isMilestone?: boolean }).isMilestone ?? false,
        projectId: project.id,
        assigneeId: user.id,
      },
    })
  }

  // Dependencia FS: t1 → t2
  const existing = await prisma.taskDependency.findUnique({
    where: {
      predecessorId_successorId: {
        predecessorId: 'test_task_t1',
        successorId: 'test_task_t2',
      },
    },
  })
  if (!existing) {
    await prisma.taskDependency.create({
      data: {
        predecessorId: 'test_task_t1',
        successorId: 'test_task_t2',
        type: 'FINISH_TO_START',
      },
    })
  }

  console.log('[seed-test] completado con éxito.')
  console.log(
    `  user=${user.id}\n  gerencia=${gerencia.id}\n  area=${area.id}\n  project=${project.id}\n  tasks=${FIXED.tasks.length}`,
  )
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('[seed-test] ERROR', err)
    await prisma.$disconnect()
    process.exit(1)
  })
