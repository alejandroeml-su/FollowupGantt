/**
 * /projects/[id] · Detalle de proyecto (RSC shell).
 *
 * Wave P6 · Equipo B1 — Convertimos el page de full-client a RSC para poder
 * cargar la sesión server-side y hacer drilling de `currentUser` al header
 * de presence (`<ProjectHeaderPresence>`). Toda la UI interactiva vive en
 * `<ProjectDetailClient>` (single client boundary).
 *
 * Notas Next 16:
 *  - `params` es `Promise<>` y debe `await`-earse antes de leer.
 *  - El RSC NO puede declarar `'use client'`; los componentes hijos sí.
 */
import ProjectDetailClient from '@/components/projects/ProjectDetailClient';
import { getCurrentUserPresence } from '@/lib/auth/get-current-user-presence';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProjectDetailManagement({ params }: PageProps) {
  const { id } = await params;
  const currentUser = await getCurrentUserPresence();

  return <ProjectDetailClient projectId={id} currentUser={currentUser} />;
}
