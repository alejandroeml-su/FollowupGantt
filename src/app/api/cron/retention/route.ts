/**
 * R3.0-F · Data Retention Policies — Cron diario.
 *
 * Itera todos los workspaces (excepto archivados) y ejecuta
 * `runPurgeForWorkspace`. Schedule recomendado: `0 3 * * *` (diariamente
 * a las 03:00 UTC, ver `vercel.json`).
 *
 * Autorización Vercel Cron: header `Authorization: Bearer ${CRON_SECRET}`.
 * En dev local sin secret aceptamos loopback (mismo patrón que el resto
 * de crons del repo).
 *
 * RIESGO DESTACADO: este cron borra datos. Validar `retainDays` por
 * workspace en /admin/retention ANTES de habilitar en producción. Ver
 * sección "Setup pendiente" del PR.
 */

import { NextResponse, type NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { runPurgeForWorkspace } from '@/lib/retention/engine'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Workspaces grandes pueden tardar; los DELETE batched cap a 100k/dominio
// dan margen razonable. 5min de pad por workspace medio.
export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  if (secret) {
    return auth === `Bearer ${secret}`
  }
  // Sin secret: solo loopback (dev).
  const url = new URL(req.url)
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    // Solo workspaces NO archivados — los archivados conservan su data
    // congelada para auditoría (no aplicamos retention encima).
    const workspaces = await prisma.workspace.findMany({
      where: { archivedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })

    const reports = []
    for (const ws of workspaces) {
      try {
        const report = await runPurgeForWorkspace(ws.id)
        reports.push({
          workspaceId: ws.id,
          ok: true,
          outcomes: report.outcomes,
        })
      } catch (err) {
        // Workspace-level fail: continuamos con el resto.
        const errorMessage =
          err instanceof Error ? err.message : String(err)
        console.error(
          `[Retention] runPurgeForWorkspace failed ws=${ws.id}`,
          err,
        )
        reports.push({ workspaceId: ws.id, ok: false, errorMessage })
      }
    }

    return NextResponse.json({
      ok: true,
      workspacesProcessed: workspaces.length,
      ranAt: new Date().toISOString(),
      reports,
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
