require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding Supabase Database...');

  // ============================================
  // GERENCIAS ORGANIZACIONALES
  // ============================================
  const gerenciasData = [
    { name: 'OPERACIONES', description: 'Gerencia de Operaciones y procesos productivos' },
    { name: 'FINANZAS', description: 'Gerencia de Finanzas, contabilidad y tesorería' },
    { name: 'MERCADEO', description: 'Gerencia de Mercadeo y desarrollo de mercado' },
    { name: 'MARKETING', description: 'Gerencia de Marketing, publicidad y comunicaciones' },
    { name: 'LEGAL', description: 'Gerencia Legal, cumplimiento normativo y regulatorio' },
    { name: 'RECURSOS HUMANOS', description: 'Gerencia de Recursos Humanos, talento y cultura organizacional' },
    { name: 'TECNOLOGIA', description: 'Gerencia de Tecnología de la Información y transformación digital' },
    { name: 'MEDICA', description: 'Gerencia Médica, dirección clínica y operaciones de salud' },
  ];

  console.log('Creating Gerencias...');
  for (const g of gerenciasData) {
    await prisma.gerencia.upsert({
      where: { name: g.name },
      update: { description: g.description },
      create: g,
    });
  }
  console.log(`✓ ${gerenciasData.length} Gerencias created/updated`);

  // ============================================
  // USUARIO DE PRUEBA
  // ============================================
  const user = await prisma.user.upsert({
    where: { email: 'edwin@inversionesavante.com' },
    update: {},
    create: {
      name: 'Edwin Martinez',
      email: 'edwin@inversionesavante.com',
      role: 'PROJECT_MANAGER',
    },
  });
  console.log('✓ User created/updated');

  // ============================================
  // GERENCIA TECNOLOGIA → Área → Proyecto
  // ============================================
  const gerenciaTech = await prisma.gerencia.findUnique({ where: { name: 'TECNOLOGIA' } });

  if (gerenciaTech) {
    // Crear un área de ejemplo bajo Tecnología
    const areaTI = await prisma.area.upsert({
      where: { id: 'seed-area-infra' },
      update: {},
      create: {
        id: 'seed-area-infra',
        name: 'Infraestructura Cloud',
        description: 'Infraestructura, redes y servicios cloud',
        gerenciaId: gerenciaTech.id,
      },
    });

    // Crear Proyecto asociado al Área
    const project = await prisma.project.upsert({
      where: { id: 'seed-project-cloud' },
      update: {},
      create: {
        id: 'seed-project-cloud',
        name: 'Infraestructura Cloud Avante',
        description: 'Migración a AWS y estabilización',
        status: 'ACTIVE',
        managerId: user.id,
        areaId: areaTI.id,
      },
    });

    // Crear Tarea principal
    const task1 = await prisma.task.upsert({
      where: { id: 'seed-task-vpc' },
      update: {},
      create: {
        id: 'seed-task-vpc',
        title: 'Configuración VPC y Subnets',
        status: 'DONE',
        priority: 'CRITICAL',
        type: 'AGILE_STORY',
        projectId: project.id,
        assigneeId: user.id,
        endDate: new Date('2026-04-25'),
      },
    });

    // Crear Subtarea
    await prisma.task.upsert({
      where: { id: 'seed-task-sg' },
      update: {},
      create: {
        id: 'seed-task-sg',
        title: 'Validación de Security Groups',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        type: 'PMI_TASK',
        projectId: project.id,
        parentId: task1.id,
        assigneeId: user.id,
        endDate: new Date('2026-04-26'),
      },
    });

    console.log('✓ Proyecto + Tareas de ejemplo creados bajo TECNOLOGIA > Infraestructura Cloud');
  }

  console.log('\n🎉 Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
