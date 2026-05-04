import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'

/**
 * Ola P2 · Equipo P2-5 — Tests de `DocEditor`.
 *
 * El componente debounce 1s antes de invocar `onSave`. Usamos fake timers
 * + `fireEvent.change` para evitar el conflicto entre `userEvent` (que
 * espera promesas reales) y `vi.useFakeTimers` (que congela el reloj).
 */

import { DocEditor } from '@/components/docs/DocEditor'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DocEditor', () => {
  it('renderiza title y content iniciales', () => {
    render(
      <DocEditor
        docId="d1"
        initialTitle="Mi doc"
        initialContent="# hola"
        onSave={vi.fn()}
      />,
    )
    expect(screen.getByTestId('doc-editor-title')).toHaveValue('Mi doc')
    expect(screen.getByTestId('doc-editor-textarea')).toHaveValue('# hola')
  })

  it('cambia entre Editar y Vista previa', () => {
    render(
      <DocEditor
        docId="d1"
        initialTitle="t"
        initialContent="**bold**"
        onSave={vi.fn()}
      />,
    )
    expect(screen.getByTestId('doc-editor-textarea')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('doc-editor-tab-preview'))
    expect(screen.queryByTestId('doc-editor-textarea')).not.toBeInTheDocument()
    expect(screen.getByTestId('doc-preview')).toBeInTheDocument()
  })

  it('llama onSave con debounce 1s después de tipear', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <DocEditor
        docId="d1"
        initialTitle="t"
        initialContent=""
        onSave={onSave}
      />,
    )
    fireEvent.change(screen.getByTestId('doc-editor-textarea'), {
      target: { value: 'hola' },
    })
    // Aún no se ha llamado: el debounce no expira
    expect(onSave).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      title: 't',
      content: 'hola',
    })
  })

  it('muestra estado "Sin guardar" mientras está dirty', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <DocEditor
        docId="d1"
        initialTitle="t"
        initialContent=""
        onSave={onSave}
      />,
    )
    fireEvent.change(screen.getByTestId('doc-editor-textarea'), {
      target: { value: 'x' },
    })
    const status = screen.getByTestId('doc-editor-status')
    expect(status.textContent).toMatch(/Sin guardar/i)
  })

  it('respeta readOnly: no llama onSave aunque cambie el contenido', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <DocEditor
        docId="d1"
        initialTitle="t"
        initialContent="x"
        onSave={onSave}
        readOnly
      />,
    )
    const ta = screen.getByTestId('doc-editor-textarea') as HTMLTextAreaElement
    expect(ta.disabled).toBe(true)
    // Aunque avancemos el reloj, no debería disparar.
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByTestId('doc-editor-status').textContent).toMatch(
      /Solo lectura/i,
    )
  })
})
