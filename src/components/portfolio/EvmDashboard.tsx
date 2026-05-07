'use client'

/**
 * Wave P10 (HU-10.6 · GAMMA-3.2) — Dashboard EVM consolidado.
 *
 * Muestra cards por proyecto con BAC/EV/AC + indicadores derivados
 * CPI/SPI/EAC y delta VAC. Color rules:
 *  - CPI ≥ 1 → verde · 0.95-1 → ámbar · <0.95 → rojo
 *  - SPI igual
 *  - VAC < 0 → rojo (overrun esperado)
 */

import Link from 'next/link'
import { Download, TrendingDown, TrendingUp } from 'lucide-react'
import type {
  PortfolioFinanceOverview,
  PortfolioFinanceProject,
} from '@/lib/portfolio/finance'

type Props = {
  overview: PortfolioFinanceOverview
}

function fmtMoney(n: number | null, currency = 'USD'): string {
  if (n == null) return '—'
  try {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return `${currency} ${n.toFixed(0)}`
  }
}

function fmtRatio(n: number | null): string {
  if (n == null) return '—'
  return n.toFixed(2)
}

function ratioClass(n: number | null): string {
  if (n == null) return 'text-muted-foreground'
  if (n >= 1) return 'text-emerald-300'
  if (n >= 0.95) return 'text-amber-300'
  return 'text-rose-300'
}

function vacClass(n: number | null): string {
  if (n == null) return 'text-muted-foreground'
  if (n >= 0) return 'text-emerald-300'
  return 'text-rose-300'
}

function ProjectFinanceCard({ p }: { p: PortfolioFinanceProject }) {
  const currency = p.budgetCurrency ?? 'USD'
  return (
    <Link
      href={`/projects/${p.projectId}`}
      className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-indigo-500/50"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="truncate text-sm font-semibold text-foreground group-hover:text-indigo-300">
          {p.projectName}
        </h3>
        {p.managerName && (
          <span className="text-[10px] text-muted-foreground">
            {p.managerName}
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <div className="text-muted-foreground">
          BAC{' '}
          <span className="font-semibold text-foreground">
            {fmtMoney(p.metrics.bac, currency)}
          </span>
        </div>
        <div className="text-muted-foreground">
          AC{' '}
          <span className="font-semibold text-foreground">
            {fmtMoney(p.metrics.ac, currency)}
          </span>
        </div>
        <div className="text-muted-foreground">
          EV{' '}
          <span className="font-semibold text-foreground">
            {fmtMoney(p.metrics.ev, currency)}
          </span>
          {p.evDerived && (
            <span
              className="ml-1 cursor-help text-[9px] text-amber-400"
              title="EV derivado de BAC × progress (no hay Task.earnedValue poblado)"
            >
              ⓘ
            </span>
          )}
        </div>
        <div className="text-muted-foreground">
          PV{' '}
          <span className="font-semibold text-foreground">
            {fmtMoney(p.metrics.pv, currency)}
          </span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/50 pt-3 text-[11px]">
        <div className="text-center">
          <div className="text-[9px] uppercase text-muted-foreground">CPI</div>
          <div
            className={`mt-0.5 inline-flex items-center gap-1 text-sm font-bold ${ratioClass(p.metrics.cpi)}`}
          >
            <TrendingUp className="h-3 w-3" />
            {fmtRatio(p.metrics.cpi)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[9px] uppercase text-muted-foreground">SPI</div>
          <div
            className={`mt-0.5 inline-flex items-center gap-1 text-sm font-bold ${ratioClass(p.metrics.spi)}`}
          >
            <TrendingDown className="h-3 w-3" />
            {fmtRatio(p.metrics.spi)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[9px] uppercase text-muted-foreground">VAC</div>
          <div
            className={`mt-0.5 text-sm font-bold ${vacClass(p.metrics.vac)}`}
          >
            {fmtMoney(p.metrics.vac, currency)}
          </div>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
        <div className="text-muted-foreground">
          EAC{' '}
          <span className="font-semibold text-foreground">
            {fmtMoney(p.metrics.eac, currency)}
          </span>
        </div>
        <div className="text-muted-foreground">
          ETC{' '}
          <span className="font-semibold text-foreground">
            {fmtMoney(p.metrics.etc, currency)}
          </span>
        </div>
      </div>
    </Link>
  )
}

export function EvmDashboard({ overview }: Props) {
  const t = overview.totals
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Total portfolio · EVM agregado
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Suma sobre {overview.projects.length} proyecto
              {overview.projects.length === 1 ? '' : 's'} en USD
            </p>
          </div>
          <a
            href="/api/portfolio/finance/export"
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
            download
          >
            <Download className="h-3.5 w-3.5" />
            Export Excel
          </a>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border bg-input/30 p-3">
            <p className="text-[10px] uppercase text-muted-foreground">BAC</p>
            <p className="mt-1 text-xl font-bold text-foreground">
              {fmtMoney(t.bac)}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-input/30 p-3">
            <p className="text-[10px] uppercase text-muted-foreground">EV</p>
            <p className="mt-1 text-xl font-bold text-foreground">
              {fmtMoney(t.ev)}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-input/30 p-3">
            <p className="text-[10px] uppercase text-muted-foreground">AC</p>
            <p className="mt-1 text-xl font-bold text-foreground">
              {fmtMoney(t.ac)}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-input/30 p-3">
            <p className="text-[10px] uppercase text-muted-foreground">VAC</p>
            <p className={`mt-1 text-xl font-bold ${vacClass(t.vac)}`}>
              {fmtMoney(t.vac)}
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-[9px] uppercase text-muted-foreground">
              CPI
            </div>
            <div className={`text-lg font-bold ${ratioClass(t.cpi)}`}>
              {fmtRatio(t.cpi)}
            </div>
          </div>
          <div>
            <div className="text-[9px] uppercase text-muted-foreground">
              SPI
            </div>
            <div className={`text-lg font-bold ${ratioClass(t.spi)}`}>
              {fmtRatio(t.spi)}
            </div>
          </div>
          <div>
            <div className="text-[9px] uppercase text-muted-foreground">
              EAC
            </div>
            <div className="text-lg font-bold text-foreground">
              {fmtMoney(t.eac)}
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Detalle por proyecto
        </h2>
        {overview.projects.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
            Sin proyectos con datos financieros que mostrar.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {overview.projects.map((p) => (
              <ProjectFinanceCard key={p.projectId} p={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
