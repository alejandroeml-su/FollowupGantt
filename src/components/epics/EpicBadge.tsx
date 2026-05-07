/**
 * Wave P9 · Agile Maturity — Badge de Epic reutilizable.
 *
 * Render:
 *   ● Migración Cloud
 *
 * Tres tamaños: 'xs' (lista densa), 'sm' (tabla/kanban), 'md' (drawer).
 *
 * Accesibilidad:
 *   - El nombre del Epic se anuncia por screen reader.
 *   - El dot de color es `aria-hidden` (decorativo).
 *   - title nativo permite tooltip con descripción extendida si la hay.
 */

import { clsx } from 'clsx'

type Props = {
  name: string
  color: string
  description?: string | null
  size?: 'xs' | 'sm' | 'md'
  /** Si true, sólo renderiza el dot (sin nombre). Útil en filas
   *  muy densas donde el nombre se trunca. */
  dotOnly?: boolean
  className?: string
}

const SIZE_STYLES: Record<NonNullable<Props['size']>, string> = {
  xs: 'gap-1 px-1.5 py-0.5 text-[10px]',
  sm: 'gap-1.5 px-2 py-0.5 text-[11px]',
  md: 'gap-2 px-2.5 py-1 text-xs',
}

const DOT_SIZE: Record<NonNullable<Props['size']>, string> = {
  xs: 'h-1.5 w-1.5',
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
}

export function EpicBadge({
  name,
  color,
  description,
  size = 'sm',
  dotOnly = false,
  className,
}: Props) {
  if (dotOnly) {
    return (
      <span
        className={clsx('inline-block rounded-full', DOT_SIZE[size], className)}
        style={{ backgroundColor: color }}
        title={description ? `${name} — ${description}` : name}
        aria-label={`Epic: ${name}`}
      />
    )
  }

  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full font-semibold',
        SIZE_STYLES[size],
        className,
      )}
      style={{
        backgroundColor: `${color}1f`, // ~12% opacity
        color,
        border: `1px solid ${color}59`, // ~35% opacity
      }}
      title={description ? `${name} — ${description}` : `Epic: ${name}`}
    >
      <span
        className={clsx('rounded-full', DOT_SIZE[size])}
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="truncate max-w-[140px]">{name}</span>
    </span>
  )
}
