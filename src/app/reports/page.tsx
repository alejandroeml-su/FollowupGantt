import Link from 'next/link'
import { LayoutDashboard, FileBarChart, ClipboardList } from 'lucide-react'
import { listAvailableReports } from '@/lib/actions/reports'
import '../print.css'

/**
 * Ola P5 · Equipo P5-3 · Índice de reportes ejecutivos.
 *
 * Lista los reportes disponibles. Para cada proyecto accesible muestra
 * los enlaces a Status Report y EVM. El portafolio sólo se muestra a
 * SUPER_ADMIN/ADMIN/PM.
 */
export const dynamic = 'force-dynamic'

export default async function ReportsIndexPage() {
  const { projects, isAdmin } = await listAvailableReports()

  return (
    <div className="report-page" style={{ paddingTop: '2rem' }}>
      <header className="report-header">
        <div>
          <div className="logo">FollowupGantt</div>
          <h1>Reportes</h1>
          <div style={{ color: '#4b5563', fontSize: '11pt' }}>
            Reportes ejecutivos imprimibles (PDF vía Imprimir del navegador)
          </div>
        </div>
      </header>

      {isAdmin ? (
        <section className="report-section">
          <h2>Portafolio</h2>
          <p>
            <Link href="/reports/portfolio" className="report-link">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                <LayoutDashboard size={14} aria-hidden /> Dashboard ejecutivo
                de portafolio
              </span>
            </Link>
          </p>
        </section>
      ) : null}

      <section className="report-section">
        <h2>Por proyecto</h2>
        {projects.length === 0 ? (
          <p className="report-empty">
            No tienes proyectos asignados. Solicita acceso a un PM/ADMIN.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Proyecto</th>
                <th>Estado</th>
                <th>Estado semanal</th>
                <th>Valor ganado</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.status}</td>
                  <td>
                    <Link href={`/reports/status/${p.id}`}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                        <ClipboardList size={12} aria-hidden /> Estado semanal
                      </span>
                    </Link>
                  </td>
                  <td>
                    <Link href={`/reports/evm/${p.id}`}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                        <FileBarChart size={12} aria-hidden /> EVM
                      </span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
