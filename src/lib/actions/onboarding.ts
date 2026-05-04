'use server'

/**
 * Equipo D3 · Server actions del flujo de onboarding.
 *
 * El onboarding del workspace se ejecuta en el cliente (multi-step UI),
 * pero algunas señales (proyecto recién creado, marca de "completado")
 * se necesitan en el servidor para revalidar y para futuras consultas.
 *
 * Decisiones D3:
 *   - D3-OB-1 · Persistencia de progreso: a falta de campo
 *     `User.onboardingStep` en BD se usa `localStorage` en el cliente.
 *     Esta acción `dismissOnboarding` se mantiene server-side para
 *     centralizar el `revalidatePath('/')` y dejar el hook listo para
 *     migrar a BD (TODO en `OnboardingFlow`).
 *   - D3-OB-2 · `findFirstProjectId` resuelve el proyecto recién creado
 *     usando `name` (filtro en el último creado del workspace) — más
 *     simple que devolver el id desde `createProject` (FormData) sin
 *     tocar el contrato existente de esa server action. Reglas:
 *     workspace activo + ordenado por createdAt desc.
 *
 * Convenciones del repo aplicadas:
 *   - Errores tipados `[CODE] detalle`.
 *   - `revalidatePath('/')` tras cualquier acción de onboarding.
 *   - No retorna FormData; consumido vía `await` desde un client component.
 */

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requireUser } from '@/lib/auth/get-current-user'

type OnboardingErrorCode = 'INVALID_INPUT' | 'NOT_FOUND'

function actionError(code: OnboardingErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

/**
 * Marca el onboarding como completado / descartado para el usuario actual.
 *
 * Hoy: solo revalida el dashboard. El estado real persiste en
 * `localStorage` (ver `OnboardingFlow.tsx`). Cuando se añada el campo
 * `User.onboardingDismissedAt`, esta función llenará la columna en BD.
 */
export async function dismissOnboarding(): Promise<{ ok: true }> {
  await requireUser()
  // TODO(BD): persistir `User.onboardingDismissedAt = new Date()` cuando
  // el campo exista en `prisma/schema.prisma`. Por ahora la marca vive
  // en `localStorage` del cliente y en la heurística de "tiene proyectos".
  revalidatePath('/')
  return { ok: true }
}

/**
 * Resuelve el id del proyecto recién creado por su nombre dentro del
 * workspace activo. Devuelve `null` si no existe (caller debe hacer
 * fallback a `/projects`).
 *
 * Útil para el último paso del onboarding: tras `createProject(formData)`
 * el client necesita el id para crear la primera tarea y para el
 * redirect final a `/projects/{id}`.
 */
export async function findFirstProjectIdByName(
  name: string,
): Promise<string | null> {
  await requireUser()
  if (!name || !name.trim()) {
    actionError('INVALID_INPUT', 'name es obligatorio')
  }
  const project = await prisma.project.findFirst({
    where: { name: name.trim() },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  return project?.id ?? null
}
