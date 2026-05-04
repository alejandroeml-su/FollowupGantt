import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

/**
 * Ola P5 · Equipo P5-5 · PublicForms — E2E SIN AUTH.
 *
 * Endpoint público `/forms/<slug>` y `POST /api/forms/<slug>/submit`.
 *
 * Cubre:
 *   - Happy path: submission válido persiste FormSubmission con IP.
 *   - Edge: honeypot disparado ⇒ HTTP 400 con HONEYPOT_TRIGGERED.
 *   - Error: form inactivo ⇒ HTTP 400 con FORM_INACTIVE.
 *
 * Estrategia: insertamos un PublicForm directamente vía Prisma (slug
 * único E2E) y posteamos al endpoint. Esto evita la UI admin que
 * requiere auth + validación de schema.
 */

const ACTIVE_SLUG = 'e2e-c3-public-form'
const INACTIVE_SLUG = 'e2e-c3-public-form-off'

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

async function seedPublicForm(args: {
  slug: string
  isActive: boolean
}): Promise<string> {
  const db = getDb()
  const formId = `e2e_form_${args.slug}`
  const schema = [
    { name: 'nombre', type: 'text', label: 'Nombre', required: true },
    { name: 'email', type: 'email', label: 'Email', required: false },
  ]
  await db.publicForm.upsert({
    where: { id: formId },
    update: {
      slug: args.slug,
      title: `[E2E] ${args.slug}`,
      schema,
      isActive: args.isActive,
    },
    create: {
      id: formId,
      slug: args.slug,
      title: `[E2E] ${args.slug}`,
      description: 'Form E2E generado por C3.',
      schema,
      isActive: args.isActive,
    },
  })
  return formId
}

test.describe('Public forms', () => {
  test.afterAll(async () => {
    const db = getDb()
    const ids = [`e2e_form_${ACTIVE_SLUG}`, `e2e_form_${INACTIVE_SLUG}`]
    await db.formSubmission
      .deleteMany({ where: { formId: { in: ids } } })
      .catch(() => {})
    await db.publicForm.deleteMany({ where: { id: { in: ids } } }).catch(() => {})
    await db.$disconnect().catch(() => {})
  })

  test('happy path: submission válido devuelve { ok: true, submissionId }', async ({
    request,
  }) => {
    await seedPublicForm({ slug: ACTIVE_SLUG, isActive: true })

    const res = await request.post(`/api/forms/${ACTIVE_SLUG}/submit`, {
      data: { nombre: 'Edwin E2E', email: 'edwin@e2e.test' },
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.submissionId).toBe('string')

    // FormSubmission debe estar persistida con la IP del cliente.
    const db = getDb()
    const persisted = await db.formSubmission.findUnique({
      where: { id: body.submissionId },
      select: { id: true, payload: true, ip: true },
    })
    expect(persisted).toBeTruthy()
    expect((persisted?.payload as Record<string, unknown>)?.nombre).toBe(
      'Edwin E2E',
    )
  })

  test('edge: honeypot disparado retorna HTTP 400 con HONEYPOT_TRIGGERED', async ({
    request,
  }) => {
    await seedPublicForm({ slug: ACTIVE_SLUG, isActive: true })

    const res = await request.post(`/api/forms/${ACTIVE_SLUG}/submit`, {
      data: {
        nombre: 'Spam Bot',
        email: 'bot@spam.test',
        // El honeypot field se llama `website_url` (HONEYPOT_FIELD_NAME).
        website_url: 'http://malicious.example',
      },
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(String(body.error ?? '')).toMatch(/HONEYPOT_TRIGGERED/)
  })

  test('error: form inactivo retorna HTTP 400 con FORM_INACTIVE', async ({
    request,
  }) => {
    await seedPublicForm({ slug: INACTIVE_SLUG, isActive: false })

    const res = await request.post(`/api/forms/${INACTIVE_SLUG}/submit`, {
      data: { nombre: 'No-go' },
      headers: { 'content-type': 'application/json' },
    })
    // El endpoint mapea FORM_INACTIVE a 400.
    expect([400, 404]).toContain(res.status())
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(String(body.error ?? '')).toMatch(/FORM_INACTIVE|FORM_NOT_FOUND/)
  })
})
