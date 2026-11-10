import { describe, it, expect } from 'bun:test'
import { cacheInvalidation } from '../../src/realtime/invalidation'

const ev = (fields: object) => ({ id: 'E1', actorId: 'U_actor', ...fields }) as any

describe('cacheInvalidation', () => {
  it('invalidates rooms for room metadata and membership events', () => {
    expect(cacheInvalidation(ev({ event: 'roomUpdated', roomUpdated: { roomId: 'R1' } }))).toEqual({ users: [], rooms: ['R1'], all: false })
    expect(cacheInvalidation(ev({ event: 'userJoinedRoom', userJoinedRoom: { roomId: 'R2' } })).rooms).toEqual(['R2'])
  })

  it('invalidates users for profile and presence changes', () => {
    expect(cacheInvalidation(ev({ event: 'userProfileChanged', userProfileChanged: { userId: 'U1' } })).users).toEqual(['U1'])
    expect(cacheInvalidation(ev({ event: 'presenceChanged', presenceChanged: { status: 'PRESENCE_STATUS_AWAY' } })).users).toEqual(['U_actor'])
  })

  it('invalidates everything when the viewer permissions changed', () => {
    expect(cacheInvalidation(ev({ event: 'viewerPermissionsChanged', viewerPermissionsChanged: {} })).all).toBe(true)
  })

  it('leaves caches alone for message events', () => {
    expect(cacheInvalidation(ev({ event: 'messagePosted', messagePosted: { roomId: 'R1' } }))).toEqual({ users: [], rooms: [], all: false })
  })
})
