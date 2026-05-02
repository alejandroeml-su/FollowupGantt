import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it } from 'vitest'

/**
 * HU-4.0 · Tests parametrizados sobre fixtures pseudo-reales MSP XML.
 *
 * Estado actual (Sprint 8): TODOS los tests son `it.todo` porque el parser
 * MSP (HU-4.1) está siendo escrito por otro agente en paralelo. Cuando ese
 * PR mergee a master:
 *
 *   1. Regenerar los fixtures localmente:
 *        npx tsx scripts/gen-pseudoreal-fixtures.ts
 *      Los XML están en `.gitignore` (regenerables por diseño).
 *
 *   2. Convertir cada `it.todo` en `it()` real, importando el parser:
 *        import { parseMspXml } from '@/lib/import-export/msp-parser'
 *      y validar:
 *        - Conteo de tasks/deps/resources coherente con lo declarado en
 *          `EXPECTED_COUNTS` (debajo).
 *        - Jerarquía de OutlineNumber detectada (4 niveles, root virtual `0`).
 *        - LinkLag fuera de rango (>365d) clampeado con warning.
 *        - Resource sin email genera warning RESOURCE_NO_MATCH.
 *        - Task con `>1` Resource genera warning MULTIPLE_ASSIGNMENTS_IGNORED.
 *        - Task con `Active=0` se ignora (no aparece en output).
 *        - BOM UTF-8 stripeado sin error en `proyecto-grande.xml`.
 *        - Latencia parse <500ms en proyecto-grande (500 tasks · 100 deps).
 *
 * Por qué `it.todo` y no `it.skip`:
 *   - `todo` aparece en el reporter como pendiente explícito (vitest los lista
 *     al final del run). `skip` los oculta.
 *   - `todo` no falla si no se reactiva, pero deja constancia de intención.
 *   - Cuando HU-4.1 mergee, este archivo cambia de N×7 todo → N×7 it().
 *
 * Por qué fixtures pseudo-reales (vs sintético del POC):
 *   - El sintético del POC (`tests/perf/_fixtures/msp-5000.xml`) prueba
 *     volumen pero no cubre warnings (todos sus recursos tienen email,
 *     todas sus tareas son válidas). Los pseudo-reales fuerzan ramas de
 *     warning del parser que el sintético jamás toca.
 *   - Tres tamaños (~30 / ~150 / ~500 tasks) cubren proyectos Avante reales
 *     vistos en producción (HU-3.5 lookbook).
 *
 * Fixtures (regenerados por scripts/gen-pseudoreal-fixtures.ts):
 *   - proyecto-pequeño.xml  ~30 tasks  · 5 deps   · 3 recursos
 *   - proyecto-medio.xml    ~150 tasks · 30 deps  · 10 recursos
 *   - proyecto-grande.xml   ~500 tasks · 100 deps · 25 recursos · BOM UTF-8
 */

const FIXTURES_DIR = path.resolve(
  __dirname,
  '..',
  'e2e',
  '_fixtures',
  'msp-real',
)

const FIXTURES = [
  'proyecto-pequeño.xml',
  'proyecto-medio.xml',
  'proyecto-grande.xml',
] as const

/**
 * Conteos esperados por fixture (declarados por el script generador).
 * Si el script cambia su escala, sincroniza estos valores.
 */
const EXPECTED_COUNTS: Record<
  (typeof FIXTURES)[number],
  { tasks: number; deps: number; resources: number; withBom: boolean }
> = {
  'proyecto-pequeño.xml': { tasks: 30, deps: 5, resources: 3, withBom: false },
  'proyecto-medio.xml': { tasks: 150, deps: 30, resources: 10, withBom: false },
  'proyecto-grande.xml': { tasks: 500, deps: 100, resources: 25, withBom: true },
}

/**
 * Helper: chequear si el fixture existe en disco (puede no existir si nadie
 * corrió `npx tsx scripts/gen-pseudoreal-fixtures.ts` localmente). Cuando los
 * tests se reactiven (HU-4.1 mergeada), este helper se usará dentro del
 * `beforeAll` para skip explícito con mensaje guía.
 */
export function fixtureExists(filename: string): boolean {
  return fs.existsSync(path.join(FIXTURES_DIR, filename))
}

describe.each(FIXTURES)('msp-parser pseudo-real · %s', (filename) => {
  // Sirven de anclaje para el agente que reactive los tests: las constantes
  // están "vivas" aunque los tests sean `todo`.
  void EXPECTED_COUNTS[filename]
  void fixtureExists

  it.todo('parsea sin errores')
  it.todo('detecta jerarquía OutlineNumber correctamente (4 niveles + root virtual 0)')
  it.todo('clampa LinkLag fuera de rango (>365 days) con warning LAG_CLAMPED')
  it.todo('emite warning RESOURCE_NO_MATCH para Resource sin EmailAddress')
  it.todo('emite warning MULTIPLE_ASSIGNMENTS_IGNORED en task con >1 Resource')
  it.todo('ignora tasks con Active=0 (no aparecen en el output del parser)')
  it.todo('strip BOM UTF-8 sin error en proyecto-grande.xml')
  it.todo('latencia parse <500ms (proyecto-grande con 500 tasks · 100 deps)')
})
