/**
 * R4-D · DocSpace + Real-time co-edit · Tests del SupabaseYjsProvider.
 *
 * Estos tests verifican:
 *  1. Encoding base64 ⇆ Uint8Array (round-trip simétrico).
 *  2. Aplicación de updates remotos al `Y.Doc` con el origin correcto
 *     (para que NO retransmitan en loop).
 *  3. Persistence round-trip: serialize state → load → state idéntico.
 *  4. Convergencia CRDT: dos providers que aplican updates cruzados llegan
 *     al mismo `Y.Map` final (last-writer-wins por field es la garantía).
 *  5. Awareness: upsert de usuarios, lista única por userId.
 *  6. Degradación a local-only cuando no hay cliente Supabase.
 *
 * No usamos Supabase real (no hay env vars en CI). Los tests con propagation
 * usan `relayUpdate` para simular el canal sin WebSocket.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as Y from 'yjs'
import {
  SupabaseYjsProvider,
  bytesToBase64,
  base64ToBytes,
  relayUpdate,
} from '@/lib/realtime/yjs-provider'

describe('R4-D · yjs-provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('base64 helpers', () => {
    it('bytesToBase64 + base64ToBytes son inversos', () => {
      const original = new Uint8Array([1, 2, 3, 254, 255, 0, 128, 64])
      const b64 = bytesToBase64(original)
      const round = base64ToBytes(b64)
      expect(Array.from(round)).toEqual(Array.from(original))
    })

    it('maneja buffer vacío', () => {
      const b64 = bytesToBase64(new Uint8Array([]))
      const round = base64ToBytes(b64)
      expect(round.byteLength).toBe(0)
    })

    it('maneja buffers grandes (~64 KB)', () => {
      const big = new Uint8Array(64 * 1024)
      for (let i = 0; i < big.length; i++) big[i] = i % 256
      const b64 = bytesToBase64(big)
      const round = base64ToBytes(b64)
      expect(round.byteLength).toBe(big.byteLength)
      expect(round[0]).toBe(big[0])
      expect(round[12345]).toBe(big[12345])
      expect(round[big.length - 1]).toBe(big[big.length - 1])
    })
  })

  describe('provider sin cliente (degradación local)', () => {
    it('sin cliente Supabase el provider degrada a local-only', () => {
      const doc = new Y.Doc()
      const provider = new SupabaseYjsProvider({
        doc,
        channelName: 'doc:test',
        client: null,
      })
      const statuses: string[] = []
      // Connect debe emitir `disconnected` y NO romper.
      provider['onStatusChange' as keyof SupabaseYjsProvider] = ((s: string) => {
        statuses.push(s)
      }) as never
      provider.connect()
      // Mutaciones locales siguen funcionando.
      doc.getText('body').insert(0, 'hola')
      expect(doc.getText('body').toString()).toBe('hola')
      provider.destroy()
    })
  })

  describe('aplicación de updates remotos', () => {
    it('applyRemoteUpdate muta el Y.Doc con origin del provider', () => {
      const docA = new Y.Doc()
      const docB = new Y.Doc()

      const providerA = new SupabaseYjsProvider({
        doc: docA,
        channelName: 'doc:t1',
        client: null,
      })

      // Edita docB y captura el update.
      let captured: Uint8Array | null = null
      docB.on('update', (u: Uint8Array) => {
        captured = u
      })
      docB.getText('body').insert(0, 'hello world')

      expect(captured).not.toBeNull()
      providerA.applyRemoteUpdate(captured!)

      expect(docA.getText('body').toString()).toBe('hello world')
      providerA.destroy()
    })

    it('updates aplicados via applyRemoteUpdate NO se retransmiten', () => {
      // Validamos que el handleLocalUpdate filtra updates con nuestro origin
      // para evitar loops infinitos.
      const doc = new Y.Doc()
      const provider = new SupabaseYjsProvider({
        doc,
        channelName: 'doc:t1',
        client: null,
      })
      provider.connect() // status disconnected pero handler local activo
      let broadcastCount = 0
      const original = provider['broadcastUpdate' as keyof SupabaseYjsProvider]
      ;(provider as unknown as { broadcastUpdate: () => Promise<void> }).broadcastUpdate =
        async () => {
          broadcastCount++
        }

      // Aplicamos un update via API remota; broadcastCount NO debe subir.
      const docB = new Y.Doc()
      let captured: Uint8Array | null = null
      docB.on('update', (u: Uint8Array) => {
        captured = u
      })
      docB.getText('body').insert(0, 'remoto')
      provider.applyRemoteUpdate(captured!)
      // Da una vuelta a la microtask queue.
      return Promise.resolve().then(() => {
        expect(broadcastCount).toBe(0)
        // Cleanup
        ;(provider as unknown as Record<string, unknown>).broadcastUpdate = original
        provider.destroy()
      })
    })
  })

  describe('persistence round-trip', () => {
    it('encodeStateForPersist + hydrateFromPersist reproducen el state', () => {
      const docA = new Y.Doc()
      docA.getText('body').insert(0, 'documento original con varias líneas')
      docA.getMap('meta').set('title', 'Doc 1')
      docA.getMap('meta').set('tags', ['r4-d', 'co-edit'])

      const providerA = new SupabaseYjsProvider({
        doc: docA,
        channelName: 'doc:r1',
        client: null,
      })
      const snapshot = providerA.encodeStateForPersist()
      expect(snapshot.byteLength).toBeGreaterThan(0)

      // Ahora hidratamos un nuevo provider con un Y.Doc fresco.
      const docB = new Y.Doc()
      const providerB = new SupabaseYjsProvider({
        doc: docB,
        channelName: 'doc:r1',
        client: null,
      })
      providerB.hydrateFromPersist(snapshot)

      expect(docB.getText('body').toString()).toBe(
        'documento original con varias líneas',
      )
      expect(docB.getMap('meta').get('title')).toBe('Doc 1')
      expect(docB.getMap('meta').get('tags')).toEqual(['r4-d', 'co-edit'])

      providerA.destroy()
      providerB.destroy()
    })

    it('hydrateFromPersist con buffer vacío es no-op', () => {
      const doc = new Y.Doc()
      const provider = new SupabaseYjsProvider({
        doc,
        channelName: 'doc:r2',
        client: null,
      })
      doc.getText('body').insert(0, 'initial')
      provider.hydrateFromPersist(new Uint8Array(0))
      expect(doc.getText('body').toString()).toBe('initial')
      provider.destroy()
    })
  })

  describe('convergencia CRDT (last-writer-wins por field)', () => {
    it('dos peers con updates cruzados convergen al mismo state', () => {
      // Caso clásico: A y B editan el mismo Y.Map en campos distintos. Yjs
      // garantiza que ambos terminan con los dos cambios aplicados.
      const docA = new Y.Doc()
      const docB = new Y.Doc()

      const providerA = new SupabaseYjsProvider({
        doc: docA,
        channelName: 'doc:c1',
        client: null,
      })
      const providerB = new SupabaseYjsProvider({
        doc: docB,
        channelName: 'doc:c1',
        client: null,
      })

      // Conectamos los Y.Doc bidireccionalmente por updates.
      docA.on('update', (u: Uint8Array, origin: unknown) => {
        // Filtra updates aplicados por relay (origin del provider).
        if (origin && typeof origin === 'symbol') return
        relayUpdate(providerA, providerB, u)
      })
      docB.on('update', (u: Uint8Array, origin: unknown) => {
        if (origin && typeof origin === 'symbol') return
        relayUpdate(providerB, providerA, u)
      })

      // Edits concurrentes en campos distintos.
      docA.getMap('el-1').set('x', 100)
      docB.getMap('el-1').set('y', 200)

      // Ambos peers tienen los dos cambios.
      expect(docA.getMap('el-1').get('x')).toBe(100)
      expect(docA.getMap('el-1').get('y')).toBe(200)
      expect(docB.getMap('el-1').get('x')).toBe(100)
      expect(docB.getMap('el-1').get('y')).toBe(200)

      providerA.destroy()
      providerB.destroy()
    })

    it('conflicto en mismo field: last-writer-wins (estable por clientID)', () => {
      const docA = new Y.Doc()
      const docB = new Y.Doc()
      const providerA = new SupabaseYjsProvider({
        doc: docA,
        channelName: 'doc:c2',
        client: null,
      })
      const providerB = new SupabaseYjsProvider({
        doc: docB,
        channelName: 'doc:c2',
        client: null,
      })

      docA.on('update', (u: Uint8Array, origin: unknown) => {
        if (origin && typeof origin === 'symbol') return
        relayUpdate(providerA, providerB, u)
      })
      docB.on('update', (u: Uint8Array, origin: unknown) => {
        if (origin && typeof origin === 'symbol') return
        relayUpdate(providerB, providerA, u)
      })

      // Ambos escriben el mismo field en el mismo turno.
      docA.getMap('el-1').set('color', 'red')
      docB.getMap('el-1').set('color', 'blue')

      // Tras el relay bidireccional, ambos deben tener el MISMO valor (sea
      // red o blue) — la garantía CRDT es CONSISTENCY, no preservación de
      // intención de usuario.
      expect(docA.getMap('el-1').get('color')).toBe(
        docB.getMap('el-1').get('color'),
      )

      providerA.destroy()
      providerB.destroy()
    })
  })

  describe('awareness API', () => {
    it('getAwarenessUsers retorna lista vacía al inicio', () => {
      const provider = new SupabaseYjsProvider({
        doc: new Y.Doc(),
        channelName: 'doc:aw1',
        client: null,
      })
      expect(provider.getAwarenessUsers()).toEqual([])
      provider.destroy()
    })

    it('upsertAwareness (interno) deduplica por userId', () => {
      const provider = new SupabaseYjsProvider({
        doc: new Y.Doc(),
        channelName: 'doc:aw2',
        client: null,
      })
      // Acceso interno para testear el merge.
      const internal = provider as unknown as {
        upsertAwareness: (p: {
          senderId: string
          userId: string
          name: string
          color: string
          cursor?: unknown
          selection?: unknown
          lastSeenAt: string
        }) => void
      }
      internal.upsertAwareness({
        senderId: 'sx-1',
        userId: 'u1',
        name: 'Edwin',
        color: '#f00',
        lastSeenAt: '2026-05-11T00:00:00.000Z',
      })
      internal.upsertAwareness({
        senderId: 'sx-1',
        userId: 'u1',
        name: 'Edwin Martinez',
        color: '#f00',
        lastSeenAt: '2026-05-11T00:00:05.000Z',
      })
      internal.upsertAwareness({
        senderId: 'sx-2',
        userId: 'u2',
        name: 'Otro',
        color: '#0f0',
        lastSeenAt: '2026-05-11T00:00:01.000Z',
      })

      const list = provider.getAwarenessUsers()
      expect(list).toHaveLength(2)
      const edwin = list.find((u) => u.userId === 'u1')
      expect(edwin?.name).toBe('Edwin Martinez') // último upsert gana

      provider.destroy()
    })
  })

  describe('destroy() limpia el state', () => {
    it('destroy desconecta y limpia awareness', () => {
      const provider = new SupabaseYjsProvider({
        doc: new Y.Doc(),
        channelName: 'doc:d1',
        client: null,
      })
      ;(
        provider as unknown as {
          upsertAwareness: (p: Record<string, unknown>) => void
        }
      ).upsertAwareness({
        senderId: 'sx',
        userId: 'u1',
        name: 'X',
        color: '#f0f',
        lastSeenAt: 'now',
      })
      expect(provider.getAwarenessUsers()).toHaveLength(1)
      provider.destroy()
      expect(provider.getAwarenessUsers()).toHaveLength(0)
      expect(provider.isConnected()).toBe(false)
    })
  })

  describe('hydration desde state binario completo', () => {
    it('un provider hidratado obtiene el mismo Y.Map que el original', () => {
      const docOriginal = new Y.Doc()
      docOriginal.getMap('elements').set(
        'el-1',
        new Y.Map([
          ['x', 10],
          ['y', 20],
          ['color', 'red'],
        ] as [string, unknown][]),
      )
      docOriginal.getMap('elements').set(
        'el-2',
        new Y.Map([
          ['x', 30],
          ['y', 40],
        ] as [string, unknown][]),
      )

      const providerOrig = new SupabaseYjsProvider({
        doc: docOriginal,
        channelName: 'doc:h1',
        client: null,
      })
      const state = providerOrig.encodeStateForPersist()

      const docHydrated = new Y.Doc()
      const providerHydrated = new SupabaseYjsProvider({
        doc: docHydrated,
        channelName: 'doc:h1',
        client: null,
      })
      providerHydrated.hydrateFromPersist(state)

      const el1 = docHydrated.getMap('elements').get('el-1') as Y.Map<unknown>
      expect(el1.get('x')).toBe(10)
      expect(el1.get('color')).toBe('red')
      const el2 = docHydrated.getMap('elements').get('el-2') as Y.Map<unknown>
      expect(el2.get('x')).toBe(30)

      providerOrig.destroy()
      providerHydrated.destroy()
    })
  })
})
