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
import prisma from '@/lib/prisma';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProjectDetailManagement({ params }: PageProps) {
  const { id } = await params;
  const [currentUser, sprintReleases, activeSprint] = await Promise.all([
    getCurrentUserPresence(),
    // Wave P9 follow-up — Releases con scopeMode=SPRINT activas para
    // que el modal "Nuevo Sprint" pueda ofrecer asociación.
    prisma.release.findMany({
      where: {
        projectId: id,
        archivedAt: null,
        releasedDate: null,
        scopeMode: 'SPRINT',
      },
      select: { id: true, name: true, version: true, scopeMode: true },
      orderBy: { plannedDate: 'asc' },
    }),
    // Wave R5 Extended (US-Reporting-PDF) — sprint activo para que el
    // dropdown "Exportar PDF" del header pueda enlazar al Sprint Review.
    prisma.sprint.findFirst({
      where: { projectId: id, status: 'ACTIVE' },
      select: { id: true, name: true },
      orderBy: { startDate: 'desc' },
    }),
  ]);

  return (
    <ProjectDetailClient
      projectId={id}
      currentUser={currentUser}
      sprintReleases={sprintReleases}
      activeSprint={activeSprint}
    />
  );
}
