import { describe, it, expect, mock, spyOn, afterEach } from 'bun:test'
import { EventEmitter } from 'events'
import { ChattoClient } from '../src/client'
import { RoomManager } from '../src/managers/rooms'
import { MessageManager } from '../src/managers/messages'
import { UserManager } from '../src/managers/users'
import type { RealtimeConnection } from '../src/realtime/connection'
import { ChattoApiError, ChattoAuthError, ChattoValidationError } from '../src/errors'
import { AccountManager } from '../src/managers/account'

type MockRt = EventEmitter & {
  connect: ReturnType<typeof mock>
  disconnect: ReturnType<typeof mock>
}

function makeMockRt(): MockRt {
  return Object.assign(new EventEmitter(), {
    connect: mock(() => Promise.resolve()),
    disconnect: mock(() => {}),
  }) as MockRt
}

function makeClient(mockRt: MockRt): ChattoClient {
  return new ChattoClient(
    { baseUrl: 'https://chat.example.com', token: 'tk' },
    () => mockRt as unknown as RealtimeConnection,
  )
}

describe('ChattoClient', () => {
  it('exposes rooms and messages managers', () => {
    const client = makeClient(makeMockRt())
    expect(client.rooms).toBeInstanceOf(RoomManager)
    expect(client.messages).toBeInstanceOf(MessageManager)
  })

  it('connect() calls realtime.connect() and emits ready', async () => {
    const mockRt = makeMockRt()
    const client = makeClient(mockRt)
    const readyEvents: unknown[] = []
    client.on('ready', () => readyEvents.push(true))
    await client.connect()
    expect(readyEvents).toHaveLength(1)
    expect(mockRt.connect).toHaveBeenCalled()
  })

  it('disconnect() emits disconnect', async () => {
    const client = makeClient(makeMockRt())
    const disconnectEvents: unknown[] = []
    client.on('disconnect', () => disconnectEvents.push(true))
    await client.disconnect()
    expect(disconnectEvents).toHaveLength(1)
  })

  it('forwards realtime error events as client error events', () => {
    const mockRt = makeMockRt()
    const client = makeClient(mockRt)
    const errors: Error[] = []
    client.on('error', e => errors.push(e))
    mockRt.emit('error', new Error('ws error'))
    expect(errors[0]?.message).toBe('ws error')
  })

  it('emits disconnect when realtime emits close with kind=clean', () => {
    const mockRt = makeMockRt()
    const client = makeClient(mockRt)
    const disconnects: unknown[] = []
    client.on('disconnect', () => disconnects.push(true))
    mockRt.emit('close', { kind: 'clean', code: 1000, retryAfterMs: 0 })
    expect(disconnects).toHaveLength(1)
  })

  it('exposes users manager', () => {
    const client = makeClient(makeMockRt())
    expect(client.users).toBeInstanceOf(UserManager)
  })

  it('emits a hydrated Message with author and channel on messageCreate', async () => {
    const mockRt = makeMockRt()
    // rest.post is used by messages.fetch (GetMessage), then GetUser, then GetRoom
    const client = new ChattoClient(
      { baseUrl: 'https://chat.example.com', token: 'tk' },
      () => mockRt as unknown as RealtimeConnection,
    )
    // Stub the context's rest via the messages manager path:
    const msgData = { id: 'evt_1', roomId: 'R_1', createdAt: 't', actorId: 'U_1', body: 'hi', reactions: [] }
    const userMember = { user: { id: 'U_1', login: 'l', displayName: 'Name', deleted: false, presenceStatus: 'PRESENCE_STATUS_ONLINE' }, roles: [] }
    const roomWrap = { room: { id: 'R_1', name: 'general', kind: 'channel', archived: false, universal: false } }
    ;(client as any).ctx.rest.post = mock(async (_s: string, method: string) => {
      if (method === 'GetMessage') return { message: msgData }
      if (method === 'GetUser') return { user: userMember }
      if (method === 'GetRoom') return { room: roomWrap }
    })
    const received: any[] = []
    client.on('messageCreate', m => received.push(m))
    // Decoded RealtimeEvent (src/realtime/frames.ts). For message_posted the
    // envelope id is the message's event id.
    mockRt.emit('event', { id: 'evt_1', actorId: 'U_1', event: 'messagePosted', messagePosted: { roomId: 'R_1' } })
    await new Promise(r => setTimeout(r, 10))
    expect(received[0]?.author.displayName).toBe('Name')
    expect(received[0]?.channel.name).toBe('general')
  })

  it('emits every realtime event as raw and as its typed variant with metadata', () => {
    const mockRt = makeMockRt()
    const client = makeClient(mockRt)
    const raw: any[] = []
    const typed: any[] = []
    client.on('raw', e => raw.push(e))
    client.on('userTyping', (payload, meta) => typed.push({ payload, meta }))
    const event = { id: 'E1', createdAt: '2026-11-10T00:00:00.000Z', actorId: 'U1', event: 'userTyping', userTyping: { roomId: 'R1' } }
    mockRt.emit('event', event)
    expect(raw).toEqual([event])
    expect(typed).toEqual([{ payload: { roomId: 'R1' }, meta: { id: 'E1', createdAt: '2026-11-10T00:00:00.000Z', actorId: 'U1', cursor: undefined } }])
  })

  it('forwards snapshot and caughtUp from the realtime connection', () => {
    const mockRt = makeMockRt()
    const client = makeClient(mockRt)
    const seen: string[] = []
    client.on('snapshot', () => seen.push('snapshot'))
    client.on('caughtUp', s => seen.push(s.recovery))
    mockRt.emit('snapshot', { rooms: [], roomGroups: [], users: [], activeCalls: [] })
    mockRt.emit('caughtUp', { cursor: 'c', recovery: 'REALTIME_RECOVERY_RESUMED' })
    expect(seen).toEqual(['snapshot', 'REALTIME_RECOVERY_RESUMED'])
  })

  it('stops with a session_terminated auth error when the server ends the session', () => {
    const mockRt = makeMockRt()
    const client = makeClient(mockRt)
    const errors: Error[] = []
    const disconnects: unknown[] = []
    client.on('error', e => errors.push(e))
    client.on('disconnect', () => disconnects.push(true))
    mockRt.emit('close', { kind: 'terminated', code: 1000, message: 'logout', retryAfterMs: 0 })
    expect(errors[0]).toBeInstanceOf(ChattoAuthError)
    expect((errors[0] as ChattoAuthError).code).toBe('session_terminated')
    expect(disconnects).toHaveLength(1)
    expect(mockRt.connect).not.toHaveBeenCalled()
  })

  it('does not throw when an error is emitted with no user listener', () => {
    const mockRt = makeMockRt()
    const client = makeClient(mockRt)
    // no client.on('error', ...) attached
    expect(() => mockRt.emit('error', new Error('boom'))).not.toThrow()
    void client
  })

  it('refreshes the token and retries when REST returns 401', async () => {
    const mockRt = makeMockRt()
    // Branch on URL: /auth/login mints a fresh token; the Connect call 401s once
    // (with the stale token) then succeeds (with the fresh token).
    let connectCalls = 0
    spyOn(globalThis, 'fetch').mockImplementation(async (url: string) => {
      if (String(url).endsWith('/auth/login')) {
        return { ok: true, status: 200, statusText: 'OK',
          json: async () => ({ success: true, token: 'fresh', user: { id: 'U1', login: 'u' } }) } as Response
      }
      connectCalls += 1
      if (connectCalls === 1) {
        return { ok: false, status: 401, statusText: 'Unauthorized',
          json: async () => ({ code: 'unauthenticated' }) } as Response
      }
      // GetRoom (RoomDirectoryService) response is double-nested: res.room.room
      return { ok: true, status: 200, statusText: 'OK',
        json: async () => ({ room: { room: { id: 'R1', name: 'General', kind: 'ROOM_KIND_CHANNEL', archived: false } } }) } as Response
    })
    const client = new ChattoClient(
      { baseUrl: 'https://c', token: 'stale', credentials: { login: 'u', password: 'p' } },
      () => mockRt as unknown as RealtimeConnection,
    )
    const room = await client.rooms.fetch('R1')
    expect(room.id).toBe('R1')
  })

  it('emits disconnect on a fatal close without reconnecting', () => {
    const mockRt = makeMockRt()
    const client = makeClient(mockRt)
    const disconnects: unknown[] = []
    client.on('disconnect', () => disconnects.push(true))
    mockRt.emit('close', { kind: 'fatal', code: 1002, retryAfterMs: 0 })
    expect(disconnects).toHaveLength(1)
    expect(mockRt.connect).not.toHaveBeenCalled()
  })

  it('reconnects with a fresh token on an auth close when credentials exist', async () => {
    const mockRt = makeMockRt()
    const loginResponses: string[] = []
    const spy = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      loginResponses.push('login')
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, token: 'fresh', user: { id: 'U1', login: 'u' } }) } as Response
    })
    const client = new ChattoClient(
      { baseUrl: 'https://c', token: 'stale', credentials: { login: 'u', password: 'p' }, reconnect: { baseDelayMs: 1 } },
      () => mockRt as unknown as RealtimeConnection,
    )
    const refreshed: unknown[] = []
    client.on('tokenRefresh', () => refreshed.push(true))
    mockRt.emit('close', { kind: 'auth', code: 1008, retryAfterMs: 0 })
    await new Promise(r => setTimeout(r, 20))
    expect(spy).toHaveBeenCalled()          // re-login happened
    expect(mockRt.connect).toHaveBeenCalled()
    expect(refreshed).toHaveLength(1)
  })

  it('emits error + disconnect on an auth close with no credentials (no loop)', async () => {
    const mockRt = makeMockRt()
    const client = makeClient(mockRt)   // token-only, no credentials
    const errors: Error[] = []
    const disconnects: unknown[] = []
    client.on('error', e => errors.push(e))
    client.on('disconnect', () => disconnects.push(true))
    mockRt.emit('close', { kind: 'auth', code: 1008, retryAfterMs: 0 })
    await new Promise(r => setTimeout(r, 5))
    expect(errors[0]?.name).toBe('ChattoAuthError')
    expect(disconnects).toHaveLength(1)
    expect(mockRt.connect).not.toHaveBeenCalled()
  })

  it('does not stack overlapping reconnects while one is in flight', async () => {
    const mockRt = makeMockRt()
    let resolveConnect!: () => void
    mockRt.connect = mock(() => new Promise<void>(r => { resolveConnect = r })) as any
    const client = new ChattoClient(
      { baseUrl: 'https://c', token: 'tk', reconnect: { baseDelayMs: 1 } },
      () => mockRt as unknown as RealtimeConnection,
    )
    mockRt.emit('close', { kind: 'retry', code: 1006, retryAfterMs: 0 })
    mockRt.emit('close', { kind: 'retry', code: 1006, retryAfterMs: 0 })
    await new Promise(r => setTimeout(r, 10))
    expect(mockRt.connect).toHaveBeenCalledTimes(1)
    resolveConnect()
  })

  it('emits reconnecting with attempt number and gives up after maxAttempts', async () => {
    const mockRt = makeMockRt()
    mockRt.connect = mock(() => Promise.reject(new Error('down'))) as any
    const client = new ChattoClient(
      { baseUrl: 'https://c', token: 'tk', reconnect: { baseDelayMs: 1, maxDelayMs: 2, maxAttempts: 3 } },
      () => mockRt as unknown as RealtimeConnection,
    )
    const attempts: number[] = []
    const disconnects: unknown[] = []
    client.on('reconnecting', a => attempts.push(a))
    client.on('disconnect', () => disconnects.push(true))
    mockRt.emit('close', { kind: 'retry', code: 1006, retryAfterMs: 0 })
    await new Promise(r => setTimeout(r, 50))
    expect(attempts).toEqual([1, 2, 3])
    expect(disconnects).toHaveLength(1)
  })

  it('periodically re-logs-in when refresh.intervalMs is set', async () => {
    const mockRt = makeMockRt()
    const spy = spyOn(globalThis, 'fetch').mockResolvedValue(
      { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, token: 'rotated', user: { id: 'U1', login: 'u' } }) } as Response,
    )
    const client = new ChattoClient(
      { baseUrl: 'https://c', token: 'tk', credentials: { login: 'u', password: 'p' }, refresh: { intervalMs: 5 } },
      () => mockRt as unknown as RealtimeConnection,
    )
    const refreshed: unknown[] = []
    client.on('tokenRefresh', () => refreshed.push(true))
    await new Promise(r => setTimeout(r, 18))
    await client.disconnect()
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(refreshed.length).toBeGreaterThanOrEqual(2)
  })

  it('does not start a periodic timer without credentials', async () => {
    const mockRt = makeMockRt()
    const spy = spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, statusText: 'OK', json: async () => ({}) } as Response)
    const client = new ChattoClient(
      { baseUrl: 'https://c', token: 'tk', refresh: { intervalMs: 5 } },
      () => mockRt as unknown as RealtimeConnection,
    )
    await new Promise(r => setTimeout(r, 18))
    await client.disconnect()
    expect(spy).not.toHaveBeenCalled()
    void client
  })

  it('disconnect() cancels an in-flight reconnect and does not resurrect', async () => {
    const mockRt = makeMockRt()
    const client = new ChattoClient(
      { baseUrl: 'https://c', token: 'tk', reconnect: { baseDelayMs: 20 } },
      () => mockRt as unknown as RealtimeConnection,
    )
    const disconnects: unknown[] = []
    client.on('disconnect', () => disconnects.push(true))
    mockRt.emit('close', { kind: 'retry', code: 1006, retryAfterMs: 0 })
    await client.disconnect()
    await new Promise(r => setTimeout(r, 40))
    expect(mockRt.connect).not.toHaveBeenCalled()
    expect(disconnects).toHaveLength(1)
  })

  it('token-only client surfaces ChattoApiError (not ChattoAuthError) on REST 401', async () => {
    const mockRt = makeMockRt()
    spyOn(globalThis, 'fetch').mockResolvedValue(
      { ok: false, status: 401, statusText: 'Unauthorized',
        json: async () => ({ code: 'unauthenticated', message: 'expired' }) } as Response,
    )
    const client = new ChattoClient(
      { baseUrl: 'https://c', token: 'tk' },
      () => mockRt as unknown as RealtimeConnection,
    )
    const err = await client.rooms.fetch('R1').catch(e => e)
    expect(err).toBeInstanceOf(ChattoApiError)
    expect(err).not.toBeInstanceOf(ChattoAuthError)
  })

  describe('status', () => {
    function accountOf(client: ChattoClient): AccountManager {
      // ctx.account is reachable through the private context; cast for the test
      return (client as any).ctx.account as AccountManager
    }

    it('setStatus sends SetPresence with userSelected=true', async () => {
      const client = makeClient(makeMockRt())
      const account = accountOf(client)
      const spy = spyOn(account, 'updatePresence').mockResolvedValue('PRESENCE_STATUS_ONLINE')
      const result = await client.setStatus('online')
      expect(spy).toHaveBeenCalledWith('PRESENCE_STATUS_ONLINE', true)
      expect(result).toBe('online')
      await client.disconnect()
    })

    it('setStatus maps dnd and idle', async () => {
      const client = makeClient(makeMockRt())
      const account = accountOf(client)
      const spy = spyOn(account, 'updatePresence').mockResolvedValue('PRESENCE_STATUS_DO_NOT_DISTURB')
      await client.setStatus('dnd')
      expect(spy).toHaveBeenLastCalledWith('PRESENCE_STATUS_DO_NOT_DISTURB', true)
      await client.setStatus('idle')
      expect(spy).toHaveBeenLastCalledWith('PRESENCE_STATUS_AWAY', true)
      await client.disconnect()
    })

    it('setStatus("offline") sends no RPC', async () => {
      const client = makeClient(makeMockRt())
      const account = accountOf(client)
      const spy = spyOn(account, 'updatePresence').mockResolvedValue('PRESENCE_STATUS_ONLINE')
      await client.setStatus('offline')
      expect(spy).not.toHaveBeenCalled()
      await client.disconnect()
    })

    it('invalid status throws before any network call', async () => {
      const client = makeClient(makeMockRt())
      const account = accountOf(client)
      const spy = spyOn(account, 'updatePresence').mockResolvedValue('PRESENCE_STATUS_ONLINE')
      await expect(client.setStatus('busy' as any)).rejects.toThrow(ChattoValidationError)
      expect(spy).not.toHaveBeenCalled()
      await client.disconnect()
    })

    it('heartbeat re-sends presence on the interval', async () => {
      const client = new ChattoClient(
        { baseUrl: 'https://chat.example.com', token: 'tk', presence: { intervalMs: 1000 } },
        () => makeMockRt() as unknown as RealtimeConnection,
      )
      const account = accountOf(client)
      const spy = spyOn(account, 'updatePresence').mockResolvedValue('PRESENCE_STATUS_ONLINE')
      await client.setStatus('online')
      expect(spy).toHaveBeenCalledTimes(1)
      await Bun.sleep(1100)
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2)
      await client.disconnect()
    })

    it('no heartbeat when autoRefresh is false', async () => {
      const client = new ChattoClient(
        { baseUrl: 'https://chat.example.com', token: 'tk', presence: { autoRefresh: false, intervalMs: 500 } },
        () => makeMockRt() as unknown as RealtimeConnection,
      )
      const account = accountOf(client)
      const spy = spyOn(account, 'updatePresence').mockResolvedValue('PRESENCE_STATUS_ONLINE')
      await client.setStatus('online')
      await Bun.sleep(700)
      expect(spy).toHaveBeenCalledTimes(1)
      await client.disconnect()
    })

    it('disconnect stops the heartbeat', async () => {
      const client = new ChattoClient(
        { baseUrl: 'https://chat.example.com', token: 'tk', presence: { intervalMs: 500 } },
        () => makeMockRt() as unknown as RealtimeConnection,
      )
      const account = accountOf(client)
      const spy = spyOn(account, 'updatePresence').mockResolvedValue('PRESENCE_STATUS_ONLINE')
      await client.setStatus('online')
      await client.disconnect()
      const callsAfterDisconnect = spy.mock.calls.length
      await Bun.sleep(700)
      expect(spy.mock.calls.length).toBe(callsAfterDisconnect)
    })

    it('setStatus("offline") stops an active heartbeat', async () => {
      const client = new ChattoClient(
        { baseUrl: 'https://chat.example.com', token: 'tk', presence: { intervalMs: 500 } },
        () => makeMockRt() as unknown as RealtimeConnection,
      )
      const account = accountOf(client)
      const spy = spyOn(account, 'updatePresence').mockResolvedValue('PRESENCE_STATUS_ONLINE')
      await client.setStatus('online')
      await client.setStatus('offline')
      const calls = spy.mock.calls.length
      await Bun.sleep(700)
      expect(spy.mock.calls.length).toBe(calls)
      await client.disconnect()
    })

    it('stops the heartbeat on a terminal disconnect without calling disconnect()', async () => {
      const mockRt = makeMockRt()
      const client = new ChattoClient(
        { baseUrl: 'https://chat.example.com', token: 'tk', presence: { intervalMs: 300 } },
        () => mockRt as unknown as RealtimeConnection,
      )
      const account = accountOf(client)
      const spy = spyOn(account, 'updatePresence').mockResolvedValue('PRESENCE_STATUS_ONLINE')
      await client.setStatus('online')
      expect(spy).toHaveBeenCalledTimes(1)
      // Terminal close: the realtime layer gives up without the user ever calling disconnect().
      mockRt.emit('close', { kind: 'clean', code: 1000, retryAfterMs: 0 })
      const callsAfterClose = spy.mock.calls.length
      await Bun.sleep(400)
      expect(spy.mock.calls.length).toBe(callsAfterClose)
    })

    it('stops the heartbeat when reconnect gives up after maxAttempts', async () => {
      const mockRt = makeMockRt()
      mockRt.connect = mock(() => Promise.reject(new Error('down'))) as any
      const client = new ChattoClient(
        {
          baseUrl: 'https://c',
          token: 'tk',
          presence: { intervalMs: 300 },
          reconnect: { baseDelayMs: 1, maxDelayMs: 2, maxAttempts: 2 },
        },
        () => mockRt as unknown as RealtimeConnection,
      )
      const account = accountOf(client)
      const spy = spyOn(account, 'updatePresence').mockResolvedValue('PRESENCE_STATUS_ONLINE')
      await client.setStatus('online')
      expect(spy).toHaveBeenCalledTimes(1)
      mockRt.emit('close', { kind: 'retry', code: 1006, retryAfterMs: 0 })
      // Let the reconnect attempts exhaust and the client give up.
      await new Promise(r => setTimeout(r, 30))
      const callsAfterGiveUp = spy.mock.calls.length
      await Bun.sleep(400)
      expect(spy.mock.calls.length).toBe(callsAfterGiveUp)
    })

    it('does not leave a dangling heartbeat timer if disconnect() races an in-flight setStatus', async () => {
      const client = new ChattoClient(
        { baseUrl: 'https://chat.example.com', token: 'tk', presence: { intervalMs: 300 } },
        () => makeMockRt() as unknown as RealtimeConnection,
      )
      const account = accountOf(client)
      let resolveUpdate!: (v: string) => void
      spyOn(account, 'updatePresence').mockImplementation(() => new Promise(r => { resolveUpdate = r }))
      const setStatusPromise = client.setStatus('online')
      await client.disconnect()
      resolveUpdate('PRESENCE_STATUS_ONLINE')
      await setStatusPromise
      expect((client as any).presenceTimer).toBeNull()
    })

    it('setCustomStatus delegates to the account manager', async () => {
      const client = makeClient(makeMockRt())
      const account = accountOf(client)
      const spy = spyOn(account, 'updateCustomStatus').mockResolvedValue({ emoji: '🎧', text: 'listening' })
      const result = await client.setCustomStatus({ emoji: '🎧', text: 'listening' })
      expect(spy).toHaveBeenCalledWith({ emoji: '🎧', text: 'listening' })
      expect(result.emoji).toBe('🎧')
      await client.disconnect()
    })

    it('clearCustomStatus delegates to the account manager', async () => {
      const client = makeClient(makeMockRt())
      const account = accountOf(client)
      const spy = spyOn(account, 'deleteCustomStatus').mockResolvedValue(undefined)
      await client.clearCustomStatus()
      expect(spy).toHaveBeenCalled()
      await client.disconnect()
    })
  })

  afterEach(() => mock.restore())

  describe('session renewal', () => {
    afterEach(() => mock.restore())

    it('login() keeps the refresh token and expiry from the login response', async () => {
      spyOn(globalThis, 'fetch').mockImplementation(async () => ({
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({ success: true, token: 'at', refreshToken: 'rt', expiresIn: 900, refreshTokenExpiresIn: 1000, user: { id: 'U', login: 'u' } }),
      }) as Response)
      const client = await ChattoClient.login({ baseUrl: 'https://c', login: 'u', password: 'p', retainCredentials: false })
      expect(client.session.token).toBe('at')
      expect(client.session.refreshToken).toBe('rt')
      expect(client.session.expiresAt! - Date.now()).toBeGreaterThan(890_000)
    })

    it('refreshToken() emits tokenRefresh with the rotated session', async () => {
      spyOn(globalThis, 'fetch').mockImplementation(async () => ({
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({ access_token: 'at2', refresh_token: 'rt2', expires_in: 900, refresh_token_expires_in: 1000 }),
      }) as Response)
      const client = new ChattoClient({ baseUrl: 'https://c', token: 'at1', refreshToken: 'rt1' }, () => makeMockRt() as unknown as RealtimeConnection)
      const sessions: any[] = []
      client.on('tokenRefresh', s => sessions.push(s))
      await client.refreshToken()
      expect(sessions[0]).toMatchObject({ token: 'at2', refreshToken: 'rt2' })
      expect(client.session.token).toBe('at2')
    })

    it('connect() renews an access token that expires within a minute', async () => {
      const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(async () => ({
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({ access_token: 'at2', refresh_token: 'rt2', expires_in: 900, refresh_token_expires_in: 1000 }),
      }) as Response)
      const mockRt = makeMockRt()
      const client = new ChattoClient(
        { baseUrl: 'https://c', token: 'at1', refreshToken: 'rt1', tokenExpiresAt: Date.now() + 10_000 },
        () => mockRt as unknown as RealtimeConnection,
      )
      await client.connect()
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(client.session.token).toBe('at2')
      await client.disconnect()
    })

    it('rpc() calls any service and returns raw JSON without a schema', async () => {
      const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(async () => ({
        ok: true, status: 200, statusText: 'OK', json: async () => ({ roles: [{ name: 'admin' }] }),
      }) as Response)
      const client = new ChattoClient({ baseUrl: 'https://c', token: 'at' }, () => makeMockRt() as unknown as RealtimeConnection)
      const res = await client.rpc('chatto.admin.v1.RoleService', 'ListRoles')
      expect(res).toEqual({ roles: [{ name: 'admin' }] })
      const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('https://c/api/connect/chatto.admin.v1.RoleService/ListRoles')
      expect(init.body).toBe('{}')
    })
  })
})
