import 'server-only'

/**
 * R3.0 · Fase 2 · SSO/SAML — JIT (Just-in-Time) user provisioning.
 *
 * Tras validar el assertion y derivar el `MappedSsoProfile`, este módulo:
 *   1. Busca un `User` por email (case-insensitive).
 *   2. Si no existe, crea uno (`password = null`, sin verificar email —
 *      la confianza viene del IdP).
 *   3. Upsertea `SsoUserLink` con `lastLoginAt = now()`.
 *   4. Si el provider entrega un `WorkspaceRole`, upsertea
 *      `WorkspaceMember` con ese rol (sin downgrade — sólo promoción).
 *
 * Retorna `{ userId }` para que el caller cree la sesión vía
 * `createSessionWithMetadata()`.
 */

import prisma from '@/lib/prisma'
import type { MappedSsoProfile } from './types'

const ROLE_PRIORITY = {
  OWNER: 4,
  ADMIN: 3,
  MEMBER: 2,
  VIEWER: 1,
} as const

export async function createOrLinkUser(input: {
  workspaceId: string
  providerId: string
  profile: MappedSsoProfile
}): Promise<{ userId: string; created: boolean }> {
  const { workspaceId, providerId, profile } = input

  return prisma.$transaction(async (tx) => {
    // 1. Si ya existe un link por (provider, externalId), úsalo —
    //    permite que el IdP cambie el email del usuario sin perder el link.
    const existingLink = await tx.ssoUserLink.findUnique({
      where: {
        providerId_externalId: {
          providerId,
          externalId: profile.externalId,
        },
      },
      select: { userId: true },
    })

    let userId: string
    let created = false

    if (existingLink) {
      userId = existingLink.userId
      // Refrescar lastLoginAt.
      await tx.ssoUserLink.update({
        where: {
          providerId_externalId: {
            providerId,
            externalId: profile.externalId,
          },
        },
        data: { lastLoginAt: new Date() },
      })
    } else {
      // 2. Buscar User por email; crear si no existe.
      const existingUser = await tx.user.findUnique({
        where: { email: profile.email },
        select: { id: true },
      })

      if (existingUser) {
        userId = existingUser.id
      } else {
        const fresh = await tx.user.create({
          data: {
            email: profile.email,
            name: profile.name,
          },
          select: { id: true },
        })
        userId = fresh.id
        created = true
      }

      // 3. Crear el link.
      await tx.ssoUserLink.create({
        data: {
          userId,
          providerId,
          externalId: profile.externalId,
          lastLoginAt: new Date(),
        },
      })
    }

    // 4. Upsert WorkspaceMember (solo si IdP entrega rol). No degradamos.
    if (profile.workspaceRole) {
      const existingMember = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { role: true },
      })
      if (!existingMember) {
        await tx.workspaceMember.create({
          data: { workspaceId, userId, role: profile.workspaceRole },
        })
      } else {
        const currentPrio = ROLE_PRIORITY[existingMember.role]
        const newPrio = ROLE_PRIORITY[profile.workspaceRole]
        if (newPrio > currentPrio) {
          await tx.workspaceMember.update({
            where: { workspaceId_userId: { workspaceId, userId } },
            data: { role: profile.workspaceRole },
          })
        }
      }
    } else {
      // Sin rol explícito: garantizar membresía MEMBER si no existe.
      const existingMember = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { workspaceId: true },
      })
      if (!existingMember) {
        await tx.workspaceMember.create({
          data: {
            workspaceId,
            userId,
            role: 'MEMBER',
          },
        })
      }
    }

    return { userId, created }
  })
}
