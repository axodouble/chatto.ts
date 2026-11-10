import { describe, it, expect } from 'bun:test'
import golden from '../fixtures/realtime-golden.json'
import { decodeServerFrame, encodeSubscribe, REALTIME_PROTOCOL_VERSION } from '../../src/realtime/frames'
import { decodeSubscribe, encodeServerFrame } from './helpers'

const frame = (name: keyof typeof golden) => decodeServerFrame(Buffer.from(golden[name], 'hex'))

describe('encodeSubscribe', () => {
  it('encodes protocol version 4, token, cursor and initial state', () => {
    const decoded = decodeSubscribe(encodeSubscribe({
      bearerToken: 'tok',
      resumeCursor: 'cur_1',
      initialState: 'REALTIME_INITIAL_STATE_SNAPSHOT',
    }))
    expect(REALTIME_PROTOCOL_VERSION).toBe(4)
    expect(decoded).toEqual({
      protocolVersion: 4,
      bearerToken: 'tok',
      resumeCursor: 'cur_1',
      initialState: 'REALTIME_INITIAL_STATE_SNAPSHOT',
    })
  })

  it('omits an absent cursor', () => {
    const decoded = decodeSubscribe(encodeSubscribe({ initialState: 'REALTIME_INITIAL_STATE_LIVE_ONLY' }))
    expect(decoded.resumeCursor).toBeUndefined()
    expect(decoded.bearerToken).toBeUndefined()
  })
})

// Golden frames were captured from a real Chatto 0.5.0 server.
describe('decodeServerFrame (golden frames from Chatto 0.5.0)', () => {
  it('decodes message_posted with envelope metadata', () => {
    const f = frame('messagePosted')
    expect(f.frame).toBe('event')
    const e = f.event!
    expect(e.event).toBe('messagePosted')
    expect(e.id).toMatch(/^E/)
    expect(e.actorId).toMatch(/^U/)
    expect(e.cursor).toBeTruthy()
    expect(Date.parse(e.createdAt!)).toBeGreaterThan(Date.parse('2026-01-01T00:00:00Z'))
    expect(e.messagePosted!.roomId).toMatch(/^R/)
    expect(e.messagePosted!.roomKind).toBe('ROOM_KIND_CHANNEL')
    expect(e.messagePosted!.bodyPlaintext).toBe('golden frame capture')
    expect(e.messagePosted!.mentions).toEqual([])
    expect(e.messagePosted!.threadRootEventId).toBe('')
  })

  it('decodes edits, retractions and reactions', () => {
    expect(frame('messageEdited').event!.messageEdited!.messageEventId).toMatch(/^E/)
    expect(frame('messageRetracted').event!.messageRetracted!.messageEventId).toMatch(/^E/)
    expect(frame('reactionAdded').event!.reactionAdded!.emoji).toBe('thumbsup')
    expect(frame('reactionRemoved').event!.reactionRemoved!.emoji).toBe('thumbsup')
  })

  it('decodes cursorless events without a cursor key', () => {
    const e = frame('notificationUnreadStateChanged').event!
    expect(e.event).toBe('notificationUnreadStateChanged')
    expect('cursor' in e).toBe(false)
  })

  it('decodes caught_up with its recovery result', () => {
    const f = frame('caughtUp')
    expect(f.frame).toBe('caughtUp')
    expect(f.caughtUp!.recovery).toBe('REALTIME_RECOVERY_LIVE_ONLY')
    expect(f.caughtUp!.cursor).toBeTruthy()
  })
})

describe('decodeServerFrame (synthetic)', () => {
  it('converts the close retry Duration to milliseconds and the code to its name', () => {
    const f = decodeServerFrame(encodeServerFrame({
      close: { code: 'REALTIME_CLOSE_CODE_TEMPORARILY_UNAVAILABLE', message: 'busy', reconnect: true, retryAfter: { seconds: 2, nanos: 500_000_000 } },
    }))
    expect(f.close).toEqual({ code: 'REALTIME_CLOSE_CODE_TEMPORARILY_UNAVAILABLE', message: 'busy', reconnect: true, retryAfter: 2500 })
  })

  it('decodes a heartbeat with and without a cursor', () => {
    expect(decodeServerFrame(encodeServerFrame({ heartbeat: { cursor: 'c' } })).heartbeat).toEqual({ cursor: 'c' })
    expect(decodeServerFrame(encodeServerFrame({ heartbeat: {} })).heartbeat).toEqual({})
  })

  it('decodes nested enums and oneofs (presence, mentions)', () => {
    const f = decodeServerFrame(encodeServerFrame({
      event: {
        id: 'E1',
        messagePosted: { roomId: 'R1', mentions: [{ role: { roleName: 'mods' }, includesViewer: true }] },
      },
    }))
    expect(f.event!.messagePosted!.mentions).toEqual([{ role: { roleName: 'mods' }, includesViewer: true, cause: 'role' }])
    const p = decodeServerFrame(encodeServerFrame({ event: { id: 'E2', actorId: 'U1', presenceChanged: { status: 'PRESENCE_STATUS_AWAY' } } }))
    expect(p.event!.presenceChanged!.status).toBe('PRESENCE_STATUS_AWAY')
  })

  it('keeps envelope metadata for an event variant this SDK does not know', () => {
    // Field 999 inside RealtimeEvent: an unknown future variant.
    const known = encodeServerFrame({ event: { id: 'E9', cursor: 'c9' } })
    const unknownVariant = Buffer.from([0xba, 0x3e, 0x00]) // tag 999, wire type 2, length 0
    const eventBody = Buffer.concat([known.subarray(2), unknownVariant])
    const buf = Buffer.concat([Buffer.from([0x0a, eventBody.length]), eventBody])
    const f = decodeServerFrame(buf)
    expect(f.event!.id).toBe('E9')
    expect(f.event!.cursor).toBe('c9')
    expect(f.event!.event).toBeUndefined()
  })
})
