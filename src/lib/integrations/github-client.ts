/**
 * Wave R5 Extended · US R5E-Marketplace · Cliente GitHub.
 *
 * Distinto de `github.ts` (Ola P4 · parser de referencias + URLs estáticas):
 *   - P4 era 100% local (no llamaba a la API de GitHub).
 *   - R5E llama a la API REST de GitHub con un PAT para:
 *     1. Validar que un issue existe antes de vincular.
 *     2. Comentar en el issue cuando la tarea pasa a DONE.
 *     3. Actualizar el título del issue (manual desde el drawer).
 *
 * NUNCA lanza directamente — todo error vuelve como `{ ok: false, error }`
 * para que el caller decida cómo reportarlo (audit `delivery_failed`,
 * console.warn, etc.) sin abortar la transacción principal.
 */

import type { GithubInstallConfig } from './registry'

const GH_API_BASE = 'https://api.github.com'

export interface GithubApiResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
  status?: number
}

interface GithubIssueShape {
  number: number
  title: string
  state: string
  html_url: string
  pull_request?: unknown
}

/**
 * Headers comunes para todas las llamadas a la API REST de GitHub. El
 * User-Agent es obligatorio (la API rechaza requests sin él).
 */
function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Sync-FollowupGantt/1.0 (+integrations)',
  }
}

/**
 * Verifica que un issue existe. Devuelve la metadata mínima necesaria
 * (number, title, state, html_url). Si el repo es privado y el token no
 * tiene scope, la API devuelve 404 → reportamos `repo_or_issue_not_found`.
 */
export async function fetchIssue(
  config: GithubInstallConfig,
  input: { repoFullName?: string; issueNumber: number },
  fetcher: typeof fetch = fetch,
): Promise<
  GithubApiResult<{
    number: number
    title: string
    state: string
    url: string
    kind: 'ISSUE' | 'PR'
  }>
> {
  const repo = input.repoFullName ?? config.defaultRepo
  if (!repo) {
    return { ok: false, error: 'repo_missing' }
  }
  if (!Number.isInteger(input.issueNumber) || input.issueNumber <= 0) {
    return { ok: false, error: 'invalid_issue_number' }
  }
  let res: Response
  try {
    res = await fetcher(
      `${GH_API_BASE}/repos/${repo}/issues/${input.issueNumber}`,
      { method: 'GET', headers: authHeaders(config.token) },
    )
  } catch (e) {
    return { ok: false, error: `network error: ${(e as Error).message}` }
  }
  if (res.status === 404) {
    return { ok: false, status: 404, error: 'repo_or_issue_not_found' }
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, error: 'github_auth_failed' }
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: `http_${res.status}` }
  }
  let json: GithubIssueShape
  try {
    json = (await res.json()) as GithubIssueShape
  } catch {
    return { ok: false, status: res.status, error: 'non-JSON response' }
  }
  return {
    ok: true,
    data: {
      number: json.number,
      title: json.title,
      state: json.state,
      url: json.html_url,
      kind: json.pull_request ? 'PR' : 'ISSUE',
    },
  }
}

/**
 * Publica un comentario en un issue. Markdown soportado (la API renderiza).
 */
export async function postIssueComment(
  config: GithubInstallConfig,
  input: { repoFullName?: string; issueNumber: number; body: string },
  fetcher: typeof fetch = fetch,
): Promise<GithubApiResult<{ id: number; url: string }>> {
  const repo = input.repoFullName ?? config.defaultRepo
  if (!repo) return { ok: false, error: 'repo_missing' }
  if (!input.body || input.body.trim().length === 0) {
    return { ok: false, error: 'body_empty' }
  }
  let res: Response
  try {
    res = await fetcher(
      `${GH_API_BASE}/repos/${repo}/issues/${input.issueNumber}/comments`,
      {
        method: 'POST',
        headers: {
          ...authHeaders(config.token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: input.body }),
      },
    )
  } catch (e) {
    return { ok: false, error: `network error: ${(e as Error).message}` }
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: `http_${res.status}` }
  }
  let json: { id: number; html_url: string }
  try {
    json = (await res.json()) as { id: number; html_url: string }
  } catch {
    return { ok: false, error: 'non-JSON response' }
  }
  return { ok: true, status: res.status, data: { id: json.id, url: json.html_url } }
}

/**
 * Actualiza el título de un issue (PATCH /repos/.../issues/N). Sólo se
 * invoca manualmente desde el TaskDrawer — no automático para evitar
 * spam (issues con muchos rename quedan ilegibles).
 */
export async function updateIssueTitle(
  config: GithubInstallConfig,
  input: { repoFullName?: string; issueNumber: number; title: string },
  fetcher: typeof fetch = fetch,
): Promise<GithubApiResult<{ number: number; title: string }>> {
  const repo = input.repoFullName ?? config.defaultRepo
  if (!repo) return { ok: false, error: 'repo_missing' }
  if (!input.title || input.title.trim().length === 0) {
    return { ok: false, error: 'title_empty' }
  }
  let res: Response
  try {
    res = await fetcher(
      `${GH_API_BASE}/repos/${repo}/issues/${input.issueNumber}`,
      {
        method: 'PATCH',
        headers: {
          ...authHeaders(config.token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: input.title }),
      },
    )
  } catch (e) {
    return { ok: false, error: `network error: ${(e as Error).message}` }
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: `http_${res.status}` }
  }
  let json: { number: number; title: string }
  try {
    json = (await res.json()) as { number: number; title: string }
  } catch {
    return { ok: false, error: 'non-JSON response' }
  }
  return { ok: true, status: res.status, data: json }
}

/**
 * Verifica la firma HMAC `x-hub-signature-256` de un webhook GitHub. Usa
 * crypto.subtle (Node 20 / Edge runtime). Si `secret` no está configurado,
 * la verificación falla (modo seguro: rechazar todo).
 *
 * GitHub envía `sha256=<hex>` en el header. Comparamos con timing-safe-equal
 * lógico (constant-time string compare manual porque crypto.subtle no
 * expone uno directo en Edge).
 */
export async function verifyGithubWebhookSignature(input: {
  secret: string | undefined
  rawBody: string
  signatureHeader: string | null
}): Promise<boolean> {
  if (!input.secret || !input.signatureHeader) return false
  const expected = input.signatureHeader.startsWith('sha256=')
    ? input.signatureHeader.slice(7)
    : input.signatureHeader
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(input.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(input.rawBody),
  )
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  // Constant-time compare manual.
  if (hex.length !== expected.length) return false
  let mismatch = 0
  for (let i = 0; i < hex.length; i++) {
    mismatch |= hex.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return mismatch === 0
}
