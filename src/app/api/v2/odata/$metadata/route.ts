/**
 * Wave P21-C · Power BI Connector — dedicated `$metadata` EDMX endpoint.
 *
 * Power BI Desktop hace `GET /api/v2/odata/$metadata` antes de listar
 * entity sets en su Navigator. Tener un route literal (vs el catch del
 * dynamic `[entitySet]`) garantiza:
 *
 *   1. Matching prioritario por parte de Next.js — el segmento literal
 *      siempre gana sobre el dynamic param.
 *   2. Path independiente del dispatcher de entity sets — si alguna
 *      vez se mueve `[entitySet]` a otro layout, $metadata sobrevive.
 *   3. Logs separados / observabilidad propia.
 *
 * El EDMX vive en `../metadata.ts` (compartido con el fallback del
 * dispatcher). Esto evita drift entre las dos rutas.
 *
 * Acceso: público (sin auth). Esto es alineado con la práctica común
 * de OData v4 — `$metadata` describe el schema, no expone datos.
 */

import { metadataResponse } from '../metadata'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return metadataResponse()
}
