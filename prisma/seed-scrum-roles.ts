/**
 * Wave P11-Scrum (HU-11.3) — Seed idempotente de roles Scrum.
 *
 * Inserta SCRUM_PRODUCT_OWNER, SCRUM_MASTER, SCRUM_DEVELOPER en la tabla
 * Role si no existen. Los roles existentes (SUPER_ADMIN/ADMIN/AGENTE)
 * no se tocan.
 *
 * Uso:
 *   DATABASE_URL=postgresql://... tsx prisma/seed-scrum-roles.ts
 *
 * Idempotente: corre cuantas veces quieras.
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { SCRUM_ROLE_DEFINITIONS } from '../src/lib/rbac/scrum-roles'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('🌱 Seed Scrum roles · iniciando…')
  for (const def of SCRUM_ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: { name: def.name },
      update: { description: def.description },
      create: { name: def.name, description: def.description },
    })
    console.log(`   ✓ ${def.label} (${role.name})`)
  }
  console.log('🎉 Seed Scrum roles completado.')
}

main()
  .catch((e) => {
    console.error('❌ Seed falló:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
