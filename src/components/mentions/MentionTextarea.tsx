'use client'

/**
 * Wave P9 — Componente reutilizable que envuelve `<textarea>` y agrega
 * autocompletado de menciones `@usuario` con dropdown navegable por teclado.
 *
 * UX:
 *   - El usuario teclea `@` y aparece dropdown debajo del textarea con la
 *     lista de usuarios filtrada por lo que va escribiendo después de `@`.
 *   - Flechas ↑/↓ para navegar, Enter o Tab para seleccionar, Esc cierra.
 *   - Click directo en una opción también selecciona.
 *   - Si el handle escrito no coincide con nadie, se acepta literal (el
 *     server hace lookup por name/email, así que `@todos` sigue funcionando).
 *
 * Diseño:
 *   - API espejo de `<textarea>` nativo: `value`, `onChange`, `placeholder`,
 *     `disabled`, `rows`, `className`.
 *   - `users` se inyecta desde el padre (server-fetched, sin /api round-trip).
 *   - `onMentionInsert?` callback opcional cuando se inserta una mención —
 *     útil para tracking analytics.
 *   - Sin dependencias externas. La detección del trigger usa el cursor
 *     position del textarea + regex para encontrar el último `@` no escapado.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from 'react'

export type MentionUser = {
  id: string
  name: string
  email?: string | null
  avatarUrl?: string | null
}

export type MentionTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'onChange'
> & {
  value: string
  onChange: (next: string) => void
  /** Lista de usuarios para autocompletar (típicamente todos los del workspace). */
  users: MentionUser[]
  /** Callback opcional al insertar una mención. */
  onMentionInsert?: (user: MentionUser) => void
}

type DropdownState =
  | { open: false }
  | {
      open: true
      /** Posición en el value donde está el `@` que disparó el trigger. */
      triggerStart: number
      /** Texto entre el `@` y el cursor (lo que el usuario va tecleando). */
      query: string
      /** Índice del item seleccionado en la lista filtrada. */
      activeIndex: number
    }

const MAX_RESULTS = 8

