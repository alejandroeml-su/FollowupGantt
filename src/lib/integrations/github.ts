/**
 * Ola P4 · Equipo P4-5 · Integraciones · GitHub.
 *
 * En P4 sólo soportamos vínculos `Task ↔ issue|PR`. NO hay webhooks
 * inbound (eso queda para iteraciones futuras: GitHub App + secret
 * verification). El módulo expone:
 *
 *   - `validateRepoFullName`: regex `owner/repo`.
 *   - `parseGitHubReference`: acepta `123`, `#123`, `https://github.com/owner/repo/issues/123`
 *     y devuelve `{ repoFullName, issueNumber, kind }`.
 *   - `buildIssueUrl` / `buildPrUrl` para que la UI ofrezca enlaces directos.
 *
 * Convenciones:
 *   - Errores tipados `[INVALID_CONFIG]` para validaciones puras.
 *   - Sin llamada de red en P4 (no fetch a la API de GitHub) — el link sólo
 *     se persiste y se muestra como URL clickable. La verificación contra
 *     la API queda diferida.
 */

export type GitHubErrorCode = 'INVALID_CONFIG' | 'INTEGRATION_NOT_FOUND'

const REPO_FULL_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-_.]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9-_.]*[A-Za-z0-9])?$/

/**
 * Devuelve el `repoFullName` validado (`owner/repo`) o lanza
 * `[INVALID_CONFIG]`. Acepta repos con guiones, underscores y puntos.
 */
export function validateRepoFullName(input: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('[INVALID_CONFIG] repoFullName requerido')
  }
  const trimmed = input.trim()
  if (!REPO_FULL_NAME_RE.test(trimmed)) {
    throw new Error(
      '[INVALID_CONFIG] repoFullName debe tener el formato "owner/repo"',
    )
  }
  return trimmed
}

/**
 * Valida que `issueNumber` sea un entero positivo. Acepta string numérica.
 */
export function validateIssueNumber(input: number | string): number {
  const n = typeof input === 'string' ? Number(input) : input
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error('[INVALID_CONFIG] issueNumber debe ser entero positivo')
  }
  return n
}

export interface ParsedGitHubReference {
  repoFullName: string
  issueNumber: number
  kind: 'ISSUE' | 'PR'
}

/**
 * Parsea referencias GitHub flexibles:
 *   - `123`            ⇒ requiere `defaultRepo` para resolver.
 *   - `#123`           ⇒ idem.
 *   - `owner/repo#123` ⇒ ISSUE en owner/repo.
 *   - `https://github.com/owner/repo/issues/123` ⇒ ISSUE.
 *   - `https://github.com/owner/repo/pull/45`    ⇒ PR.
 *
 * Lanza `[INVALID_CONFIG]` con mensaje específico si el shape no encaja.
 */
export function parseGitHubReference(
  reference: string,
  opts: { defaultRepo?: string } = {},
): ParsedGitHubReference {
  if (typeof reference !== 'string' || reference.length === 0) {
    throw new Error('[INVALID_CONFIG] reference requerida')
  }
  const ref = reference.trim()

  // 1) URL directa github.com/<owner>/<repo>/(issues|pull)/<n>
  const urlMatch = ref.match(
    /^https?:\/\/(?:www\.)?github\.com\/([^/]+\/[^/]+)\/(issues|pull)\/(\d+)(?:[/?#].*)?$/i,
  )
  if (urlMatch) {
    const repoFullName = validateRepoFullName(urlMatch[1])
    const kind: 'ISSUE' | 'PR' = urlMatch[2].toLowerCase() === 'pull' ? 'PR' : 'ISSUE'
    const issueNumber = validateIssueNumber(urlMatch[3])
    return { repoFullName, issueNumber, kind }
  }

  // 2) "owner/repo#123" o "owner/repo/123".
  const explicitMatch = ref.match(/^([^/]+\/[^/#]+)[#/](\d+)$/)
  if (explicitMatch) {
    return {
      repoFullName: validateRepoFullName(explicitMatch[1]),
      issueNumber: validateIssueNumber(explicitMatch[2]),
      kind: 'ISSUE',
    }
  }

  // 3) "#123" o "123" — requiere defaultRepo.
  const numericMatch = ref.match(/^#?(\d+)$/)
  if (numericMatch) {
    if (!opts.defaultRepo) {
      throw new Error(
        '[INVALID_CONFIG] referencia numérica requiere defaultRepo (owner/repo)',
      )
    }
    return {
      repoFullName: validateRepoFullName(opts.defaultRepo),
      issueNumber: validateIssueNumber(numericMatch[1]),
      kind: 'ISSUE',
    }
  }

  throw new Error(
    '[INVALID_CONFIG] referencia GitHub no reconocida (usa URL, owner/repo#N o #N con defaultRepo)',
  )
}

/** Construye la URL canónica para un issue. */
export function buildIssueUrl(
  repoFullName: string,
  issueNumber: number,
): string {
  validateRepoFullName(repoFullName)
  validateIssueNumber(issueNumber)
  return `https://github.com/${repoFullName}/issues/${issueNumber}`
}

/** Construye la URL canónica para un PR. */
export function buildPrUrl(
  repoFullName: string,
  issueNumber: number,
): string {
  validateRepoFullName(repoFullName)
  validateIssueNumber(issueNumber)
  return `https://github.com/${repoFullName}/pull/${issueNumber}`
}

/**
 * Devuelve la URL pública correspondiente al `kind` del link. Útil en la
 * UI para abrir el issue/PR en una pestaña nueva.
 */
export function buildLinkUrl(input: {
  repoFullName: string
  issueNumber: number
  kind: string
}): string {
  return input.kind === 'PR'
    ? buildPrUrl(input.repoFullName, input.issueNumber)
    : buildIssueUrl(input.repoFullName, input.issueNumber)
}

/**
 * Valida config de una integración GitHub. En P4 los campos son todos
 * opcionales (la integración por sí sola no dispara nada — sólo guarda
 * `defaultRepo` para autocompletar el TaskGitHubLinkField). Si el caller
 * provee `defaultRepo`, debe ser `owner/repo` válido.
 */
export function validateGitHubConfig(config: unknown): {
  defaultRepo?: string
} {
  if (!config || typeof config !== 'object') {
    throw new Error('[INVALID_CONFIG] config debe ser un objeto')
  }
  const obj = config as Record<string, unknown>
  if (obj.defaultRepo === undefined || obj.defaultRepo === null) {
    return {}
  }
  if (typeof obj.defaultRepo !== 'string') {
    throw new Error('[INVALID_CONFIG] defaultRepo debe ser string')
  }
  return { defaultRepo: validateRepoFullName(obj.defaultRepo) }
}
