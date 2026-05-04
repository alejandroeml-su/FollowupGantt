/**
 * Helper · Identidad mínima del usuario actual para Realtime/Presence.
 *
 * Wave P6 · Equipo B1.
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
 * - `avatarUrl` queda `undefined` en MVP: el modelo `User` aún no expone un
 *   campo de imagen. Cuando el backlog incluya avatares, basta con leer aquí
 *   `user.image` y propagar — el resto del wiring ya lo soporta como opcional.
 */
import { getCurrentUser } from '@/lib/auth/get-current-user'

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
 */
export async function getCurrentUserPresence(): Promise<CurrentUserPresence | null> {
  const user = await getCurrentUser()
  if (!user) return null
  return {
    userId: user.id,
    name: user.name,
    // avatarUrl: futuro — `user.image` cuando se añada al schema.
  }
}
