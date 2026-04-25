import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const MISSING_DB_URL_MESSAGE =
  '❌ CRITICAL ERROR: DATABASE_URL is missing in environment variables. ' +
  'Vercel is falling back to localhost (127.0.0.1). ' +
  'Please configure DATABASE_URL in Vercel Settings -> Environment Variables and Redeploy.'

const prismaClientSingleton = (): PrismaClient => {
  if (!process.env.DATABASE_URL) {
    // Postergamos el error hasta el primer uso real. Lanzar durante module
    // load rompe `next build` cuando Next colecciona page data sin inyectar
    // DATABASE_URL (Docker CI, Vercel collect step), bloqueando el deploy.
    // Con el proxy se preserva el fail-fast en runtime sin romper el build.
    return new Proxy({} as PrismaClient, {
      get() {
        throw new Error(MISSING_DB_URL_MESSAGE)
      },
    })
  }

  // PrismaPg requires a pg.Pool instance. Limit max:1 to prevent exhausting
  // Supabase connections in serverless environments.
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  })
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

declare global {
  var prismaGlobal: undefined | ReturnType<typeof prismaClientSingleton>
}

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton()

export default prisma

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma
