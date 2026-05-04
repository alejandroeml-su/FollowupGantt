import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

/**
 * Wave P6 · Equipo A3 — Tests del hook `useTypingIndicator`.
 *
 * Mockeamos `@/lib/supabase` con un `channel()` falso que captura los
 * handlers `.on('broadcast', …)` y nos permite dispararlos manualmente
 * desde el test. Esto evita hacer red real y nos da control total sobre
 * el timing.
 */

type Handler = (msg: { payload?: Record<string, unknown> }) => void

const state = vi.hoisted(() => ({
  onTypingHandler: null as Handler | null,
  onStopHandler: null as Handler | null,
  lastSent: [] as { event: string; payload?: Record<string, unknown> }[],
}))

const mocks = vi.hoisted(() => {
  const channelMock = {
    on: vi.fn(),
    subscribe: vi.fn(),
    send: vi.fn(),
  }
  const supabaseMock = {
    channel: vi.fn(() => channelMock),
    removeChannel: vi.fn(),
  }
  channelMock.subscribe.mockImplementation(() => channelMock)
  return { channelMock, supabaseMock }
})

const channelMock = mocks.channelMock
const supabaseMock = mocks.supabaseMock

vi.mock('@/lib/supabase', () => ({
  supabase: mocks.supabaseMock,
}))

import { useTypingIndicator } from '@/lib/realtime-comments/use-typing-indicator'

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  state.onTypingHandler = null
  state.onStopHandler = null
  state.lastSent = []
  channelMock.on.mockReset()
  channelMock.send.mockReset()
  channelMock.subscribe.mockClear()
  supabaseMock.channel.mockClear()
  supabaseMock.removeChannel.mockClear()

  channelMock.on.mockImplementation(
    (_type: string, opts: { event: string }, cb: Handler) => {
      if (opts.event === 'comment:typing') state.onTypingHandler = cb
      if (opts.event === 'comment:stop_typing') state.onStopHandler = cb
      return channelMock
    },
  )
  channelMock.send.mockImplementation(
    (msg: { event: string; payload?: Record<string, unknown> }) => {
      state.lastSent.push({ event: msg.event, payload: msg.payload })
      return Promise.resolve('ok' as const)
    },
  )

  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useTypingIndicator', () => {
  it('expone un canal y suscribe a los eventos esperados', () => {
    renderHook(() =>
      useTypingIndicator('task:t1:comments', { id: 'u1', name: 'Edwin' }),
    )
    expect(supabaseMock.channel).toHaveBeenCalledWith(
      'task:t1:comments',
      expect.objectContaining({ config: expect.any(Object) }),
    )
    // Dos `.on` registrados (typing + stop_typing).
    expect(channelMock.on).toHaveBeenCalledTimes(2)
    expect(channelMock.subscribe).toHaveBeenCalled()
  })

  it('setTyping(true) emite broadcast inmediato y refresca cada 1s', () => {
    const { result } = renderHook(() =>
      useTypingIndicator('task:t1:comments', { id: 'u1', name: 'Edwin' }),
    )
    act(() => {
      result.current.setTyping(true)
    })
    expect(
      state.lastSent.filter((m) => m.event === 'comment:typing'),
    ).toHaveLength(1)
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(
      state.lastSent.filter((m) => m.event === 'comment:typing'),
    ).toHaveLength(2)
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(
      state.lastSent.filter((m) => m.event === 'comment:typing'),
    ).toHaveLength(3)
  })

  it('setTyping(false) detiene el refresh y envía stop_typing', () => {
    const { result } = renderHook(() =>
      useTypingIndicator('task:t1:comments', { id: 'u1', name: 'Edwin' }),
    )
    act(() => {
      result.current.setTyping(true)
    })
    act(() => {
      result.current.setTyping(false)
    })
    expect(
      state.lastSent.some((m) => m.event === 'comment:stop_typing'),
    ).toBe(true)
    const before = state.lastSent.filter(
      (m) => m.event === 'comment:typing',
    ).length
    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    const after = state.lastSent.filter(
      (m) => m.event === 'comment:typing',
    ).length
    expect(after).toBe(before)
  })

  it('aglutina typing entrante en typingUsers (excluyendo al currentUser)', () => {
    const { result } = renderHook(() =>
      useTypingIndicator('task:t1:comments', { id: 'u1', name: 'Edwin' }),
    )
    act(() => {
      state.onTypingHandler?.({ payload: { userId: 'u2', name: 'Ana' } })
    })
    expect(result.current.typingUsers).toEqual([{ id: 'u2', name: 'Ana' }])

    act(() => {
      state.onTypingHandler?.({ payload: { userId: 'u1', name: 'Edwin' } })
    })
    expect(result.current.typingUsers).toEqual([{ id: 'u2', name: 'Ana' }])
  })

  it('expira typing tras 3s sin refresh', () => {
    const { result } = renderHook(() =>
      useTypingIndicator('task:t1:comments', { id: 'u1', name: 'Edwin' }),
    )
    act(() => {
      state.onTypingHandler?.({ payload: { userId: 'u2', name: 'Ana' } })
    })
    expect(result.current.typingUsers).toHaveLength(1)
    act(() => {
      vi.advanceTimersByTime(3_001)
    })
    expect(result.current.typingUsers).toHaveLength(0)
  })

  it('stop_typing entrante quita al usuario inmediatamente', () => {
    const { result } = renderHook(() =>
      useTypingIndicator('task:t1:comments', { id: 'u1', name: 'Edwin' }),
    )
    act(() => {
      state.onTypingHandler?.({ payload: { userId: 'u2', name: 'Ana' } })
      state.onTypingHandler?.({ payload: { userId: 'u3', name: 'Pedro' } })
    })
    expect(result.current.typingUsers).toHaveLength(2)
    act(() => {
      state.onStopHandler?.({ payload: { userId: 'u2' } })
    })
    expect(result.current.typingUsers).toEqual([{ id: 'u3', name: 'Pedro' }])
  })

  it('si Supabase no está configurado, no se suscribe ni envía nada', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const before = supabaseMock.channel.mock.calls.length
    const { result } = renderHook(() =>
      useTypingIndicator('task:t1:comments', { id: 'u1', name: 'Edwin' }),
    )
    expect(supabaseMock.channel.mock.calls.length).toBe(before)
    act(() => {
      result.current.setTyping(true)
    })
    expect(channelMock.send).not.toHaveBeenCalled()
  })
})
