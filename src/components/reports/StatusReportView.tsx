import { ReportHeader } from './ReportHeader'
import { PrintButton } from './PrintButton'
import type { StatusReportPayload } from '@/lib/actions/reports'

/**
 * Ola P5 · Equipo P5-3 · Status report semanal imprimible.
 */

function formatDateES(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatRange(startISO: string, endISO: string): string {
  const a = new Date(startISO)
  const b = new Date(endISO)
  const fmt = (d: Date) =>
    d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
  return `${fmt(a)} – ${fmt(b)} ${b.getFullYear()}`
}

export function StatusReportView({ data }: { data: StatusReportPayload }) {
  const { project, summary, criticalPath, delayedTasks, topRisks } = data
  return (
    <div className="report-page">
      <div className="report-toolbar no-print" data-print-hide="true">
        <PrintButton label="Imprimir / PDF" />
      </div>

      <ReportHeader
        title={project.name}
        subtitle="Estado semanal del proyecto"
        meta={`Semana ${data.weekOfYear} · ${formatRange(data.periodStart, data.periodEnd)}`}
      />

      <section className="report-section">
        <h2>Resumen ejecutivo</h2>
        <div className="report-kpi-grid">
          <div className="report-kpi">
            <div className="label">Avance global</div>
            <div className="value">{summary.progressPercent}%</div>
          </div>
          <div className="report-kpi">
            <div className="label">Tareas completadas</div>
            <div className="value">
              {summary.completedTasks} / {summary.totalTasks}
            </div>
          </div>
          <div className="report-kpi">
            <div className="label">Hitos próximos</div>
            <div className="value">{summary.upcomingMilestones.length}</div>
          </div>
          <div className="report-kpi">
            <div className="label">Tareas atrasadas</div>
            <div className="value">{delayedTasks.length}</div>
          </div>
        </div>
        <h3>Hitos próximos (7 días)</h3>
        {summary.upcomingMilestones.length === 0 ? (
          <p className="report-empty">No hay hitos en los próximos 7 días.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Hito</th>
                <th>Fecha</th>
                <th>Días</th>
              </tr>
            </thead>
            <tbody>
              {summary.upcomingMilestones.map((m) => (
                <tr key={m.id}>
                  <td>{m.title}</td>
                  <td>{formatDateES(m.endDate)}</td>
                  <td>{m.daysUntil}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="report-section page-break-before">
        <h2>Ruta crítica</h2>
        {criticalPath.length === 0 ? (
          <p className="report-empty">
            CPM no disponible (sin tareas con fechas o dependencias).
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tarea</th>
                <th>Inicio</th>
                <th>Fin</th>
                <th>Avance</th>
                <th>Responsable</th>
              </tr>
            </thead>
            <tbody>
              {criticalPath.map((t) => (
                <tr key={t.id}>
                  <td>{t.title}</td>
                  <td>{formatDateES(t.startDate)}</td>
                  <td>{formatDateES(t.endDate)}</td>
                  <td>{t.progress}%</td>
                  <td>{t.owner ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="report-section">
        <h2>Riesgos abiertos</h2>
        {topRisks.length === 0 ? (
          <p className="report-empty">
            Módulo de riesgos no integrado aún. Sección reservada para top-5
            riesgos cuando esté disponible.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Riesgo</th>
                <th>Severidad</th>
                <th>Descripción</th>
              </tr>
            </thead>
            <tbody>
              {topRisks.slice(0, 5).map((r) => (
                <tr key={r.id}>
                  <td>{r.title}</td>
                  <td>{r.severity}</td>
                  <td>{r.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="report-section">
        <h2>Tareas atrasadas</h2>
        {delayedTasks.length === 0 ? (
          <p className="report-empty">
            No hay tareas con fecha de cierre vencida.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tarea</th>
                <th>Fin planificado</th>
                <th>Días de atraso</th>
                <th>Avance</th>
                <th>Responsable</th>
              </tr>
            </thead>
            <tbody>
              {delayedTasks.map((t) => (
                <tr key={t.id}>
                  <td>{t.title}</td>
                  <td>{formatDateES(t.endDate)}</td>
                  <td>{t.daysOverdue}</td>
                  <td>{t.progress}%</td>
                  <td>{t.owner ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer className="report-section" style={{ marginTop: '2rem', fontSize: '9pt', color: '#6b7280' }}>
        Reporte generado el {new Date(data.generatedAt).toLocaleString('es-MX')}
      </footer>
    </div>
  )
}
