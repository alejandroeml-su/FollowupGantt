import 'server-only'

/**
 * Wave P18-D · Renderer HTML print-friendly del Status Report PMI.
 *
 * Genera HTML con CSS embebido optimizado para impresión / "Save as PDF"
 * desde el navegador. Evita dependencia de pdfkit/puppeteer (~70-200MB) y
 * permite que el reporte se vea en el browser antes de imprimir.
 *
 * Layout (1 página A4):
 *   - Header con título + fecha
 *   - 4 KPIs principales (% completado, CPI, SPI, riesgos abiertos)
 *   - Tabla EVM (PV/EV/AC/BAC/EAC)
 *   - Top 10 riesgos
 *   - Resumen de calidad (inspecciones + defectos)
 *   - Velocidad de sprints
 */

import type { ProjectReportData } from './queries'

function fmtMoney(v: number | null): string {
  if (v == null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(v)
}

function fmtPct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const STYLES = `
  @page { size: A4; margin: 1.5cm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #1a1a1a;
    margin: 0;
    padding: 24px;
    max-width: 800px;
    margin-inline: auto;
    line-height: 1.4;
    font-size: 12px;
  }
  .actions { display: flex; gap: 8px; margin-bottom: 16px; }
  .actions button {
    background: #4f46e5; color: white; border: 0; padding: 8px 16px;
    border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px;
  }
  .actions button:hover { background: #4338ca; }
  @media print {
    .actions, .no-print { display: none !important; }
    body { padding: 0; }
  }
  h1 { font-size: 22px; margin: 0 0 4px; color: #1e1b4b; }
  h2 { font-size: 14px; margin: 24px 0 8px; color: #1e1b4b;
       border-bottom: 2px solid #4f46e5; padding-bottom: 4px; }
  .subtitle { color: #666; font-size: 11px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11px; }
  th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #e5e7eb; }
  th { background: #f3f4f6; font-weight: 600; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .kpi { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }
  .kpi-label { font-size: 10px; text-transform: uppercase;
               color: #666; font-weight: 600; letter-spacing: 0.5px; }
  .kpi-value { font-size: 24px; font-weight: 700; margin-top: 4px; color: #1e1b4b; }
  .kpi.good .kpi-value { color: #047857; }
  .kpi.warn .kpi-value { color: #ca8a04; }
  .kpi.bad  .kpi-value { color: #b91c1c; }
  .tier-CRITICAL { background: #fecaca; color: #991b1b; }
  .tier-HIGH { background: #fed7aa; color: #9a3412; }
  .tier-MEDIUM { background: #fef3c7; color: #92400e; }
  .tier-LOW { background: #d1fae5; color: #065f46; }
  .badge { padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; }
  footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb;
           color: #999; font-size: 10px; text-align: center; }
`

export function renderStatusReportHtml(data: ProjectReportData): string {
  const taskPct = data.tasks.total > 0 ? data.tasks.done / data.tasks.total : 0
  const cpi = data.evm?.cpi ?? 0
  const spi = data.evm?.spi ?? 0

  const kpiClass = (val: number, good: number, warn: number): string => {
    if (val >= good) return 'good'
    if (val >= warn) return 'warn'
    return 'bad'
  }

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Status Report · ${escapeHtml(data.project.name)}</title>
<style>${STYLES}</style>
</head>
<body>
  <div class="actions no-print">
    <button onclick="window.print()">Imprimir / Guardar PDF</button>
    <button onclick="window.history.back()" style="background:#6b7280">Volver</button>
  </div>

  <header>
    <h1>Status Report · ${escapeHtml(data.project.name)}</h1>
    <p class="subtitle">
      Generado: ${fmtDate(data.generatedAt)}
      · Estado: ${escapeHtml(data.project.status)}
      ${data.project.methodology ? `· Metodología: ${escapeHtml(data.project.methodology)}` : ''}
      · Período: ${fmtDate(data.project.startDate)} → ${fmtDate(data.project.endDate)}
    </p>
  </header>

  <section class="kpis">
    <div class="kpi ${kpiClass(taskPct, 0.7, 0.4)}">
      <div class="kpi-label">% Completado</div>
      <div class="kpi-value">${fmtPct(taskPct, 0)}</div>
      <div style="font-size:10px;color:#666;margin-top:2px">
        ${data.tasks.done} / ${data.tasks.total} tareas
      </div>
    </div>
    <div class="kpi ${kpiClass(cpi, 0.95, 0.85)}">
      <div class="kpi-label">CPI · Cost Performance</div>
      <div class="kpi-value">${cpi.toFixed(2)}</div>
      <div style="font-size:10px;color:#666;margin-top:2px">
        ${cpi >= 1 ? 'Bajo presupuesto' : 'Sobre presupuesto'}
      </div>
    </div>
    <div class="kpi ${kpiClass(spi, 0.95, 0.85)}">
      <div class="kpi-label">SPI · Schedule Performance</div>
      <div class="kpi-value">${spi.toFixed(2)}</div>
      <div style="font-size:10px;color:#666;margin-top:2px">
        ${spi >= 1 ? 'Adelantado' : 'Atrasado'}
      </div>
    </div>
    <div class="kpi ${data.risks.high > 5 ? 'bad' : data.risks.high > 0 ? 'warn' : 'good'}">
      <div class="kpi-label">Riesgos HIGH abiertos</div>
      <div class="kpi-value">${data.risks.high}</div>
      <div style="font-size:10px;color:#666;margin-top:2px">
        ${data.risks.open} total abiertos
      </div>
    </div>
  </section>

  <section>
    <h2>EVM · Earned Value Management</h2>
    ${
      data.evm
        ? `
    <table>
      <thead>
        <tr><th>Métrica</th><th>Valor</th><th>Interpretación</th></tr>
      </thead>
      <tbody>
        <tr><td>PV · Planned Value</td><td>${fmtMoney(data.evm.pv)}</td><td>Costo planeado al día de hoy</td></tr>
        <tr><td>EV · Earned Value</td><td>${fmtMoney(data.evm.ev)}</td><td>Valor entregado real</td></tr>
        <tr><td>AC · Actual Cost</td><td>${fmtMoney(data.evm.ac)}</td><td>Costo real gastado</td></tr>
        <tr><td>BAC · Budget at Completion</td><td>${fmtMoney(data.evm.bac)}</td><td>Presupuesto total</td></tr>
        <tr><td>EAC · Estimate at Completion</td><td>${fmtMoney(data.evm.eac)}</td><td>Estimación al cierre</td></tr>
      </tbody>
    </table>`
        : '<p style="color:#666;font-style:italic">Sin snapshot EVM capturado.</p>'
    }
  </section>

  <section>
    <h2>Top 10 Riesgos</h2>
    ${
      data.risks.topRisks.length === 0
        ? '<p style="color:#666;font-style:italic">Sin riesgos registrados.</p>'
        : `<table>
      <thead><tr><th>Título</th><th>Tier</th><th>Score</th><th>Estado</th></tr></thead>
      <tbody>
        ${data.risks.topRisks
          .map(
            (r) => `
        <tr>
          <td>${escapeHtml(r.title)}</td>
          <td><span class="badge tier-${r.tier}">${r.tier}</span></td>
          <td>${r.score}</td>
          <td>${escapeHtml(r.status)}</td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>`
    }
  </section>

  <section>
    <h2>Calidad</h2>
    <table>
      <thead><tr><th>Métrica</th><th>Valor</th></tr></thead>
      <tbody>
        <tr><td>Inspecciones totales</td><td>${data.inspections.total}</td></tr>
        <tr><td>Inspecciones con PASS</td><td>${data.inspections.pass}</td></tr>
        <tr><td>Inspecciones con FAIL</td><td>${data.inspections.fail}</td></tr>
        <tr><td>Defectos abiertos</td><td>${data.defects.open}</td></tr>
        <tr><td>Defectos críticos abiertos</td><td>${data.defects.critical}</td></tr>
        <tr><td>Defectos resueltos</td><td>${data.defects.fixed}</td></tr>
      </tbody>
    </table>
  </section>

  <section>
    <h2>Velocidad de sprints</h2>
    ${
      data.sprints.length === 0
        ? '<p style="color:#666;font-style:italic">Sin sprints registrados.</p>'
        : `<table>
      <thead><tr><th>Sprint</th><th>Inicio</th><th>Fin</th><th>Status</th><th>Velocity</th></tr></thead>
      <tbody>
        ${data.sprints
          .map(
            (s) => `
        <tr>
          <td>${escapeHtml(s.name)}</td>
          <td>${fmtDate(s.startDate)}</td>
          <td>${fmtDate(s.endDate)}</td>
          <td>${escapeHtml(s.status)}</td>
          <td>${s.velocityActual ?? '—'}</td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>`
    }
  </section>

  <footer>
    Status Report PMI · Sync (FollowupGantt) · Wave P18-D
  </footer>
</body>
</html>`
}
