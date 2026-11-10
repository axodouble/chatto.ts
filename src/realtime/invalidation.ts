import type { RealtimeEvent } from './generated'

/** Cache entries a realtime event makes stale. */
export interface CacheInvalidation {
  users: string[]
  rooms: string[]
  /** Discard everything (the viewer's own permissions changed). */
  all: boolean
}

// Events whose payload `roomId` names a room whose metadata, settings, or
// membership (and so the viewer state) changed.
const ROOM_EVENTS = new Set<keyof RealtimeEvent>([
  'roomUpdated',
  'roomDeleted',
  'roomArchived',
  'roomUnarchived',
  'roomUniversalChanged',
  'roomSlowModeChanged',
  'roomThreadingModeChanged',
  'roomMembershipEventsVisibilityChanged',
  'userJoinedRoom',
  'userLeftRoom',
  'roomInvitationAccepted',
])

// Events whose payload `userId` names a user whose public resource changed.
const USER_EVENTS = new Set<keyof RealtimeEvent>([
  'userProfileChanged',
  'userAccountDeleted',
  'userAccountDeactivationChanged',
  'roleAssigned',
  'roleRevoked',
])

export function cacheInvalidation(event: RealtimeEvent): CacheInvalidation {
  const result: CacheInvalidation = { users: [], rooms: [], all: false }
  const name = event.event
  if (name == null) return result
  const payload = event[name] as { roomId?: string; userId?: string } | undefined

  if (ROOM_EVENTS.has(name) && payload?.roomId) result.rooms.push(payload.roomId)
  if (USER_EVENTS.has(name) && payload?.userId) result.users.push(payload.userId)
  // Presence is part of the cached User resource.
  if (name === 'presenceChanged' && event.actorId) result.users.push(event.actorId)
  if (name === 'viewerPermissionsChanged' || name === 'rolePermissionsChanged' || name === 'roleDeleted') {
    result.all = true
  }
  return result
}
