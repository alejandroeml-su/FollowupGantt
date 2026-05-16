import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * R4 · US-7.2 Chat View — Tests del composer.
 *
 * Verifica el contrato visible:
 *   - Renderiza textarea + botón Enviar deshabilitado mientras esté vacío.
 *   - Habilita "Enviar" cuando hay texto.
 *   - Envía con click y limpia el textarea.
 *   - Envía con Enter (sin Shift) y no con Shift+Enter.
 *   - Muestra el bloque "replying to …" y permite cancelarlo.
 *   - Picker emoji inyecta el carácter al input.
 */

import { ChatComposer } from '@/components/chat/ChatComposer'

describe('ChatComposer', () => {
  it('inicia con el botón Enviar deshabilitado y se habilita al escribir', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ChatComposer onSubmit={onSubmit} />)

    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement
    const submit = screen.getByTestId('chat-composer-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    await userEvent.type(textarea, 'hola equipo')
    expect(submit.disabled).toBe(false)
  })

  it('envía con click y limpia el textarea', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ChatComposer onSubmit={onSubmit} />)

    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement
    const submit = screen.getByTestId('chat-composer-submit')

    await userEvent.type(textarea, 'mensaje 1')
    await userEvent.click(submit)

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith('mensaje 1')
    await waitFor(() => expect(textarea.value).toBe(''))
  })

  it('envía con Enter pero no con Shift+Enter', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ChatComposer onSubmit={onSubmit} />)

    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'hola' } })

    // Shift+Enter no debe enviar.
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()

    // Enter sí.
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith('hola')
  })

  it('pinta el banner de respuesta y permite cancelarlo', async () => {
    const onCancelReply = vi.fn()
    render(
      <ChatComposer
        onSubmit={vi.fn()}
        replyingTo={{
          id: 'm1',
          authorName: 'Ana',
          preview: 'mensaje original',
        }}
        onCancelReply={onCancelReply}
      />,
    )

    expect(screen.getByTestId('chat-composer-reply')).toBeTruthy()
    expect(screen.getByText('Ana')).toBeTruthy()
    expect(screen.getByText('mensaje original')).toBeTruthy()

    await userEvent.click(screen.getByTestId('chat-composer-cancel-reply'))
    expect(onCancelReply).toHaveBeenCalledTimes(1)
  })

  it('inserta un emoji desde el picker al input', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ChatComposer onSubmit={onSubmit} />)

    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement
    await userEvent.click(screen.getByTestId('chat-composer-emoji-toggle'))
    const picker = screen.getByTestId('chat-composer-emoji-picker')
    expect(picker).toBeTruthy()

    // El primer botón del picker es el primer emoji canónico.
    const firstEmojiButton = picker.querySelector('button')
    expect(firstEmojiButton).toBeTruthy()
    await userEvent.click(firstEmojiButton as HTMLButtonElement)
    expect(textarea.value.length).toBeGreaterThan(0)
  })
})
