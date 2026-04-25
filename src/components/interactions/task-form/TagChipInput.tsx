'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { X as CloseIcon } from 'lucide-react'

type Props = {
  value: string[]
  onChange: (next: string[]) => void
  suggestions?: string[]
  placeholder?: string
  /** Si true, los chips no se pueden agregar/quitar (vista lectura). */
  readOnly?: boolean
  /** id del input para enlazar con `<label htmlFor>` externo. */
  id?: string
  /** aria-describedby para hint visible junto al input. */
  'aria-describedby'?: string
}

const MAX_SUGGESTIONS = 8

/**
 * Chip-input controlado de etiquetas.
 *
 * Reglas:
 *  - Enter convierte texto en chip; Espacio NO confirma.
 *  - Backspace en input vacío borra el último chip.
 *  - Click en ✕ borra ese chip.
 *  - Sin duplicados (case-insensitive). Se canonicaliza a lowercase.
 *  - Autocomplete sobre `suggestions`: filtrado case-insensitive, máx. 8.
 *  - A11y: input con role=combobox, aria-expanded cuando dropdown visible,
 *    navegación con flechas + Enter en sugerencias.
 */
export function TagChipInput({
  value,
  onChange,
  suggestions = [],
  placeholder = 'Añadir etiqueta y pulsar Enter…',
  readOnly = false,
  id,
  'aria-describedby': ariaDescribedBy,
}: Props) {
  const fallbackId = useId()
  const inputId = id ?? `tag-chip-input-${fallbackId}`
  const listboxId = `${inputId}-listbox`

  const [draft, setDraft] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const normalized = useMemo(
    () => new Set(value.map((t) => t.toLowerCase())),
    [value],
  )

  const filteredSuggestions = useMemo(() => {
    const q = draft.trim().toLowerCase()
    if (!q || readOnly) return []
    return suggestions
      .filter((s) => s && !normalized.has(s.toLowerCase()))
      .filter((s) => s.toLowerCase().includes(q))
      .slice(0, MAX_SUGGESTIONS)
  }, [draft, suggestions, normalized, readOnly])

  const dropdownVisible = open && filteredSuggestions.length > 0

  // Derivado: clampea el highlight contra el largo actual de la lista.
  // Evita un useEffect+setState para "resetear" el índice cuando cambia la
  // lista filtrada (eslint react-hooks/set-state-in-effect).
  const safeHighlight = Math.min(highlight, Math.max(0, filteredSuggestions.length - 1))

  // Cerrar dropdown al click fuera.
  useEffect(() => {
    if (!dropdownVisible) return
    const handle = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [dropdownVisible])

  const addTag = (raw: string) => {
    if (readOnly) return
    const tag = raw.trim().toLowerCase()
    if (!tag) return
    if (normalized.has(tag)) {
      setDraft('')
      return
    }
    onChange([...value, tag])
    setDraft('')
    setOpen(false)
  }

  const removeTag = (tag: string) => {
    if (readOnly) return
    const target = tag.toLowerCase()
    onChange(value.filter((t) => t.toLowerCase() !== target))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (readOnly) return
    if (e.key === 'Enter') {
      e.preventDefault()
      if (dropdownVisible && filteredSuggestions[safeHighlight]) {
        addTag(filteredSuggestions[safeHighlight])
      } else {
        addTag(draft)
      }
      return
    }
    if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      e.preventDefault()
      removeTag(value[value.length - 1])
      return
    }
    if (e.key === 'ArrowDown' && dropdownVisible) {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, filteredSuggestions.length - 1))
      return
    }
    if (e.key === 'ArrowUp' && dropdownVisible) {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
      return
    }
    if (e.key === 'Escape' && dropdownVisible) {
      e.preventDefault()
      setOpen(false)
      return
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className={`flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-input px-2 py-1.5 text-sm focus-within:border-primary focus-within:ring-1 focus-within:ring-ring ${
          readOnly ? 'opacity-90' : ''
        }`}
        onClick={() => !readOnly && inputRef.current?.focus()}
        role="presentation"
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-foreground/90"
          >
            {tag}
            {!readOnly && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  removeTag(tag)
                }}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground"
                aria-label={`Eliminar etiqueta ${tag}`}
              >
                <CloseIcon className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        {!readOnly && (
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={dropdownVisible}
            aria-controls={listboxId}
            aria-activedescendant={
              dropdownVisible ? `${listboxId}-opt-${safeHighlight}` : undefined
            }
            aria-describedby={ariaDescribedBy}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={value.length === 0 ? placeholder : ''}
            className="flex-1 min-w-[8rem] bg-transparent py-0.5 text-sm text-input-foreground outline-none placeholder:text-muted-foreground"
          />
        )}
      </div>

      {dropdownVisible && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-card shadow-lg"
        >
          {filteredSuggestions.map((s, idx) => {
            const isHi = idx === safeHighlight
            return (
              <li
                key={s}
                id={`${listboxId}-opt-${idx}`}
                role="option"
                aria-selected={isHi}
                onMouseDown={(e) => {
                  // mousedown para que dispare antes del blur del input.
                  e.preventDefault()
                  addTag(s)
                }}
                onMouseEnter={() => setHighlight(idx)}
                className={`cursor-pointer px-3 py-1.5 text-xs ${
                  isHi
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground/90 hover:bg-secondary'
                }`}
              >
                {s}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