function findTriggerAtCursor(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  // Busca hacia atrás desde el cursor hasta el primer `@` precedido por
  // whitespace o inicio de string. Si encontramos un espacio antes del `@`,
  // no hay trigger.
  for (let i = cursor - 1; i >= 0; i--) {
    const ch = text[i]
    if (ch === '@') {
      const before = i === 0 ? '' : text[i - 1]
      // Sólo dispara si el `@` está al inicio o tras whitespace/puntuación.
      if (before === '' || /[\s(\[{]/.test(before)) {
        const query = text.slice(i + 1, cursor)
        // Si el query contiene whitespace, ya pasamos el handle.
        if (/\s/.test(query)) return null
        return { start: i, query }
      }
      return null
    }
    // Si encontramos whitespace o newline antes de un `@`, no hay trigger.
    if (/\s/.test(ch)) return null
  }
  return null
}

function filterUsers(users: MentionUser[], query: string): MentionUser[] {
  const q = query.trim().toLowerCase()
  if (!q) return users.slice(0, MAX_RESULTS)
  return users
    .filter((u) => {
      const name = u.name.toLowerCase()
      const email = (u.email ?? '').toLowerCase()
      return name.includes(q) || email.includes(q)
    })
    .slice(0, MAX_RESULTS)
}

export const MentionTextarea = forwardRef<HTMLTextAreaElement, MentionTextareaProps>(
  function MentionTextarea(
    { value, onChange, users, onMentionInsert, className, onKeyDown, ...rest },
    ref,
  ) {
    const internalRef = useRef<HTMLTextAreaElement | null>(null)
    const [dropdown, setDropdown] = useState<DropdownState>({ open: false })

    const setRefs = useCallback(
      (el: HTMLTextAreaElement | null) => {
        internalRef.current = el
        if (typeof ref === 'function') ref(el)
        else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
      },
      [ref],
    )

    const filtered = useMemo(
      () => (dropdown.open ? filterUsers(users, dropdown.query) : []),
      [dropdown, users],
    )

    const handleChange = useCallback(
      (e: ChangeEvent<HTMLTextAreaElement>) => {
        const next = e.target.value
        onChange(next)
        const cursor = e.target.selectionStart ?? next.length
        const trigger = findTriggerAtCursor(next, cursor)
        if (trigger) {
          setDropdown({
            open: true,
            triggerStart: trigger.start,
            query: trigger.query,
            activeIndex: 0,
          })
        } else if (dropdown.open) {
          setDropdown({ open: false })
        }
      },
      [onChange, dropdown.open],
    )

    const insertMention = useCallback(
      (user: MentionUser) => {
        if (!dropdown.open) return
        // Reemplaza desde `@<query>` hasta el cursor con `@<name> `.
        const ta = internalRef.current
        if (!ta) return
        const cursor = ta.selectionStart ?? value.length
        const before = value.slice(0, dropdown.triggerStart)
        const after = value.slice(cursor)
        // Usamos el name del user (sin espacios → reemplazamos por `_`?)
        // No: el server hace lookup por name exacto, así que mantenemos
        // el name tal cual. Si tiene espacios, el regex del parser sólo
        // matchea hasta el primer espacio — DEUDA conocida, post-MVP
        // se puede mejorar usando id (`@[<id>:nombre]`) o IDs Markdown.
        const handle = user.name.split(/\s+/)[0]
        const insertion = `@${handle} `
        const next = before + insertion + after
        onChange(next)
        setDropdown({ open: false })
        onMentionInsert?.(user)
        // Reposicionar cursor después de la mención insertada.
        const newCursor = before.length + insertion.length
        requestAnimationFrame(() => {
          ta.focus()
          ta.setSelectionRange(newCursor, newCursor)
        })
      },
      [dropdown, value, onChange, onMentionInsert],
    )

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLTextAreaElement>) => {
        // Permitir que el padre maneje shortcuts globales primero.
        onKeyDown?.(e)
        if (e.defaultPrevented) return
        if (!dropdown.open) return
        if (filtered.length === 0) return
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setDropdown({
            ...dropdown,
            activeIndex: (dropdown.activeIndex + 1) % filtered.length,
          })
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setDropdown({
            ...dropdown,
            activeIndex:
              (dropdown.activeIndex - 1 + filtered.length) % filtered.length,
          })
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          insertMention(filtered[dropdown.activeIndex])
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setDropdown({ open: false })
        }
      },
      [dropdown, filtered, insertMention, onKeyDown],
    )

    // Cerrar dropdown si el componente pierde focus.
    useEffect(() => {
      const ta = internalRef.current
      if (!ta) return
      const onBlur = () => {
        // Pequeño delay para permitir que el click en una opción dispare antes.
        setTimeout(() => setDropdown({ open: false }), 150)
      }
      ta.addEventListener('blur', onBlur)
      return () => {
        ta.removeEventListener('blur', onBlur)
      }
    }, [])

    return (
      <div className="relative">
        <textarea
          {...rest}
          ref={setRefs}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className={className}
          aria-autocomplete="list"
          aria-expanded={dropdown.open}
          aria-controls="mention-suggestions"
        />
        {dropdown.open && filtered.length > 0 && (
          <ul
            id="mention-suggestions"
            role="listbox"
            className="absolute left-0 top-full z-50 mt-1 max-h-64 w-64 overflow-auto rounded-md border border-border bg-popover shadow-md"
          >
            {filtered.map((user, idx) => (
              <li
                key={user.id}
                role="option"
                aria-selected={idx === dropdown.activeIndex}
                onMouseDown={(e) => {
                  // mouseDown (no click) para anticiparse al blur del textarea.
                  e.preventDefault()
                  insertMention(user)
                }}
                onMouseEnter={() =>
                  setDropdown({ ...dropdown, activeIndex: idx })
                }
                className={[
                  'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm',
                  idx === dropdown.activeIndex
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/50',
                ].join(' ')}
              >
                {user.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.avatarUrl}
                    alt=""
                    className="h-6 w-6 rounded-full"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                  >
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{user.name}</span>
                {user.email && (
                  <span className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  },
)
