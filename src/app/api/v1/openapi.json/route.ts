/**
 * API REST v1 — `GET /api/v1/openapi.json`.
 *
 * Endpoint público (sin auth) que devuelve la especificación OpenAPI 3.0
 * completa. Se sirve desde el JSON estático en `_openapi.json` para que
 * Swagger UI / Postman / Insomnia puedan importarla directamente.
 */

import 'server-only'
import openapiSpec from '../_openapi.json'

export const dynamic = 'force-static'

export async function GET() {
  return new Response(JSON.stringify(openapiSpec), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
}
