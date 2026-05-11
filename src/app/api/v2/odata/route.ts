/**
 * Wave R3.0 Fase 4.2 · BI Export Connector — OData v4 service document.
 *
 * `GET /api/v2/odata` — devuelve el "service root" canónico de OData v4:
 * lista de entity sets disponibles. Tableau lo consulta primero antes
 * de pedir `$metadata`. No requiere auth (es solo el catálogo).
 *
 * Spec: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html#sec_ServiceDocumentRequest
 */

import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const base = `${url.origin}/api/v2/odata`
  const body = {
    '@odata.context': `${base}/$metadata`,
    value: [
      { name: 'Projects', kind: 'EntitySet', url: 'Projects' },
      { name: 'Tasks', kind: 'EntitySet', url: 'Tasks' },
      { name: 'Risks', kind: 'EntitySet', url: 'Risks' },
      { name: 'EVMSnapshots', kind: 'EntitySet', url: 'EVMSnapshots' },
    ],
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'OData-Version': '4.0',
      'X-API-Version': 'v2-odata',
      'Cache-Control': 'no-store',
    },
  })
}
