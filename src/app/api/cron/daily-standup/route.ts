/**
 * Ola P7 · Equipo P7-4 · Daily Standup — Cron handler.
 *
 * Endpoint que Vercel Cron (o GitHub Actions) golpea cada mañana con
 * cabecera `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Para cada proyecto activo:
 *   1. Construye el contexto vía `buildProjectStandupContext`.
 *   2. Genera el standup con `generateStandup` (LLM o fallback).
 *   3. Si hay integración Slack activa para ese proyecto (o global),
 *      formatea con `formatStandupForSlack` y dispatcha el webhook.
 *   4. Errores se loggean por proyecto y NO abortan el batch.
 *
 * Cron schedule sugerido: `0 8 * * 1-5` (lun-vie, 8am UTC).
 *   - En `vercel.json`, agregar:
 *     {
 *       "crons": [
 *         { "path": "/api/cron/daily-standup", "schedule": "0 8 * * 1-5" }
 *       ]
 *     }
 *
 * El runtime es `nodejs` por la dependencia con Prisma + Anthropic SDK.
 */

import { NextResponse, type NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { buildProjectStandupContext } from '@/lib/ai/standup/build-standup-context'
import { generateStandup } from '@/lib/ai/standup/generate-standup'
import { formatStandupForSlack } from '@/lib/ai/standup/format-slack'
import { dispatchSlackNotification } from '@/lib/integrations/slack'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// 5 min — el batch puede ser pesado si hay muchos proyectos activos.
export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''

  if (secret) {
    return auth === `Bearer ${secret}`
  }

  // Sin secret → sólo loopback (dev local).
  const url = new URL(req.url)
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
}

interface ProjectResult {
  projectId: string
  projectName: string
  ok: boolean
  slackDispatched: boolean
  slackSkipped?: boolean
  error?: string
}

interface CronSummary {
  ok: boolean
  date: string
  totalProjects: number
  generated: number
  failed: number
  results: ProjectResult[]
}

async function runBatch(): Promise<CronSummary> {
  const projects = await prisma.project.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  const results: ProjectResult[] = []
  let generated = 0
  let failed = 0
  const today = new Date().toISOString().slice(0, 10)

  for (const project of projects) {
    try {
      const ctx = await buildProjectStandupContext(project.id)
      const standup = await generateStandup(ctx, { force: true })

      // Buscar integraciones Slack activas (per-project + globales).
      const integrations = await prisma.integration.findMany({
        where: {
          type: 'SLACK',
          enabled: true,
          OR: [{ projectId: project.id }, { projectId: null }],
        },
        select: { id: true },
      })

      let dispatched = false
      let allSkipped = true
      for (const integ of integrations) {
        try {
          const payload = formatStandupForSlack(standup, {
            headerTitle: `Daily standup · ${project.name}`,
          })
          const res = await dispatchSlackNotification(integ.id, payload)
          if (res.ok && !res.skipped) {
            dispatched = true
            allSkipped = false
          } else if (!res.ok) {
            allSkipped = false
            // Loggear pero seguir con el siguiente integ / proyecto.
            console.warn(
              `[cron/daily-standup] slack dispatch failed for project ${project.id} integ ${integ.id}: ${res.error}`,
            )
          }
        } catch (err) {
          allSkipped = false
          console.warn(
            `[cron/daily-standup] slack threw for project ${project.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          )
        }
      }

      generated += 1
      results.push({
        projectId: project.id,
        projectName: project.name,
        ok: true,
        slackDispatched: dispatched,
        slackSkipped: integrations.length > 0 && allSkipped && !dispatched,
      })
    } catch (err) {
      failed += 1
      const message = err instanceof Error ? err.message : String(err)
      console.error(
        `[cron/daily-standup] project ${project.id} failed: ${message}`,
      )
      results.push({
        projectId: project.id,
        projectName: project.name,
        ok: false,
        slackDispatched: false,
        error: message,
      })
    }
  }

  return {
    ok: failed === 0,
    date: today,
    totalProjects: projects.length,
    generated,
    failed,
    results,
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const summary = await runBatch()
    return NextResponse.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return GET(req)
}
