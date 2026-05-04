import { ReportHeader } from './ReportHeader'
import { PrintButton } from './PrintButton'
import { formatIndex, formatMoney } from '@/lib/reports/evm'
import { healthLabel, type PortfolioReport } from '@/lib/reports/portfolio'

/**
 * Ola P5 · Equipo P5-3 · Dashboard ejecutivo de portafolio imprimible.
 */
export function PortfolioView({ data }: { data: PortfolioReport }) {
  const { rows, summary } = data
  return (
    <div className="report-page">
      <div className="report-toolbar no-print" data-print-hide="true">
        <PrintButton label="Imprimir / PDF" />
      </div>

      <ReportHeader
        title="Portafolio ejecutivo"
        subtitle="Salud y avance de proyectos"
        meta={`Generado: ${new Date(data.generatedAt).toLocaleDateString('es-MX')}`}
      />

      <section className="report-section">
        <h2>Resumen</h2>
        <div className="report-kpi-grid">
          <div className="report-kpi">
            <div className="label">Proyectos</div>
            <div className="value">{summary.totalProjects}</div>
          </div>
          <div className="report-kpi">
            <div className="label">Activos</div>
            <div className="value">{summary.activeProjects}</div>
          </div>
          <div className="report-kpi">
            <div className="label">Avance promedio</div>
            <div className="value">{summary.avgProgress}%</div>
          </div>
          <div className="report-kpi">
            <div className="label">SPI / CPI promedio</div>
            <div className="value">
              {formatIndex(summary.avgSPI)} / {formatIndex(summary.avgCPI)}
            </div>
          </div>
        </div>

        <h3>Distribución por salud</h3>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span className="health-pill green">
            Saludable: {summary.healthBreakdown.green}
          </span>
          <span className="health-pill yellow">
            En margen: {summary.healthBreakdown.yellow}
          </span>
          <span className="health-pill red">
            Crítico: {summary.healthBreakdown.red}
          </span>
          <span className="health-pill gray">
            Sin datos: {summary.healthBreakdown.gray}
          </span>
        </div>
      </section>

      <section className="report-section">
        <h2>Proyectos</h2>
        {rows.length === 0 ? (
          <p className="report-empty">No hay proyectos para mostrar.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Proyecto</th>
                <th>Estado</th>
                <th>Salud</th>
                <th>Avance</th>
                <th>Tareas</th>
                <th>SPI</th>
                <th>CPI</th>
                <th>CV</th>
                <th>Próximo hito</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.status}</td>
                  <td>
                    <span className={`health-pill ${r.health}`}>
                      {healthLabel(r.health)}
                    </span>
                  </td>
                  <td>{r.progressPercent}%</td>
                  <td>
                    {r.completedTasks}/{r.totalTasks}
                  </td>
                  <td>{formatIndex(r.spi)}</td>
                  <td>{formatIndex(r.cpi)}</td>
                  <td>{r.cv != null ? formatMoney(r.cv) : '—'}</td>
                  <td>
                    {r.nextMilestone
                      ? `${r.nextMilestone.title} (${r.nextMilestone.daysUntil}d)`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer className="report-section" style={{ marginTop: '2rem', fontSize: '9pt', color: '#6b7280' }}>
        Reglas de salud: rojo si CV&lt;0 ó SPI&lt;0.9 · amarillo si CPI&lt;1 ó
        SPI&lt;1 · verde en otro caso · gris cuando no hay datos suficientes.
      </footer>
    </div>
  )
}
