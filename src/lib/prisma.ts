import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const prismaClientSingleton = () => {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "❌ CRITICAL ERROR: DATABASE_URL is missing in environment variables. " +
      "Vercel is falling back to localhost (127.0.0.1). " +
      "Please configure DATABASE_URL in Vercel Settings -> Environment Variables and Redeploy."
    );
  }

  // PrismaPg requires a pg.Pool instance, not a generic object
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

declare global {
  var prismaGlobal: undefined | ReturnType<typeof prismaClientSingleton>
}

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton()

export default prisma

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma
