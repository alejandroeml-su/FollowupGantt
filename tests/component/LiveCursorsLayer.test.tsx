import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react'
import { LiveCursorsLayer } from '@/components/realtime-cursors/LiveCursorsLayer'
import {
  __setLiveCursorsClientFactory,
  __resetLiveCursorsClient,
  colorForUserId,
  CURSOR_PALETTE,
  type CursorPosition,
} from '@/lib/realtime-cursors/use-live-cursors'

/**
 * Mock mínimo de un canal Supabase Realtime. Almacena los listeners
 * `broadcast` por evento y expone helpers para inyectar payloads desde
 * los tests (simulando otros usuarios emitiendo).
 */
type Listener = (msg: { payload: CursorPosition | { userId: string } }) => void
type FakeChannel = {
  on: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  unsubscribe: ReturnType<typeof vi.fn>
  __listeners: Map<string, Listener[]>
  __emit: (event: string, payload: unknown) => void
}

function createFakeChannel(): FakeChannel {
  const listeners = new Map<string, Listener[]>()
  const channel: FakeChannel = {
    on: vi.fn((_type: string, filter: { event: string }, cb: Listener) => {
      const list = listeners.get(filter.event) ?? []
      list.push(cb)
      listeners.set(filter.event, list)
      return channel
    }),
    subscribe: vi.fn(() => channel),
    send: vi.fn(),
    unsubscribe: vi.fn(),
    __listeners: listeners,
    __emit(event, payload) {
      const list = listeners.get(event) ?? []
      list.forEach((cb) => cb({ payload: payload as CursorPosition }))
    },
  }
  return channel
}

let lastChannel: FakeChannel | null = null
let lastClient: { channel: ReturnType<typeof vi.fn>; removeChannel: ReturnType<typeof vi.fn> } | null = null

function installFakeClient(channelName?: string) {
  __setLiveCursorsClientFactory(async () => {
    const ch = createFakeChannel()
    lastChannel = ch
    const client = {
      channel: vi.fn((name: string) => {
        if (channelName) expect(name).toBe(channelName)
        return ch
      }),
      removeChannel: vi.fn(),
    }
    lastClient = client
    return client as unknown as Parameters<typeof __setLiveCursorsClientFactory>[0] extends infer F
      ? F extends () => Promise<infer R>
        ? R
        : never
      : never
  })
}

