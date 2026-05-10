import 'server-only'

/**
 * Wave P18 hardening — Helper para envolver queries con contexto RLS.
 *
 * Postgres RLS necesita conocer el `user_id` y `workspace_id` de la sesión
 * actual para evaluar las políticas restrictivas (`USING
 * app.is_project_member(current_setting('app.user_id'), "projectId")`).
 *
 * Patrón:
 *   await withRlsContext({ userId, workspaceId }, async (tx) => {
 *     return tx.task.findMany({ where: { projectId } })
 *   })
 *
 * Internamente abre una transacción Prisma, setea los GUCs con
 * `set_config(name, value, true)` (LOCAL a la transacción · se limpia
 * automáticamente al cerrar) y ejecuta el callback con el cliente
 * transaccional.
 *
 * NOTA: este helper queda listo para uso pero NO se conecta a las
 * server actions todavía. La activación de políticas RLS restrictivas
 * en `20260510_p18_rls_restrictive` requiere que las queries pasen
 * por este wrapper · habilitar gradualmente por dominio (P12 primero,
 * luego risks, etc).
 */

import type { Prisma, PrismaClient } from '@prisma/client'
import prisma from '@/lib/prisma'

type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

export interface RlsContext {
  /** ID del usuario activo (de la sesión auth). */
  userId: string
  /** ID del workspace activo (de la cookie x-active-workspace). */
  workspaceId?: string | null
}

/**
 * Ejecuta `fn` dentro de una transacción Postgres con `app.user_id` y
 * `app.workspace_id` seteados como GUCs locales. Las políticas RLS que
 * usan `current_setting('app.user_id', true)` ven el valor correcto.
 *
 * - `set_config(name, value, true)` con `is_local=true` limita el
 *   alcance a la transacción · se resetean automáticamente al cerrar.
 * - Si `userId` viene vacío, lanza `[INVALID_INPUT]` antes de tocar la BD.
 * - Si la transacción rollback, el setting tampoco persiste (Postgres
 *   garantiza atomicidad GUC + datos).
 */
export async function withRlsContext<T>(
  ctx: RlsContext,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  if (!ctx.userId || typeof ctx.userId !== 'string') {
    throw new Error('[INVALID_INPUT] withRlsContext requires userId')
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId}, true)`
    if (ctx.workspaceId) {
      await tx.$executeRaw`SELECT set_config('app.workspace_id', ${ctx.workspaceId}, true)`
    }
    return fn(tx as unknown as TxClient)
  }) as Promise<T>
}

/**
 * Variante que solo lee el contexto actual desde la sesión `getCurrentUser`.
 * Conveniente para server actions donde el caller siempre opera bajo el
 * usuario autenticado.
 */
export async function withRlsContextFromSession<T>(
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  const { getCurrentUser } = await import('@/lib/auth/get-current-user')
  const user = await getCurrentUser()
  if (!user) throw new Error('[UNAUTHORIZED] Sesión requerida para RLS context')
  return withRlsContext(
    {
      userId: user.id,
      workspaceId:
        (user as { workspaceId?: string | null }).workspaceId ?? null,
    },
    fn,
  )
}

/**
 * Variante "fire-and-forget" para queries simples sin necesidad de
 * exponer el cliente transaccional. Cierra el patrón:
 *   const tasks = await execWithRls({userId}, t => t.task.findMany())
 */
export async function execWithRls<T>(
  ctx: RlsContext,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  return withRlsContext(ctx, fn)
}

// Helper interno tipado para uso en tests u otros wrappers.
export type { Prisma }
