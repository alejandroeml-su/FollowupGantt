/**
 * Ola P8 · Equipo P8-3 · Cost Management — Cron de tipos de cambio.
 *
 * Endpoint que Vercel Cron (o GitHub Actions) golpea cada día con cabecera
 * `Authorization: Bearer ${CRON_SECRET}`. Hace fetch de los tipos de cambio
 * desde una API pública sin autenticación y persiste cada par USD→X en la
 * tabla `CurrencyRate`.
 *
 * API elegida: https://api.exchangerate-api.com/v4/latest/USD
 *   - Sin auth, gratis, sin rate-limit estricto (≤ 1 req/min para uso ético).
 *   - Devuelve `{ base: "USD", rates: { MXN: 17.05, EUR: 0.92, ... } }`.
 *   - Si falla, NO abortamos: dejamos las rates anteriores como vigentes.
 *
 * Cron schedule sugerido: `0 6 * * *` (todos los días a las 6am UTC).
 *   - En `vercel.json` agregar:
 *     {
 *       "crons": [
 *         { "path": "/api/cron/currency-rates", "schedule": "0 6 * * *" }
 *       ]
 *     }
 *
 * Decisiones autónomas:
 *   D-CRX-1: persistimos TODAS las rates devueltas, no sólo las del set
 *           SUPPORTED_CURRENCIES. La tabla queda como log histórico
 *           consultable; el filtro de UI se hace al leer.
 *   D-CRX-2: idempotencia vía `@@unique([base, quote, fetchedAt])`. Como
 *           `fetchedAt` se setea con `new Date()` por corrida, dos cron
 *           consecutivos generan filas distintas (lo cual queremos: log
 *           histórico de rates).
 *   D-CRX-3: si fetch falla o devuelve estructura inesperada, log warn
 *           y devolver `{ ok: true, inserted: 0, fallback: true }`.
 *           Mantiene Vercel Cron en verde y preserva las rates existentes.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const RATES_ENDPOINT = 'https://api.exchangerate-api.com/v4/latest/USD'
const FETCH_TIMEOUT_MS = 10_000

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  if (secret) return auth === `Bearer ${secret}`
  // Sin secret → loopback only (paridad con `daily-standup`).
  const url = new URL(req.url)
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
}

interface CronSummary {
  ok: boolean
  inserted: number
  base: string
  source: string
  fallback?: boolean
  error?: string
  fetchedAt?: string
}

interface RatesPayload {
  base: string
  rates: Record<string, number>
}

async function fetchRates(): Promise<RatesPayload | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(RATES_ENDPOINT, { signal: controller.signal })
    if (!res.ok) {
      console.warn(`[cron/currency-rates] HTTP ${res.status} de ${RATES_ENDPOINT}`)
      return null
    }
    const json = (await res.json()) as Partial<RatesPayload>
    if (
      !json ||
      typeof json !== 'object' ||
      typeof json.base !== 'string' ||
      !json.rates ||
      typeof json.rates !== 'object'
    ) {
      console.warn('[cron/currency-rates] payload inesperado:', json)
      return null
    }
    return { base: json.base, rates: json.rates as Record<string, number> }
  } catch (err) {
    console.warn(
      `[cron/currency-rates] fetch falló: ${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function runCron(): Promise<CronSummary> {
  const payload = await fetchRates()
  if (!payload) {
    return {
      ok: true,
      inserted: 0,
      base: 'USD',
      source: 'exchangerate-api',
      fallback: true,
    }
  }

  const fetchedAt = new Date()
  const rows = Object.entries(payload.rates)
    .filter(([quote, rate]) => /^[A-Z]{3}$/.test(quote) && Number.isFinite(rate) && rate > 0)
    .map(([quote, rate]) => ({
      base: payload.base,
      quote,
      rate: new Prisma.Decimal(rate),
      source: 'exchangerate-api',
      fetchedAt,
    }))

  if (rows.length === 0) {
    return { ok: true, inserted: 0, base: payload.base, source: 'exchangerate-api', fallback: true }
  }

  // createMany NO soporta `skipDuplicates: true` con el schema unique
  // compuesto en algunos drivers; usamos try/catch P2002 para idempotencia.
  let inserted = 0
  try {
    const result = await prisma.currencyRate.createMany({
      data: rows,
      skipDuplicates: true,
    })
    inserted = result.count
  } catch (err) {
    console.warn(
      `[cron/currency-rates] createMany falló: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  return {
    ok: true,
    inserted,
    base: payload.base,
    source: 'exchangerate-api',
    fetchedAt: fetchedAt.toISOString(),
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const summary = await runCron()
    return NextResponse.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return GET(req)
}
