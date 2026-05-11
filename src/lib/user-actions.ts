'use server'

import prisma from '@/lib/prisma'

export async function getAllRoles() {
  return prisma.role.findMany({ orderBy: { name: 'asc' } })
}

export async function getAllUsersWithRoles() {
  return prisma.user.findMany({
    include: {
      roles: { include: { role: true } },
      teams: { include: { team: true } }
    },
    orderBy: { name: 'asc' }
  })
}

/**
 * Lista de gerencias con su gerente actual (si existe). El UI usa esto
 * para:
 *  - Poblar el dropdown "Gerencia" del form de usuario.
 *  - Mostrar en cada gerencia el gerente actual + status (DISPONIBLE / OCUPADO)
 *    y bloquear el submit si la gerencia ya tiene gerente.
 */
export async function getGerenciasWithCurrentManager() {
  const gerencias = await prisma.gerencia.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      gerentes: {
        select: { id: true, name: true, email: true },
      },
    },
  })
  return gerencias.map((g) => ({
    id: g.id,
    name: g.name,
    currentManager: g.gerentes[0] ?? null,
    isAvailable: g.gerentes.length === 0,
  }))
}
