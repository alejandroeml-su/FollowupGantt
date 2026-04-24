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
