import { describe, it, expect } from 'bun:test'
import { RealtimeConnection, classifyCloseCode, classifyRealtimeClose, type CloseReason } from '../../src/realtime/connection'
import type { RealtimeEvent } from '../../src/realtime/generated'
import { MockWs, decodeSubscribe, encodeServerFrame, handshake } from './helpers'

function makeConn(ws: MockWs | (() => MockWs), opts = {}): RealtimeConnection {
  const factory = typeof ws === 'function' ? ws : () => ws
  return new RealtimeConnection('ws://chat.example.com/api/realtime', () => 'mytoken', factory as any, opts)
}

const tick = () => new Promise(r => setImmediate(r))

describe('RealtimeConnection', () => {
  it('sends one RealtimeSubscribe on open and resolves on caught_up', async () => {
    const ws = new MockWs()
    handshake(ws)
    const conn = makeConn(ws)
    const caught: unknown[] = []
    conn.on('caughtUp', c => caught.push(c))
    await conn.connect()

    expect(ws.sent).toHaveLength(1)
    expect(decodeSubscribe(ws.sent[0]!)).toEqual({
      protocolVersion: 4,
      bearerToken: 'mytoken',
      initialState: 'REALTIME_INITIAL_STATE_LIVE_ONLY',
    })
    expect(caught).toEqual([{ cursor: 'cur_0', recovery: 'REALTIME_RECOVERY_LIVE_ONLY' }])
    expect(conn.cursor).toBe('cur_0')
    conn.disconnect()
  })

  it('requests a snapshot when configured and emits it', async () => {
    const ws = new MockWs()
    const conn = makeConn(ws, { initialState: 'REALTIME_INITIAL_STATE_SNAPSHOT' })
    const snapshots: any[] = []
    conn.on('snapshot', s => snapshots.push(s))
    setImmediate(() => {
      ws.emit('open')
      ws.emit('message', encodeServerFrame({ snapshot: { server: { name: 'S' }, rooms: [{ room: { id: 'R1', name: 'general' } }] } }))
      ws.emit('message', encodeServerFrame({ caughtUp: { cursor: 'c', recovery: 'REALTIME_RECOVERY_SNAPSHOT' } }))
    })
    await conn.connect()
    expect(decodeSubscribe(ws.sent[0]!).initialState).toBe('REALTIME_INITIAL_STATE_SNAPSHOT')
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].rooms[0].room.id).toBe('R1')
    expect(snapshots[0].users).toEqual([])
    conn.disconnect()
  })

  it('emits events and advances the cursor from events and heartbeats', async () => {
    const ws = new MockWs()
    handshake(ws)
    const conn = makeConn(ws)
    await conn.connect()
    const events: RealtimeEvent[] = []
    conn.on('event', e => events.push(e))

    ws.emit('message', encodeServerFrame({
      event: { id: 'E1', createdAt: { seconds: 1752055200 }, actorId: 'U1', cursor: 'cur_1', messageRetracted: { roomId: 'R1', messageEventId: 'E0' } },
    }))
    expect(events).toHaveLength(1)
    expect(events[0]!.createdAt).toBe('2025-07-09T10:00:00.000Z')
    expect(conn.cursor).toBe('cur_1')

    // Cursorless events do not move the cursor.
    ws.emit('message', encodeServerFrame({ event: { id: 'E2', userTyping: { roomId: 'R1' } } }))
    expect(conn.cursor).toBe('cur_1')

    ws.emit('message', encodeServerFrame({ heartbeat: { cursor: 'cur_2' } }))
    expect(conn.cursor).toBe('cur_2')
    conn.disconnect()
  })

  it('resumes from the last cursor on the next connect', async () => {
    const sockets: MockWs[] = []
    const conn = makeConn(() => {
      const ws = new MockWs()
      sockets.push(ws)
      handshake(ws, `cur_${sockets.length}`)
      return ws
    })
    await conn.connect()
    sockets[0]!.emit('close', 1006, Buffer.from(''))
    await conn.connect()
    expect(decodeSubscribe(sockets[1]!.sent[0]!).resumeCursor).toBe('cur_1')
    conn.resetCursor()
    await conn.connect()
    expect(decodeSubscribe(sockets[2]!.sent[0]!).resumeCursor).toBeUndefined()
    conn.disconnect()
  })

  it('rejects connect and reports a close frame received before caught_up', async () => {
    const ws = new MockWs()
    const conn = makeConn(ws)
    const reasons: CloseReason[] = []
    conn.on('close', r => reasons.push(r))
    setImmediate(() => {
      ws.emit('open')
      ws.emit('message', encodeServerFrame({
        close: { code: 'REALTIME_CLOSE_CODE_AUTHENTICATION_REQUIRED', message: 'authentication required', reconnect: false },
      }))
    })
    await expect(conn.connect()).rejects.toThrow('REALTIME_CLOSE_CODE_AUTHENTICATION_REQUIRED')
    expect(reasons).toEqual([{
      kind: 'auth', code: 1000, realtimeCode: 'REALTIME_CLOSE_CODE_AUTHENTICATION_REQUIRED', message: 'authentication required', retryAfterMs: 0,
    }])
    expect(ws.closedWith).toBe(1000)
  })

  it('drops the cursor on RESYNC_REQUIRED and passes retry-after through', async () => {
    const ws = new MockWs()
    handshake(ws)
    const conn = makeConn(ws)
    await conn.connect()
    const reasons: CloseReason[] = []
    conn.on('close', r => reasons.push(r))
    ws.emit('message', encodeServerFrame({
      close: { code: 'REALTIME_CLOSE_CODE_RESYNC_REQUIRED', reconnect: true, retryAfter: { seconds: 3 } },
    }))
    expect(reasons[0]).toMatchObject({ kind: 'retry', retryAfterMs: 3000 })
    expect(conn.cursor).toBeUndefined()
  })

  it('emits close only once when the socket closes after a close frame', async () => {
    const ws = new MockWs()
    handshake(ws)
    const conn = makeConn(ws)
    await conn.connect()
    const reasons: CloseReason[] = []
    conn.on('close', r => reasons.push(r))
    ws.emit('message', encodeServerFrame({ close: { code: 'REALTIME_CLOSE_CODE_SESSION_TERMINATED', reconnect: false } }))
    ws.emit('close', 1000, Buffer.from(''))
    expect(reasons.map(r => r.kind)).toEqual(['terminated'])
  })

  it('closes the socket without advancing the cursor on an undecodable frame', async () => {
    const ws = new MockWs()
    handshake(ws)
    const conn = makeConn(ws)
    await conn.connect()
    const errors: Error[] = []
    conn.on('error', e => errors.push(e))
    ws.emit('message', Buffer.from([0xff, 0xff, 0xff]))
    expect(errors).toHaveLength(1)
    expect(ws.closedWith).toBe(1003)
    expect(conn.cursor).toBe('cur_0')
  })

  it('terminates a stalled socket after the heartbeat timeout', async () => {
    const ws = new MockWs()
    handshake(ws)
    const conn = makeConn(ws, { heartbeatTimeoutMs: 50 })
    const reasons: CloseReason[] = []
    conn.on('close', r => reasons.push(r))
    await conn.connect()
    await new Promise(r => setTimeout(r, 120))
    expect(ws.terminated).toBe(true)
    expect(reasons[0]?.kind).toBe('retry')
  })

  it('keeps a socket alive while heartbeats arrive', async () => {
    const ws = new MockWs()
    handshake(ws)
    const conn = makeConn(ws, { heartbeatTimeoutMs: 60 })
    await conn.connect()
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setTimeout(r, 30))
      ws.emit('message', encodeServerFrame({ heartbeat: {} }))
    }
    expect(ws.terminated).toBe(false)
    conn.disconnect()
  })

  it('reports a user-initiated disconnect as clean', async () => {
    const ws = new MockWs()
    handshake(ws)
    const conn = makeConn(ws)
    await conn.connect()
    const reasons: CloseReason[] = []
    conn.on('close', r => reasons.push(r))
    conn.disconnect()
    ws.emit('close', 1000, Buffer.from(''))
    await tick()
    expect(reasons.map(r => r.kind)).toEqual(['clean'])
  })
})

describe('close classification', () => {
  it('classifies WebSocket status codes', () => {
    expect(classifyCloseCode(1006)).toBe('retry')
    expect(classifyCloseCode(1008)).toBe('auth')
    expect(classifyCloseCode(1002)).toBe('fatal')
  })

  it('classifies realtime close codes', () => {
    expect(classifyRealtimeClose('REALTIME_CLOSE_CODE_SESSION_RENEWAL_REQUIRED', false)).toBe('auth')
    expect(classifyRealtimeClose('REALTIME_CLOSE_CODE_UNSUPPORTED_PROTOCOL', false)).toBe('fatal')
    expect(classifyRealtimeClose('REALTIME_CLOSE_CODE_PRIVILEGED_MODE_EXPIRED', false)).toBe('retry')
    expect(classifyRealtimeClose('REALTIME_CLOSE_CODE_TEMPORARILY_UNAVAILABLE', true)).toBe('retry')
    expect(classifyRealtimeClose('REALTIME_CLOSE_CODE_TEMPORARILY_UNAVAILABLE', false)).toBe('clean')
  })
})
