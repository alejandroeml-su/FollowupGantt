/**
 * Ola P5 · Equipo P5-3.
 *
 * Cabecera estándar de los reportes ejecutivos: "logo" textual + nombre
 * del proyecto + período. Server component (sin estado).
 */
export function ReportHeader({
  title,
  subtitle,
  meta,
}: {
  title: string
  subtitle?: string
  meta?: string
}) {
  return (
    <header className="report-header">
      <div>
        <div className="logo">FollowupGantt</div>
        <h1>{title}</h1>
        {subtitle ? <div style={{ color: '#4b5563', fontSize: '11pt' }}>{subtitle}</div> : null}
      </div>
      {meta ? <div className="meta">{meta}</div> : null}
    </header>
  )
}
