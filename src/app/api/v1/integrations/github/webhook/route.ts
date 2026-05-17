/**
 * Wave R5 Extended · US R5E-Marketplace · GitHub Webhook (inbound).
 *
 * Endpoint receptor para webhooks de GitHub (Issues/Pull Request events).
 * FASE 1 — sólo verifica la firma HMAC-SHA256 (`x-hub-signature-256`),
 * loggea el payload y emite audit `integration.webhook_received`. El
 * processing real (e.g. cerrar la tarea cuando el issue se cierra) queda
 * diferido a R5E++ (deuda registrada).
 *
 * Seguridad:
 *   - Modo seguro: si no hay `webhookSecret` configurado en el install,
 *     el endpoint rechaza el request (mejor que aceptar todo).
 *   - Multi-tenant: la query param `?install=<installId>` identifica al
 *     workspace. Sin install activo válido → 404.
 *   - Body se lee como `text()` (raw) para validar firma sin reserializar.
 *
 * Configuración GitHub:
 *   - Settings → Webhooks → Add webhook
 *   - Payload URL: `<APP_URL>/api/v1/integrations/github/webhook?install=<id>`
 *   - Content type: application/json
 *   - Secret: el mismo `webhookSecret` configurado en el install.
 */

import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'
import { verifyGithubWebhookSignature } from '@/lib/integrations/github-client'
import type { GithubInstallConfig } from '@/lib/integrations/registry'

export const dynamic = 'force-dynamic'
// Node runtime — usamos crypto.subtle en el verifier (Edge también lo soporta,
// pero Node es más conservador para futuras integraciones que sí necesiten
// libs Node).
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const url = new URL(request.url)
  const installId = url.searchParams.get('install') ?? ''
  if (!installId) {
    return NextResponse.json(
      { error: { code: 'MISSING_INSTALL', message: 'install param requerido' } },
      { status: 400 },
    )
  }

  const rawBody = await request.text()
  const signatureHeader = request.headers.get('x-hub-signature-256')
  const ghEvent = request.headers.get('x-github-event') ?? 'unknown'
  const ghDelivery = request.headers.get('x-github-delivery') ?? null

  let install: {
    id: string
    workspaceId: string
    providerKey: string
    status: string
    config: unknown
  } | null = null
  try {
    install = await prisma.integrationInstall.findUnique({
      where: { id: installId },
      select: {
        id: true,
        workspaceId: true,
        providerKey: true,
        status: true,
        config: true,
      },
    })
  } catch (e) {
    console.warn('[GitHub webhook] DB lookup failed:', (e as Error).message)
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: 'lookup failed' } },
      { status: 500 },
    )
  }
  if (!install || install.providerKey !== 'github' || install.status === 'DISCONNECTED') {
    return NextResponse.json(
      { error: { code: 'INSTALL_NOT_FOUND', message: 'install no existe o está desconectado' } },
      { status: 404 },
    )
  }

  if (
    !install.config ||
    typeof install.config !== 'object' ||
    Array.isArray(install.config)
  ) {
    return NextResponse.json(
      { error: { code: 'INVALID_CONFIG', message: 'config inválido' } },
      { status: 500 },
    )
  }
  const cfg = install.config as unknown as GithubInstallConfig

  const verified = await verifyGithubWebhookSignature({
    secret: cfg.webhookSecret,
    rawBody,
    signatureHeader,
  })
  if (!verified) {
    // Auditamos el intento fallido sin exponer detalles (defensa-en-profundidad).
    await recordAuditEventSafe({
      action: 'integration.webhook_received',
      entityType: 'integration_install',
      entityId: install.id,
      metadata: {
        providerKey: 'github',
        event: ghEvent,
        delivery: ghDelivery,
        verified: false,
      },
    })
    return NextResponse.json(
      { error: { code: 'INVALID_SIGNATURE', message: 'firma inválida' } },
      { status: 401 },
    )
  }

  // Logging (R5E FASE 1) — el body se persiste truncado en metadata para
  // debugging. Processing real (e.g. cerrar Task cuando GitHub cierra el
  // issue) lo difiere R5E++ (deuda registrada).
  let bodyHead: string | null = null
  try {
    // Truncamos a 2KB para no inflar el audit log. JSON.parse defensivo.
    const parsed = JSON.parse(rawBody) as Record<string, unknown>
    const summary = {
      action: parsed.action,
      issue:
        parsed.issue && typeof parsed.issue === 'object'
          ? {
              number: (parsed.issue as Record<string, unknown>).number,
              title: (parsed.issue as Record<string, unknown>).title,
              state: (parsed.issue as Record<string, unknown>).state,
            }
          : null,
    }
    bodyHead = JSON.stringify(summary).slice(0, 2000)
  } catch {
    bodyHead = rawBody.slice(0, 2000)
  }

  await recordAuditEventSafe({
    action: 'integration.webhook_received',
    entityType: 'integration_install',
    entityId: install.id,
    metadata: {
      providerKey: 'github',
      workspaceId: install.workspaceId,
      event: ghEvent,
      delivery: ghDelivery,
      verified: true,
      bodyHead,
    },
  })

  return NextResponse.json({ ok: true, event: ghEvent }, { status: 200 })
}
