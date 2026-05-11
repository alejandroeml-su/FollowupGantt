import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Wave R4-C · DirectQuery Power BI · smoke tests del migration SQL.
 *
 * No corremos las views contra una DB real (sería un test de integración,
 * fuera del scope de la suite unit). En vez, validamos que el SQL es bien
 * formado: cada vista esperada está definida con CREATE OR REPLACE, no
 * expone columnas PII conocidas, y los grants apuntan al rol correcto.
 *
 * Si una iteración futura cambia el shape de una vista, este test fallará
 * y forzará al autor a actualizar los assertions — protege contra
 * regresiones que filtren PII por accidente.
 */

const MIGRATION_PATH = resolve(
  __dirname,
  '../../prisma/migrations/20260511_r4c_bi_views_powerbi/migration.sql'
)

const SQL = readFileSync(MIGRATION_PATH, 'utf-8')

const EXPECTED_VIEWS = [
  'projects_view',
  'tasks_view',
  'sprints_view',
  'risks_view',
  'audit_view',
  'evm_snapshots_view',
  'allocations_view',
] as const

// Campos PII que NUNCA deben aparecer como columnas seleccionadas en las
// vistas. Estos son los nombres como aparecen en `public.*` con quoting.
const FORBIDDEN_PII_COLUMNS = [
  // User secrets
  '"password"',
  '"twoFactorSecret"',
  '"emailVerified"',
  // Session / API key tokens
  '"token"',
  '"hash"',
  // Audit raw Json snapshots
  '"before"',
  '"after"',
  '"metadata"',
  // Project Json descriptions
  '"charter"',
  '"productGoal"',
  '"dorTemplate"',
  '"dodTemplate"',
  '"communicationsPlan"',
] as const

describe('Wave R4-C · bi.* views SQL migration', () => {
  it('creates the bi schema idempotently', () => {
    expect(SQL).toMatch(/CREATE SCHEMA IF NOT EXISTS "bi"/i)
  })

  it('creates all 7 expected views with CREATE OR REPLACE (idempotent)', () => {
    for (const view of EXPECTED_VIEWS) {
      const re = new RegExp(
        `CREATE\\s+OR\\s+REPLACE\\s+VIEW\\s+"bi"\\."${view}"`,
        'i'
      )
      expect(SQL).toMatch(re)
    }
  })

  it('exposes workspace_id in every view (push-down filter)', () => {
    // workspace_id puede venir directo o renombrado desde "workspaceId".
    for (const view of EXPECTED_VIEWS) {
      // Localizamos el bloque CREATE VIEW ... AS SELECT ... FROM
      const blockMatch = SQL.match(
        new RegExp(
          `CREATE\\s+OR\\s+REPLACE\\s+VIEW\\s+"bi"\\."${view}"\\s+AS([\\s\\S]*?);`,
          'i'
        )
      )
      expect(blockMatch, `view ${view} not found`).toBeTruthy()
      const body = blockMatch![1]
      expect(body, `view ${view} should expose workspace_id`).toMatch(
        /workspace_id/
      )
    }
  })

  it('never exposes PII columns directly', () => {
    // Por cada columna forbidden, verificamos que no aparece como
    // expresión `t."password"` o similar en SELECT lists. Permitimos
    // que aparezca en comentarios `--` y en strings de COMMENT ON.
    const stripped = SQL
      // remove single-line comments
      .replace(/--[^\n]*/g, '')
      // remove COMMENT ON ... 'literal' statements (que mencionan PII en
      // texto explicativo, lo cual está OK).
      .replace(/COMMENT\s+ON[\s\S]+?;/gi, '')

    for (const forbidden of FORBIDDEN_PII_COLUMNS) {
      expect(
        stripped.includes(forbidden),
        `PII column ${forbidden} should not appear in any bi view`
      ).toBe(false)
    }
  })

  it('creates the powerbi_readonly role with NOLOGIN by default', () => {
    expect(SQL).toMatch(/CREATE ROLE "powerbi_readonly" NOLOGIN/i)
  })

  it('grants USAGE on bi + SELECT on every view to powerbi_readonly', () => {
    expect(SQL).toMatch(/GRANT USAGE ON SCHEMA "bi" TO "powerbi_readonly"/i)
    for (const view of EXPECTED_VIEWS) {
      const re = new RegExp(
        `GRANT SELECT ON "bi"\\."${view}"\\s+TO "powerbi_readonly"`,
        'i'
      )
      expect(SQL, `missing SELECT grant on bi.${view}`).toMatch(re)
    }
  })

  it('revokes ALL on public schema from powerbi_readonly (defensive)', () => {
    expect(SQL).toMatch(
      /REVOKE ALL ON SCHEMA "public" FROM "powerbi_readonly"/i
    )
  })

  it('redacts IP addresses in audit_view to /24 (no raw octet exposure)', () => {
    // El bloque audit_view debe transformar ipAddress, no exponerlo raw.
    const auditMatch = SQL.match(
      /CREATE\s+OR\s+REPLACE\s+VIEW\s+"bi"\."audit_view"\s+AS([\s\S]*?);/i
    )
    expect(auditMatch).toBeTruthy()
    const body = auditMatch![1]
    // Debe usar regexp_replace o similar para enmascarar el último octeto.
    expect(body).toMatch(/regexp_replace/i)
    expect(body).toMatch(/ip_subnet/)
    // No debe exponer la columna raw "ipAddress" como AS ipAddress / AS ip_address.
    expect(body).not.toMatch(/a\."ipAddress"\s+AS\s+"ip_address"/i)
  })

  it('risks_view exposes derived score and severity tier', () => {
    const risksMatch = SQL.match(
      /CREATE\s+OR\s+REPLACE\s+VIEW\s+"bi"\."risks_view"\s+AS([\s\S]*?);/i
    )
    expect(risksMatch).toBeTruthy()
    const body = risksMatch![1]
    // Score derivado P × I (puede venir con alias de tabla prefijado).
    expect(body).toMatch(/"probability"\s*\*\s*\w*\.?"impact"/)
    // Severity tier via CASE.
    expect(body).toMatch(/severity/)
    expect(body).toMatch(/CRITICAL/)
  })
})
