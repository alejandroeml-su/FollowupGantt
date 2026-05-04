import { test, expect } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import {
  cleanupAuthSeed,
  disconnectAuthClient,
  seedAuthUser,
} from './_helpers/seed-auth'
import { cleanupSeed, makeGanttFixture, seedProject } from './_helpers/seed'

/**
 * Ola P4 · Equipo P4-2 · API REST v1 + ApiToken auth — E2E.
 *
 * Cubre:
 *   - Happy path: token con scope `tasks:read` accede a
 *     `GET /api/v1/projects/<id>/tasks` con HTTP 200.
 *   - Edge: token sin scope adecuado recibe HTTP 403 [FORBIDDEN].
 *   - Error: request sin Authorization header recibe HTTP 401 [UNAUTHORIZED].
 */

const TOKEN_OWNER_EMAIL = 'api-tokens-owner@e2e.test'
const FIXTURE = makeGanttFixture('apitokens')

let cachedClient: PrismaClient | null = null
function getDb(): PrismaClient {
  if (cachedClient) return cachedClient
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dotenv = require('dotenv') as typeof import('dotenv')
    dotenv.config({ path: '.env.local' })
    if (!process.env.DATABASE_URL) dotenv.config({ path: '.env' })
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  cachedClient = new PrismaClient({ adapter: new PrismaPg(pool) })
  return cachedClient
}

interface SeededToken {
  plaintext: string
  id: string
}

async function seedApiToken(
  userId: string,
  scopes: string[],
  name: string,
): Promise<SeededToken> {
  const db = getDb()
  const body = randomBytes(32).toString('base64url')
  const plaintext = `fg_${body}`
  const tokenHash = createHash('sha256').update(plaintext).digest('hex')
  const prefix = plaintext.slice(0, 12)
  const created = await db.apiToken.create({
    data: { name, tokenHash, prefix, scopes, userId },
    select: { id: true },
  })
  return { plaintext, id: created.id }
}

test.describe('API tokens · /api/v1', () => {
  test.afterAll(async () => {
    const db = getDb()
    await db.apiToken
      .deleteMany({ where: { user: { email: TOKEN_OWNER_EMAIL } } })
      .catch(() => {})
    await cleanupSeed(FIXTURE).catch(() => {})
    await cleanupAuthSeed(TOKEN_OWNER_EMAIL).catch(() => {})
    await db.$disconnect().catch(() => {})
    await disconnectAuthClient().catch(() => {})
  })

  test('happy path: token con tasks:read recibe 200 en GET tasks', async ({
    request,
  }) => {
    const owner = await seedAuthUser(TOKEN_OWNER_EMAIL, 'ADMIN')
    await seedProject(FIXTURE)
    const token = await seedApiToken(
      owner.userId,
      ['tasks:read', 'projects:read'],
      'E2E read token',
    )

    const res = await request.get(
      `/api/v1/projects/${FIXTURE.projectId}/tasks`,
      {
        headers: { Authorization: `Bearer ${token.plaintext}` },
      },
    )
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.data)).toBe(true)
    // Hay al menos las 3 tasks seedeadas en el fixture.
    expect(body.data.length).toBeGreaterThanOrEqual(3)
  })

  test('edge: token sin scope tasks:read recibe 403', async ({ request }) => {
    const owner = await seedAuthUser(TOKEN_OWNER_EMAIL, 'ADMIN')
    await seedProject(FIXTURE)
    const token = await seedApiToken(
      owner.userId,
      ['baselines:read'], // no incluye tasks:read.
      'E2E baselines token',
    )

    const res = await request.get(
      `/api/v1/projects/${FIXTURE.projectId}/tasks`,
      {
        headers: { Authorization: `Bearer ${token.plaintext}` },
      },
    )
    expect(res.status()).toBe(403)
    const body = await res.json()
    expect(body.error?.code ?? '').toMatch(/FORBIDDEN/)
  })

  test('error: sin Authorization header recibe 401', async ({ request }) => {
    await seedProject(FIXTURE)
    const res = await request.get(
      `/api/v1/projects/${FIXTURE.projectId}/tasks`,
    )
    expect(res.status()).toBe(401)
    const body = await res.json()
    expect(body.error?.code ?? '').toMatch(/UNAUTHORIZED/)
  })
})
