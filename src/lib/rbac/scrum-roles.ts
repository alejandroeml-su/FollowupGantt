/**
 * Wave P11-Scrum (HU-11.3) — Roles RBAC formales del Scrum Guide.
 *
 * Sync ya tiene RBAC genérico (Role + UserRole) con SUPER_ADMIN/ADMIN/AGENTE.
 * Este módulo agrega los 3 accountabilities Scrum 2020 como roles
 * adicionales que el seed/admin puede asignar a usuarios:
 *
 *   - PRODUCT_OWNER · ordena Backlog, define Product Goal, acepta increments
 *   - SCRUM_MASTER · facilita eventos, gestiona impedimentos, coachea
 *   - DEVELOPER · ejecuta tasks (rol implícito vía assigneeId, pero formal aquí)
 *
 * Convención de naming: prefijo `SCRUM_` para distinguirlos de roles
 * de plataforma (ADMIN/SUPER_ADMIN/AGENTE).
 */

export const SCRUM_ROLES = {
  PRODUCT_OWNER: 'SCRUM_PRODUCT_OWNER',
  SCRUM_MASTER: 'SCRUM_MASTER',
  DEVELOPER: 'SCRUM_DEVELOPER',
} as const

export type ScrumRoleName = (typeof SCRUM_ROLES)[keyof typeof SCRUM_ROLES]

export const SCRUM_ROLE_DEFINITIONS: ReadonlyArray<{
  name: ScrumRoleName
  label: string
  description: string
  responsibilities: string[]
}> = [
  {
    name: 'SCRUM_PRODUCT_OWNER',
    label: 'Product Owner',
    description:
      'Maximiza el valor del producto. Único responsable del Product Backlog y del Product Goal.',
    responsibilities: [
      'Definir y comunicar el Product Goal',
      'Crear y comunicar items del Product Backlog',
      'Ordenar items del Product Backlog (priorización)',
      'Aceptar o rechazar increments en Sprint Review',
      'Asegurar que el Backlog es transparente y comprensible',
    ],
  },
  {
    name: 'SCRUM_MASTER',
    label: 'Scrum Master',
    description:
      'Servidor-líder del Scrum Team. Asegura que Scrum se entiende y se practica.',
    responsibilities: [
      'Facilitar los eventos Scrum (Planning / Daily / Review / Retro)',
      'Coachear al equipo en auto-organización y cross-functionality',
      'Eliminar impedimentos del progreso',
      'Coachear al PO en gestión efectiva del Backlog',
      'Liderar adopción Scrum en la organización',
    ],
  },
  {
    name: 'SCRUM_DEVELOPER',
    label: 'Developer (Scrum)',
    description:
      'Miembro del Scrum Team que crea cualquier aspecto del Increment usable cada Sprint.',
    responsibilities: [
      'Crear plan para el Sprint (Sprint Backlog)',
      'Adherirse a la Definition of Done (calidad)',
      'Adaptar el plan diario hacia el Sprint Goal',
      'Responsabilidad mutua como profesionales',
    ],
  },
]

/** Helper: dado un Role.name, indica si es un rol Scrum (vs plataforma). */
export function isScrumRole(name: string): name is ScrumRoleName {
  return name.startsWith('SCRUM_')
}
