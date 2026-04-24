import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok', ts: new Date().toISOString() })
  } catch (err) {
    return NextResponse.json(
      { status: 'degraded', error: String(err) },
      { status: 503 },
    )
  }
}
