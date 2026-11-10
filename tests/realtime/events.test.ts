import { describe, it, expect } from 'bun:test'
import { mapRealtimeEvent, toTypedEvent } from '../../src/realtime/events'
import { REALTIME_EVENT_NAMES, type RealtimeEvent } from '../../src/realtime/generated'

const env = (fields: Partial<RealtimeEvent>): RealtimeEvent =>
  ({ id: 'E1', createdAt: '2026-11-10T00:00:00.000Z', actorId: 'U1', cursor: 'c1', ...fields }) as RealtimeEvent

describe('mapRealtimeEvent', () => {
  it('maps message_posted to messageCreate using the envelope id as message id', () => {
    expect(mapRealtimeEvent(env({ event: 'messagePosted', messagePosted: { roomId: 'R1' } as any })))
      .toEqual({ kind: 'messageCreate', roomId: 'R1', messageEventId: 'E1' })
  })

  it('maps message_edited to messageUpdate', () => {
    expect(mapRealtimeEvent(env({ event: 'messageEdited', messageEdited: { roomId: 'R1', messageEventId: 'M1' } })))
      .toEqual({ kind: 'messageUpdate', roomId: 'R1', messageEventId: 'M1' })
  })

  it('maps message_retracted to messageDelete with the actor', () => {
    expect(mapRealtimeEvent(env({ event: 'messageRetracted', messageRetracted: { roomId: 'R1', messageEventId: 'M1' } })))
      .toEqual({ kind: 'messageDelete', event: { roomId: 'R1', eventId: 'M1', actorId: 'U1' } })
  })

  it('maps reactions', () => {
    const r = { roomId: 'R1', messageEventId: 'M1', emoji: 'thumbsup' }
    expect(mapRealtimeEvent(env({ event: 'reactionAdded', reactionAdded: r })))
      .toEqual({ kind: 'reactionAdd', event: { ...r, actorId: 'U1' } })
    expect(mapRealtimeEvent(env({ event: 'reactionRemoved', reactionRemoved: r, actorId: undefined })))
      .toEqual({ kind: 'reactionRemove', event: { ...r, actorId: undefined } })
  })

  it('returns null for events without a convenience mapping', () => {
    expect(mapRealtimeEvent(env({ event: 'userTyping', userTyping: { roomId: 'R1' } }))).toBeNull()
    expect(mapRealtimeEvent(env({}))).toBeNull()
  })
})

describe('toTypedEvent', () => {
  it('returns the variant name, payload and envelope metadata', () => {
    expect(toTypedEvent(env({ event: 'roomArchived', roomArchived: { roomId: 'R1' } }))).toEqual({
      name: 'roomArchived',
      payload: { roomId: 'R1' },
      meta: { id: 'E1', createdAt: '2026-11-10T00:00:00.000Z', actorId: 'U1', cursor: 'c1' },
    })
  })

  it('returns null for an unknown variant', () => {
    expect(toTypedEvent(env({}))).toBeNull()
  })

  it('covers the full Chatto 0.5.0 event catalogue', () => {
    expect(REALTIME_EVENT_NAMES.length).toBe(54)
    expect(REALTIME_EVENT_NAMES).toContain('presenceChanged')
    expect(REALTIME_EVENT_NAMES).toContain('roomInvitationCreated')
  })
})
