import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Wave P6 · Equipo A3 — Tests del componente `TaskCommentsRealtime`.
 *
 * Mockeamos:
 *   - `getCommentsForTask` (server action local de A3) para fetch inicial.
 *   - `createComment` (acción de comments existente) para `addComment`.
 *   - `@/lib/supabase` con un canal falso, sólo para que el hook no
 *     intente red real. No probamos el flujo postgres_changes aquí: vive
 *     en el hook (ver `use-typing-indicator.test.ts` y unit tests del
 *     hook implícitos en este flujo).
 *
 * El objetivo de esta suite es el contrato visible de UI:
 *   - empty state, lista, composer, optimistic UI, errores, scroll, etc.
 */

const fns = vi.hoisted(() => ({
  getCommentsForTask: vi.fn(),
  createComment: vi.fn(),
}))

const getCommentsForTask = fns.getCommentsForTask
const createComment = fns.createComment

vi.mock('@/lib/realtime-comments/get-comments', () => ({
  getCommentsForTask: (...args: unknown[]) => fns.getCommentsForTask(...args),
}))

vi.mock('@/lib/actions', () => ({
  createComment: (...args: unknown[]) => fns.createComment(...args),
}))

const mocks = vi.hoisted(() => {
  const channelMock = {
    on: vi.fn(),
    subscribe: vi.fn(),
    send: vi.fn(() => Promise.resolve('ok' as const)),
  }
  const supabaseMock = {
    channel: vi.fn(() => channelMock),
    removeChannel: vi.fn(),
  }
  channelMock.on.mockImplementation(() => channelMock)
  channelMock.subscribe.mockImplementation(() => channelMock)
  return { channelMock, supabaseMock }
})

const channelMock = mocks.channelMock
const supabaseMock = mocks.supabaseMock

vi.mock('@/lib/supabase', () => ({
  supabase: mocks.supabaseMock,
}))

import { TaskCommentsRealtime } from '@/components/comments/TaskCommentsRealtime'

const baseUser = { id: 'u1', name: 'Edwin' }

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  getCommentsForTask.mockReset()
  createComment.mockReset()
  channelMock.on.mockClear()
  channelMock.subscribe.mockClear()
  channelMock.send.mockClear()
  supabaseMock.channel.mockClear()
  supabaseMock.removeChannel.mockClear()
  // Simulamos `Element.prototype.scrollTo` que jsdom no implementa.
  if (!HTMLElement.prototype.scrollTo) {
    // @ts-expect-error: stub jsdom
    HTMLElement.prototype.scrollTo = vi.fn()
  }
})