async function flushAsync() {
  // Permite que la promise del factory resuelva y que React aplique el setState.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('LiveCursorsLayer', () => {
  beforeEach(() => {
    lastChannel = null
    lastClient = null
  })
  afterEach(() => {
    __resetLiveCursorsClient()
    cleanup()
  })

  it('renderiza el contenedor overlay con pointer-events none y position absolute', async () => {
    installFakeClient()
    render(
      <div style={{ position: 'relative', width: 400, height: 300 }}>
        <LiveCursorsLayer
          channelName="whiteboard:1"
          currentUser={{ id: 'me', name: 'Yo' }}
        />
      </div>,
    )
    await flushAsync()
    const layer = screen.getByTestId('live-cursors-layer')
    expect(layer.style.position).toBe('absolute')
    expect(layer.style.pointerEvents).toBe('none')
    expect(layer.getAttribute('aria-hidden')).toBe('true')
  })

  it('no renderiza ningún cursor antes de recibir un broadcast', async () => {
    installFakeClient()
    render(
      <div>
        <LiveCursorsLayer
          channelName="whiteboard:1"
          currentUser={{ id: 'me', name: 'Yo' }}
        />
      </div>,
    )
    await flushAsync()
    expect(screen.queryAllByTestId('live-cursor')).toHaveLength(0)
  })

  it('renderiza un cursor remoto al recibir broadcast cursor:move', async () => {
    installFakeClient('whiteboard:42')
    render(
      <div>
        <LiveCursorsLayer
          channelName="whiteboard:42"
          currentUser={{ id: 'me', name: 'Yo' }}
        />
      </div>,
    )
    await flushAsync()
    expect(lastChannel).not.toBeNull()
    await act(async () => {
      lastChannel!.__emit('cursor:move', {
        userId: 'other-1',
        name: 'Otro',
        x: 100,
        y: 50,
        color: '#ef4444',
      })
    })
    const cursors = screen.getAllByTestId('live-cursor')
    expect(cursors).toHaveLength(1)
    expect(cursors[0].getAttribute('data-user-id')).toBe('other-1')
    expect(screen.getByTestId('live-cursor-label')).toHaveTextContent('Otro')
  })

  it('NO renderiza el cursor del propio currentUser', async () => {
    installFakeClient()
    render(
      <div>
        <LiveCursorsLayer
          channelName="whiteboard:42"
          currentUser={{ id: 'me', name: 'Yo' }}
        />
      </div>,
    )
    await flushAsync()
    await act(async () => {
      lastChannel!.__emit('cursor:move', {
        userId: 'me',
        name: 'Yo',
        x: 1,
        y: 2,
        color: '#22c55e',
      })
    })
    expect(screen.queryAllByTestId('live-cursor')).toHaveLength(0)
  })

  it('actualiza la posición cuando el mismo userId vuelve a emitir', async () => {
    installFakeClient()
    render(
      <div>
        <LiveCursorsLayer
          channelName="whiteboard:42"
          currentUser={{ id: 'me', name: 'Yo' }}
        />
      </div>,
    )
    await flushAsync()
    await act(async () => {
      lastChannel!.__emit('cursor:move', {
        userId: 'u1',
        name: 'A',
        x: 10,
        y: 10,
        color: '#06b6d4',
      })
    })
    await act(async () => {
      lastChannel!.__emit('cursor:move', {
        userId: 'u1',
        name: 'A',
        x: 200,
        y: 99,
        color: '#06b6d4',
      })
    })
    const cursors = screen.getAllByTestId('live-cursor')
    expect(cursors).toHaveLength(1) // sigue siendo uno solo
    expect(cursors[0].style.transform).toContain('translate3d(200px, 99px, 0)')
  })

  it('mousemove sobre el padre dispara channel.send con posición relativa', async () => {
    installFakeClient()
    const { container } = render(
      <div data-testid="parent" style={{ position: 'relative', width: 400, height: 300 }}>
        <LiveCursorsLayer
          channelName="whiteboard:42"
          currentUser={{ id: 'me', name: 'Edwin' }}
          throttleMs={0}
        />
      </div>,
    )
    await flushAsync()
    const parent = container.querySelector('[data-testid="parent"]') as HTMLElement
    // Stub de getBoundingClientRect para que las coords sean predecibles.
    parent.getBoundingClientRect = () =>
      ({
        left: 50,
        top: 20,
        width: 400,
        height: 300,
        right: 450,
        bottom: 320,
        x: 50,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect
    fireEvent.mouseMove(parent, { clientX: 150, clientY: 70 })
    await flushAsync()
    expect(lastChannel!.send).toHaveBeenCalledTimes(1)
    const call = (lastChannel!.send as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.event).toBe('cursor:move')
    expect(call.payload.userId).toBe('me')
    expect(call.payload.name).toBe('Edwin')
    expect(call.payload.x).toBe(100) // 150 - 50
    expect(call.payload.y).toBe(50) // 70 - 20
  })

  it('cleanup en unmount → removeChannel se llama', async () => {
    installFakeClient()
    const { unmount } = render(
      <div>
        <LiveCursorsLayer
          channelName="whiteboard:42"
          currentUser={{ id: 'me', name: 'Yo' }}
        />
      </div>,
    )
    await flushAsync()
    unmount()
    expect(lastClient!.removeChannel).toHaveBeenCalledTimes(1)
  })

  it('si Supabase no está disponible (factory → null) degrada a no-op', async () => {
    __setLiveCursorsClientFactory(async () => null)
    render(
      <div>
        <LiveCursorsLayer
          channelName="whiteboard:42"
          currentUser={{ id: 'me', name: 'Yo' }}
        />
      </div>,
    )
    await flushAsync()
    // No hay cursores y no se cae al renderizar.
    expect(screen.queryAllByTestId('live-cursor')).toHaveLength(0)
  })

  it('hash de userId cae siempre dentro de la paleta de 8 colores', () => {
    const userIds = ['a', 'b', 'c', 'usuario-1234', '00000', 'edwin', 'XYZ', 'ñ']
    for (const id of userIds) {
      expect(CURSOR_PALETTE).toContain(colorForUserId(id))
    }
  })
})
