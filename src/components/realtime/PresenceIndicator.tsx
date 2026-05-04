'use client'

/**
 * PresenceIndicator · Dot pulsante + texto compacto.
 *
 * Wave P6 · Equipo A1.
 *
 * Uso típico:
 *   <PresenceIndicator count={users.length} label="viendo este proyecto" />
 *
 * Si `count === 0` el componente se oculta (devuelve null) — no queremos
 * mostrar "0 viendo" en pantalla; es ruido visual.
 */

type Props = {
  count: number
  /**
   * Texto secundario (e.g. "viendo este proyecto", "editando"). El
   * componente prepende el conteo y selecciona singular/plural.
   */
  label?: string
  /**
   * Override completo del texto. Si se pasa, ignora `count`/`label` y usa
   * este string tal cual. Útil cuando la traducción no admite plural simple.
   */
  text?: string
}

export default function PresenceIndicator({ count, label, text }: Props) {
  if (count <= 0 && !text) return null

  const display =
    text ??
    `${count} ${count === 1 ? 'persona' : 'personas'}${label ? ` ${label}` : ''}`

  return (
    <div
      className="inline-flex items-center gap-2 text-xs text-foreground/75"
      role="status"
      aria-live="polite"
    >
      <span className="relative inline-flex h-2 w-2">
        <span
          aria-hidden
          className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60"
        />
        <span
          aria-hidden
          className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"
        />
      </span>
      <span>{display}</span>
    </div>
  )
}
