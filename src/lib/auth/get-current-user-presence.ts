/**
 * Helper · Identidad mínima del usuario actual para Realtime/Presence.
 *
 * Wave P6 · Equipo B1 · ampliado en Wave C-debt-1 (Equipo C-DEBT-1).
 *
 * Por qué un helper aparte de `getCurrentUser`:
 * - `getCurrentUser` retorna el `SessionUser` completo (id/email/name/roles).
 *   Para presence sólo queremos los campos PUBLICABLES en el canal — id,
 *   nombre y avatar — y NUNCA email/roles (eso es PII / control de acceso).
 * - Tener un helper dedicado deja explícito el contrato con el wiring de
 *   presence: si añadimos un campo nuevo a `SessionUser` (e.g. `phone`), no
 *   se filtra accidentalmente al canal Realtime.
 *
 * NOTAS:
 * - Este archivo NO declara `'use server'` ni `'use client'` — sólo lo deben
 *   invocar Server Components / Server Actions. La importación transitiva
 *   de `getCurrentUser` arrastra `import 'server-only'`, lo que el bundler
 *   de Next 16 hará explotar si alguien lo importa desde un client.
 * - Wave C-debt-1: `avatarUrl` ahora se hidrata leyendo `User.image` desde
 *   prisma (nullable). Si la columna está vacía o el usuario aún no se
 *   actualizó, devolvemos `undefined` y el wiring de presence lo trata como
 *   "sin avatar" (degradación a iniciales).
 */
import { getCurrentUser } from '@/lib/auth/get-current-user'
import prisma from '@/lib/prisma'

export type CurrentUserPresence = {
  userId: string
  name: string
  avatarUrl?: string
}

/**
 * Devuelve `{ userId, name, avatarUrl? }` o `null` si no hay sesión.
 *
 * Uso típico (desde un RSC):
 *
 * ```ts
 * const currentUser = await getCurrentUserPresence()
 * if (currentUser) {
 *   return <ProjectHeaderPresence currentUser={currentUser} projectId={id} />
 * }
 * ```
 *
 * Hace una query extra a `User.image`. Si en el futuro `SessionUser`
 * incluye `image` directamente, se puede eliminar.
 */
export async function getCurrentUserPresence(): Promise<CurrentUserPresence | null> {
  const user = await getCurrentUser()
  if (!user) return null

  // Lectura explícita de `image` — el `SessionUser` no la incluye por ser
  // un campo cosmético no relacionado con auth/permisos. La query es barata
  // (PK lookup, single column) y `User` está hot en pool.
  const profile = await prisma.user.findUnique({
    where: { id: user.id },
    select: { image: true },
  })

  return {
    userId: user.id,
    name: user.name,
    avatarUrl: profile?.image ?? undefined,
  }
}
