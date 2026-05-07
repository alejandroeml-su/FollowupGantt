import 'server-only'
import prisma from '@/lib/prisma'

/**
 * Resuelve handles textuales (`@edwin`, `@EDWIN`, `@edwin@avante.com`,
 * `@emartinez`) a registros de User.
 *
 * Bug 2026-05-06: el matching anterior usaba
 *   `where: { OR: [ { email: { in: handles } }, { name: { in: handles } } ] }`
 * que es exact + case-sensitive. Como `MentionTextarea` inserta el
 * handle como **primer nombre** (`user.name.split(/\s+/)[0]` →
 * "Edwin" para un User cuyo `name` real es "Edwin Martinez"), nunca
 * hacía match con la BD y el correo de mención no salía.
 *
 * Estrategia (lookup laxo, prioriza precisión):
 *   1. Match por email completo (lowercased).
 *   2. Match por email local part (parte antes del `@`, lowercased).
 *   3. Match por full name (lowercased).
 *   4. Match por primer token del name (lowercased) — para `@Edwin`
 *      cuando el name es "Edwin Martinez".
 *
 * Cargamos todos los usuarios y filtramos en JS. Para una org interna
 * (decenas, no miles) es óptimo y evita SQL frágil con OR + LOWER().
 *
 * Uso compartido entre `notify.ts` y `createComment` (lib/actions.ts)
 * — no replicar la lógica en otro caller; importar de aquí.
 */

export type ResolvedMentionUser = { id: string; email: string; name: string }

export async function resolveHandlesToUsers(
  handles: string[],
): Promise<ResolvedMentionUser[]> {
  if (handles.length === 0) return []
  const lowerHandles = new Set(handles.map((h) => h.toLowerCase()))

  const candidates = await prisma.user.findMany({
    select: { id: true, email: true, name: true },
  })

  const matched: ResolvedMentionUser[] = []
  for (const u of candidates) {
    const email = (u.email ?? '').toLowerCase()
    const emailLocal = email.split('@')[0]
    const fullName = (u.name ?? '').toLowerCase().trim()
    const firstName = fullName.split(/\s+/)[0] ?? ''
    if (
      lowerHandles.has(email) ||
      (emailLocal && lowerHandles.has(emailLocal)) ||
      (fullName && lowerHandles.has(fullName)) ||
      (firstName && lowerHandles.has(firstName))
    ) {
      matched.push(u as ResolvedMentionUser)
    }
  }
  return matched
}