describe('TaskCommentsRealtime', () => {
  it('muestra estado de carga inicial mientras llega el fetch', async () => {
    let resolve!: (rows: unknown[]) => void
    getCommentsForTask.mockImplementation(
      () => new Promise((r) => (resolve = r as (rows: unknown[]) => void)),
    )
    render(<TaskCommentsRealtime taskId="t1" currentUser={baseUser} />)
    expect(screen.getByTestId('comments-loading')).toBeInTheDocument()
    await act(async () => {
      resolve([])
    })
    await waitFor(() =>
      expect(screen.queryByTestId('comments-loading')).toBeNull(),
    )
  })

  it('muestra empty state cuando no hay comentarios', async () => {
    getCommentsForTask.mockResolvedValue([])
    render(<TaskCommentsRealtime taskId="t1" currentUser={baseUser} />)
    expect(
      await screen.findByTestId('comments-empty'),
    ).toHaveTextContent(/Sé el primero en comentar/)
  })

  it('renderiza la lista cuando hay comentarios y formatea timestamp relativo', async () => {
    const now = new Date()
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString()
    getCommentsForTask.mockResolvedValue([
      {
        id: 'c1',
        content: 'Primer comentario',
        isInternal: false,
        createdAt: tenMinAgo,
        author: { id: 'u9', name: 'Ana' },
      },
    ])
    render(<TaskCommentsRealtime taskId="t1" currentUser={baseUser} />)
    await waitFor(() => {
      expect(screen.getAllByTestId('comment-item')).toHaveLength(1)
    })
    expect(screen.getByText(/Primer comentario/)).toBeInTheDocument()
    expect(screen.getByText(/Ana/)).toBeInTheDocument()
    expect(screen.getByTestId('comment-time')).toHaveTextContent(/hace 10m/)
  })

  it('renderiza markdown simple: bold, italic y links', async () => {
    getCommentsForTask.mockResolvedValue([
      {
        id: 'c1',
        content: 'Esto es **negrita** y *itálica* con [enlace](https://avante.test)',
        isInternal: false,
        createdAt: new Date().toISOString(),
        author: { id: 'u9', name: 'Ana' },
      },
    ])
    render(<TaskCommentsRealtime taskId="t1" currentUser={baseUser} />)
    const item = await screen.findByTestId('comment-item')
    expect(item.querySelector('strong')?.textContent).toBe('negrita')
    expect(item.querySelector('em')?.textContent).toBe('itálica')
    const link = item.querySelector('a')
    expect(link).not.toBeNull()
    expect(link?.getAttribute('href')).toBe('https://avante.test')
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('rechaza enviar cuando el textarea está vacío', async () => {
    getCommentsForTask.mockResolvedValue([])
    render(<TaskCommentsRealtime taskId="t1" currentUser={baseUser} />)
    await screen.findByTestId('comments-empty')
    const submit = screen.getByTestId('comments-submit')
    expect(submit).toBeDisabled()
    expect(createComment).not.toHaveBeenCalled()
  })

  it('optimistic UI: añade el comentario al instante y luego llama a createComment', async () => {
    getCommentsForTask.mockResolvedValue([])
    let resolveCreate!: () => void
    createComment.mockImplementation(
      () => new Promise<void>((r) => (resolveCreate = r)),
    )
    render(<TaskCommentsRealtime taskId="t1" currentUser={baseUser} />)
    await screen.findByTestId('comments-empty')

    const user = userEvent.setup()
    const ta = screen.getByTestId('comments-textarea') as HTMLTextAreaElement
    await user.type(ta, 'Hola mundo')
    await user.click(screen.getByTestId('comments-submit'))

    // Optimistic: el comentario aparece antes de que createComment resuelva.
    await waitFor(() => {
      const item = screen.getByTestId('comment-item')
      expect(item).toHaveTextContent('Hola mundo')
    })
    expect(createComment).toHaveBeenCalledOnce()

    await act(async () => {
      resolveCreate()
    })

    // Tras éxito: el textarea se limpia.
    await waitFor(() => {
      expect((screen.getByTestId('comments-textarea') as HTMLTextAreaElement).value).toBe(
        '',
      )
    })
  })

  it('rollback: si createComment falla, el comentario optimista desaparece y se muestra error', async () => {
    getCommentsForTask.mockResolvedValue([])
    createComment.mockRejectedValue(new Error('Boom DB'))
    render(<TaskCommentsRealtime taskId="t1" currentUser={baseUser} />)
    await screen.findByTestId('comments-empty')

    const user = userEvent.setup()
    await user.type(screen.getByTestId('comments-textarea'), 'Texto fallido')
    await user.click(screen.getByTestId('comments-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('comments-submit-error')).toHaveTextContent(
        /Boom DB/,
      )
    })
    // Tras el rollback no queda comment-item alguno (sólo había el optimista).
    expect(screen.queryByTestId('comment-item')).toBeNull()
  })

  it('muestra error si el fetch inicial falla', async () => {
    getCommentsForTask.mockRejectedValue(new Error('No autorizado'))
    render(<TaskCommentsRealtime taskId="t1" currentUser={baseUser} />)
    await waitFor(() => {
      expect(screen.getByTestId('comments-error')).toHaveTextContent(
        /No autorizado/,
      )
    })
  })

  it('deshabilita composer cuando currentUser es null', async () => {
    getCommentsForTask.mockResolvedValue([])
    render(<TaskCommentsRealtime taskId="t1" currentUser={null} />)
    await screen.findByTestId('comments-empty')
    expect(screen.getByTestId('comments-textarea')).toBeDisabled()
    expect(screen.getByTestId('comments-submit')).toBeDisabled()
    expect(
      screen.getByText(/Inicia sesión para comentar/),
    ).toBeInTheDocument()
  })

  it('cuando Supabase no está configurado, no intenta abrir un canal (modo degradado)', async () => {
    getCommentsForTask.mockResolvedValue([])
    render(<TaskCommentsRealtime taskId="t1" currentUser={baseUser} />)
    await screen.findByTestId('comments-empty')
    expect(supabaseMock.channel).not.toHaveBeenCalled()
  })
})
