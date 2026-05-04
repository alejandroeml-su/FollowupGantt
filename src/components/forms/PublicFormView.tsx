'use client'

/**
 * Ola P5 · Equipo P5-5 — Componente público que renderiza un PublicForm.
 *
 * Recibe `slug`, `title`, `description?` y el array de fields (ya validado
 * por el server). No depende de Prisma — toda la persistencia se hace via
 * `POST /api/forms/<slug>/submit`.
 *
 * Características:
 *  - Honeypot field invisible (D-FA-RL-1).
 *  - Mensajes de error tipados (`[INVALID_INPUT]`, `[RATE_LIMITED]`, …).
 *  - Estado: idle | submitting | success | error.
 */

import { useState, type FormEvent } from 'react'
import type { FormField } from '@/lib/forms/schema'
import { FORM_HONEYPOT_FIELD } from '@/lib/actions/forms'

interface Props {
  slug: string
  title: string
  description?: string | null
  fields: FormField[]
}

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; submissionId: string }
  | { kind: 'error'; message: string }

function friendlyError(raw: string): string {
  if (raw.includes('[RATE_LIMITED]')) return 'Has alcanzado el máximo de envíos por hora. Vuelve a intentarlo más tarde.'
  if (raw.includes('[FORM_INACTIVE]')) return 'Este formulario no está disponible.'
  if (raw.includes('[FORM_NOT_FOUND]')) return 'Formulario no encontrado.'
  if (raw.includes('[HONEYPOT_TRIGGERED]')) return 'Tu envío fue rechazado por filtros anti-spam.'
  if (raw.includes('[INVALID_INPUT]')) {
    const m = raw.match(/\[INVALID_INPUT\]\s*(.*)/)
    return m?.[1]?.trim() || 'Datos inválidos. Revisa los campos requeridos.'
  }
  return 'No se pudo enviar el formulario. Intenta nuevamente.'
}

export function PublicFormView(props: Props) {
  const [state, setState] = useState<SubmitState>({ kind: 'idle' })

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (state.kind === 'submitting') return
    const form = e.currentTarget
    const fd = new FormData(form)
    const payload: Record<string, unknown> = {}
    fd.forEach((value, key) => {
      payload[key] = typeof value === 'string' ? value : value.name
    })

    setState({ kind: 'submitting' })
    try {
      const res = await fetch(`/api/forms/${encodeURIComponent(props.slug)}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        const msg = typeof json.error === 'string' ? json.error : 'Error desconocido'
        setState({ kind: 'error', message: friendlyError(msg) })
        return
      }
      setState({ kind: 'success', submissionId: json.submissionId })
      form.reset()
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Error de red',
      })
    }
  }

  if (state.kind === 'success') {
    return (
      <section className="rounded-xl border border-border bg-card p-8 shadow">
        <h2 className="text-xl font-semibold text-white">¡Gracias!</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Tu envío fue recibido. Recibirás respuesta a la brevedad.
        </p>
        <p className="mt-4 text-xs text-muted-foreground/70">
          Referencia: <code className="font-mono">{state.submissionId}</code>
        </p>
        <button
          type="button"
          onClick={() => setState({ kind: 'idle' })}
          className="mt-6 rounded-md bg-secondary px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary/80"
        >
          Enviar otro
        </button>
      </section>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-border bg-card p-8 shadow space-y-6"
      aria-busy={state.kind === 'submitting'}
    >
      <header>
        <h1 className="text-2xl font-bold text-white">{props.title}</h1>
        {props.description ? (
          <p className="mt-2 text-sm text-muted-foreground">{props.description}</p>
        ) : null}
      </header>

      <div className="space-y-4">
        {props.fields.map((field) => (
          <FieldRenderer key={field.name} field={field} />
        ))}
      </div>

      {/* Honeypot: campo invisible. Si el bot lo rellena, server lo rechaza. */}
      <div aria-hidden="true" className="hidden">
        <label>
          Sitio web (no llenar)
          <input
            type="text"
            name={FORM_HONEYPOT_FIELD}
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </label>
      </div>

      {state.kind === 'error' ? (
        <p
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
        >
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={state.kind === 'submitting'}
        className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {state.kind === 'submitting' ? 'Enviando…' : 'Enviar'}
      </button>
    </form>
  )
}

function FieldRenderer({ field }: { field: FormField }) {
  const baseClass =
    'mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-indigo-500'
  const label = field.label ?? field.name
  const id = `f-${field.name}`
  const required = field.required

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-foreground/90">
        {label}
        {required ? <span className="ml-1 text-red-400">*</span> : null}
      </label>
      {field.type === 'textarea' ? (
        <textarea
          id={id}
          name={field.name}
          required={required}
          rows={5}
          className={baseClass}
        />
      ) : field.type === 'select' ? (
        <select id={id} name={field.name} required={required} className={baseClass}>
          <option value="">Selecciona…</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          name={field.name}
          type={
            field.type === 'email'
              ? 'email'
              : field.type === 'number'
                ? 'number'
                : 'text'
          }
          required={required}
          className={baseClass}
        />
      )}
    </div>
  )
}
