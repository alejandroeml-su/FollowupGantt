/**
 * P3-4 · Helper de seed para Docs / Wikis (Ola P2-5) en la suite E2E.
 *
 * Crea un Doc inicial (con autor obligatorio) y opcionalmente una versión
 * histórica para tests de "Restaurar versión". El cleanup borra Doc +
 * DocVersion en cascada (FK ON DELETE Cascade).
 */

import { createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const E2E_DOC_PREFIX = 'e2e_doc_'
let cachedClient: PrismaClient | null = null

function ensureEnvLoaded(): void {
  if (process.env.DATABASE_URL) return
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dotenv = require('dotenv') as typeof import('dotenv')
  dotenv.config({ path: '.env.local' })
  if (!process.env.DATABASE_URL) dotenv.config({ path: '.env' })
}

function getClient(): PrismaClient {
  if (cachedClient) return cachedClient
  ensureEnvLoaded()
  if (!process.env.DATABASE_URL) {
    throw new Error('[E2E_DOC_NO_DB] DATABASE_URL no disponible')
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  const adapter = new PrismaPg(pool)
  cachedClient = new PrismaClient({ adapter })
  return cachedClient
}

function docId(slug: string): string {
  const hash = createHash('sha256').update(`doc:${slug}`).digest('hex').slice(0, 16)
  return `${E2E_DOC_PREFIX}${hash}`
}

export interface SeedDocOptions {
  /** Slug interno para el id determinístico. */
  slug: string
  authorId: string
  title?: string
  content?: string
  /** Crea una version histórica adicional para tests de restore. */
  withHistoricalVersion?: boolean
  parentDocSlug?: string
}

export interface SeedDocResult {
  docId: string
  versionIds: string[]
}

export async function seedDoc(options: SeedDocOptions): Promise<SeedDocResult> {
  const prisma = getClient()
  const id = docId(options.slug)
  const title = options.title ?? `[E2E Doc] ${options.slug}`
  const content = options.content ?? `# ${title}\n\nContenido inicial.`
  const parentId = options.parentDocSlug ? docId(options.parentDocSlug) : null

  await prisma.doc.upsert({
    where: { id },
    update: {
      title,
      content,
      parentId,
      isArchived: false,
      lastEditorId: options.authorId,
    },
    create: {
      id,
      title,
      content,
      authorId: options.authorId,
      parentId,
      position: 1,
    },
  })

  const versionIds: string[] = []
  if (options.withHistoricalVersion) {
    const v = await prisma.docVersion.create({
      data: {
        docId: id,
        content: `# Version histórica\n\nContenido antiguo.`,
        authorId: options.authorId,
        changeNote: 'Snapshot inicial E2E',
      },
      select: { id: true },
    })
    versionIds.push(v.id)
  }

  return { docId: id, versionIds }
}

export async function cleanupDocSeed(slug: string): Promise<void> {
  const prisma = getClient()
  const id = docId(slug)
  // DocVersion cascadea por FK; borrar Doc es suficiente.
  await prisma.docVersion.deleteMany({ where: { docId: id } }).catch(() => {})
  await prisma.doc.deleteMany({ where: { id } }).catch(() => {})
}

export async function disconnectDocClient(): Promise<void> {
  if (cachedClient) {
    await cachedClient.$disconnect()
    cachedClient = null
  }
}
