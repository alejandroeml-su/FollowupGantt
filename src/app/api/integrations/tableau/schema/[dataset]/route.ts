/**
 * Wave R3.0 Fase 4 · Equipo P21-B · Tableau Web Data Connector.
 *
 * `GET /api/integrations/tableau/schema/<dataset>` — devuelve la metadata
 * Tableau-compat (columnas + tipos) de un dataset. El WDC HTML la pre-carga
 * en boot para validar que el schema servido por los endpoints REST
 * coincide con el que el JS del connector registra en `getSchema`.
 *
 * Esto NO requiere auth — es solo metadata estructural sin datos.
 * Si alguien sondea esquemas (enumeration) puede ver los nombres de
 * columnas pero no filas reales. El mismo trade-off lo hace el `$metadata`
 * de OData en `/api/v2/odata/$metadata`.
 *
 * `dataset` ∈ `projects | tasks | sprints | risks | audit`.
 */

import type { NextRequest } from 'next/server'
import {
  TABLEAU_TABLES,
  isTableauDataset,
} from '@/lib/integrations/tableau-schema'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ dataset: string }> },
): Promise<Response> {
  const { dataset } = await params
  if (!isTableauDataset(dataset)) {
    return new Response(
      JSON.stringify({
        error: {
          code: 'NOT_FOUND',
          message: `[NOT_FOUND] dataset desconocido: ${dataset}. Válidos: projects, tasks, sprints, risks, audit.`,
        },
      }),
      {
        status: 404,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-API-Version': 'tableau-v1',
        },
      },
    )
  }
  const table = TABLEAU_TABLES[dataset]
  return new Response(
    JSON.stringify({
      id: table.id,
      alias: table.alias,
      description: table.description,
      endpoint: table.endpoint,
      columns: table.columns,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        'X-API-Version': 'tableau-v1',
      },
    },
  )
}
