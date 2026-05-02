/**
 * HU-4.6 · Performance tests para export/import MS Project XML @ 5000 tareas.
 *
 * SKIPPED por defecto (gating con `RUN_PERF=1`).
 *
 *   RUN_PERF=1 npx vitest run tests/perf/msp-export-perf.test.ts
 *
 * Generación de fixtures previa:
 *   npx tsx scripts/gen-perf-fixtures.ts
 *
 * SLOs (D17, Sprint 8):
 *   - build MSP XML 5000 tareas  < 2000 ms
 *   - parse MSP XML 5 MB         < 2000 ms
 *   - round-trip completo         < 4000 ms
 *
 * NOTA: `src/lib/import-export/msp-writer.ts` está siendo escrito por el agente
 * paralelo de HU-4.3. Mientras no esté disponible, los tests "build via writer"
 * quedan como `it.todo` para que un PR posterior los convierta en reales.
 *
 * Sí ejercitamos parse con `fast-xml-parser` directo (HU-4.1 también está en
 * curso pero el parser low-level no depende de un módulo en construcción).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import { measure, assertSLO, logPerfTable, humanBytes, type PerfResult } from './_helpers/perf'

const RUN_PERF = !!process.env.RUN_PERF
const FIXTURE_PATH = join(__dirname, '_fixtures', 'msp-5000.xml')

function stripBom(buffer: Buffer): string {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    return buffer.subarray(3).toString('utf-8')
  }
  return buffer.toString('utf-8')
}

describe.skipIf(!RUN_PERF)('HU-4.6 · MSP XML export perf @5000 tasks', () => {
  const collected: PerfResult[] = []

  beforeAll(() => {
    if (!existsSync(FIXTURE_PATH)) {
      // eslint-disable-next-line no-console
      console.warn(
        `\n[HU-4.6] Fixture MSP no encontrado en ${FIXTURE_PATH}. ` +
          `Ejecuta:\n  npx tsx scripts/gen-perf-fixtures.ts\n`,
      )
    }
  })

  it.todo(
    'build MSP XML 5000 tareas <2s — pendiente de HU-4.3 (msp-writer.ts) mergear',
  )

  it.todo(
    'round-trip MSP XML 5000 tareas <4s — pendiente de HU-4.1 + HU-4.3',
  )

  it('parse MSP XML ~5MB <2s', async () => {
    if (!existsSync(FIXTURE_PATH)) {
      // eslint-disable-next-line no-console
      console.warn(`[skip] ${FIXTURE_PATH} no existe. Genera fixtures primero.`)
      return
    }
    const stats = fs.statSync(FIXTURE_PATH)
    const raw = fs.readFileSync(FIXTURE_PATH)
    const content = stripBom(raw)

    const { result: parsed, perf } = await measure('msp.parse(~5MB)', () => {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        processEntities: false,
        allowBooleanAttributes: true,
        parseAttributeValue: false,
        parseTagValue: false,
        isArray: (name) =>
          ['Task', 'Resource', 'Assignment', 'PredecessorLink'].includes(name),
      })
      return parser.parse(content)
    })
    const project = parsed.Project
    expect(project).toBeDefined()
    const taskCount = (project?.Tasks?.Task ?? []).length
    expect(taskCount).toBeGreaterThan(0)
    perf.bytes = stats.size
    perf.taskCount = taskCount
    collected.push(perf)
    assertSLO(perf, 2000)
  })

  it('reporte de latencias', () => {
    // eslint-disable-next-line no-console
    console.log('\n=== HU-4.6 · MSP perf summary ===')
    logPerfTable(
      collected.map((r) => ({
        ...r,
        bytes: r.bytes !== undefined ? humanBytes(r.bytes) : undefined,
      })) as PerfResult[],
    )
  })
})
