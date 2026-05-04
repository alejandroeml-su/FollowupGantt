import { ReportHeader } from './ReportHeader'
import { PrintButton } from './PrintButton'
import { EVMBarChart } from './EVMBarChart'
import { classifyHealth, formatIndex, formatMoney } from '@/lib/reports/evm'
import { healthLabel } from '@/lib/reports/portfolio'
import type { EVMReportPayload } from '@/lib/actions/reports'

/**
 * Ola P5 · Equipo P5-3 · Reporte EVM imprimible.
 */
export function EVMReportView({ data }: { data: EVMReportPayload }) {
  const { project, evm } = data
  const health = classifyHealth({ cv: evm.cv, spi: evm.spi, cpi: evm.cpi })

  return (
    <div className="report-page">
      <div className="report-toolbar no-print" data-print-hide="true">
        <PrintButton label="Imprimir / PDF" />
      </div>

      <ReportHeader
        title={project.name}
        subtitle="Reporte de Valor Ganado (EVM)"
        meta={`Generado: ${new Date(evm.asOf).toLocaleDateString('es-MX')}`}
      />

      <section className="report-section">
        <h2>Indicadores principales</h2>
        <div className="report-kpi-grid">
          <div className="report-kpi">
            <div className="label">PV · Valor planificado</div>
            <div className="value">{formatMoney(evm.pv)}</div>
          </div>
          <div className="report-kpi">
            <div className="label">EV · Valor ganado</div>
            <div className="value">{formatMoney(evm.ev)}</div>
          </div>
          <div className="report-kpi">
            <div className="label">
              AC · Costo real{evm.acIsEstimated ? ' (estimado)' : ''}
            </div>
            <div className="value">{formatMoney(evm.ac)}</div>
          </div>
          <div className="report-kpi">
            <div className="label">BAC · Presupuesto total</div>
            <div className="value">{formatMoney(evm.bac)}</div>
          </div>
        </div>

        <div className="report-kpi-grid">
          <div className="report-kpi">
            <div className="label">SV · Variación de cronograma</div>
            <div className="value">{formatMoney(evm.sv)}</div>
          </div>
          <div className="report-kpi">
            <div className="label">CV · Variación de costo</div>
            <div className="value">{formatMoney(evm.cv)}</div>
          </div>
          <div className="report-kpi">
            <div className="label">SPI</div>
            <div className="value">{formatIndex(evm.spi)}</div>
          </div>
          <div className="report-kpi">
            <div className="label">CPI</div>
            <div className="value">{formatIndex(evm.cpi)}</div>
          </div>
        </div>

        <p style={{ marginTop: '0.5rem' }}>
          Salud:{' '}
          <span className={`health-pill ${health}`}>{healthLabel(health)}</span>
          {evm.acIsEstimated ? (
            <span style={{ marginLeft: '0.5rem', color: '#6b7280', fontSize: '10pt' }}>
              · AC estimado a partir de EV (sin actualCost en BD).
            </span>
          ) : null}
        </p>
      </section>

      <section className="report-section">
        <h2>Comparativa PV / EV / AC</h2>
        <EVMBarChart pv={evm.pv} ev={evm.ev} ac={evm.ac} />
        {evm.eac != null ? (
          <p style={{ marginTop: '0.75rem', fontSize: '10pt' }}>
            Estimación al cierre (EAC): <strong>{formatMoney(evm.eac)}</strong>{' '}
            · VAC: <strong>{formatMoney(evm.vac)}</strong>
          </p>
        ) : null}
      </section>

      <section className="report-section page-break-before">
        <h2>Detalle por tarea</h2>
        {evm.perTask.length === 0 ? (
          <p className="report-empty">Sin tareas con presupuesto asignado.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tarea</th>
                <th>Avance</th>
                <th>PV</th>
                <th>EV</th>
                <th>AC</th>
                <th>SV</th>
                <th>CV</th>
              </tr>
            </thead>
            <tbody>
              {evm.perTask.map((t) => (
                <tr key={t.id}>
                  <td>{t.title}</td>
                  <td>{t.progress}%</td>
                  <td>{formatMoney(t.pv)}</td>
                  <td>{formatMoney(t.ev)}</td>
                  <td>{formatMoney(t.ac)}</td>
                  <td>{formatMoney(t.sv)}</td>
                  <td>{formatMoney(t.cv)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer className="report-section" style={{ marginTop: '2rem', fontSize: '9pt', color: '#6b7280' }}>
        Tareas: {evm.taskCount} (presupuestadas: {evm.budgetedTaskCount}).
        Fórmulas PMBOK: SV=EV-PV · CV=EV-AC · SPI=EV/PV · CPI=EV/AC · EAC=BAC/CPI.
      </footer>
    </div>
  )
}
