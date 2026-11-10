import {
  RoomSchema,
  ListRoomsResponseSchema,
  GetRoomResponseSchema,
  GetRoomEventsResponseSchema,
  GetRoomEventsAroundResponseSchema,
  RoomWithViewerStateSchema,
  RoomGroupSchema,
  PageInfoSchema,
  timelineEventKind,
} from '../../src/schemas/room'

const validRoom = {
  id: 'room_1',
  name: 'General',
  kind: 'ROOM_KIND_CHANNEL',
}

describe('RoomSchema', () => {
  it('parses a valid room', () => {
    const room = RoomSchema.parse(validRoom)
    expect(room.id).toBe('room_1')
    expect(room.name).toBe('General')
  })

  it('defaults archived and universal to false', () => {
    const room = RoomSchema.parse(validRoom)
    expect(room.archived).toBe(false)
    expect(room.universal).toBe(false)
  })

  it('allows description to be absent', () => {
    const room = RoomSchema.parse(validRoom)
    expect(room.description).toBeUndefined()
  })
})

describe('ListRoomsResponseSchema', () => {
  it('parses a rooms list response', () => {
    const res = ListRoomsResponseSchema.parse({
      rooms: [{ room: validRoom }],
    })
    expect(res.rooms).toHaveLength(1)
    expect(res.rooms[0].room.id).toBe('room_1')
  })

  // proto3 JSON omits empty repeated fields, so a member of no rooms gets `{}`.
  it('defaults rooms to empty array when absent', () => {
    const res = ListRoomsResponseSchema.parse({})
    expect(res.rooms).toEqual([])
  })
})

describe('GetRoomResponseSchema', () => {
  it('parses a single room response', () => {
    const res = GetRoomResponseSchema.parse({ room: { room: validRoom } })
    expect(res.room.room.id).toBe('room_1')
  })
})

describe('GetRoomEventsResponseSchema', () => {
  it('parses a timeline page with a message event', () => {
    const validMessage = {
      id: 'evt_1',
      roomId: 'room_1',
      createdAt: '2026-07-09T10:00:00Z',
      actorId: 'user_1',
    }
    const res = GetRoomEventsResponseSchema.parse({
      page: {
        events: [
          { id: 'evt_1', createdAt: '2026-07-09T10:00:00Z', actorId: 'user_1',
            messagePosted: { message: validMessage } },
        ],
        hasOlder: false,
        hasNewer: false,
      },
    })
    expect(res.page.events[0].messagePosted?.message.id).toBe('evt_1')
  })

  it('defaults hasOlder and hasNewer to false when absent', () => {
    const res = GetRoomEventsResponseSchema.parse({ page: { events: [] } })
    expect(res.page.hasOlder).toBe(false)
    expect(res.page.hasNewer).toBe(false)
  })

  // An empty page comes back as `{ page: {} }` — the repeated `events` field is
  // omitted (proto3 JSON), so it must default to [] rather than being required.
  it('defaults events to empty array when the page is empty', () => {
    const res = GetRoomEventsResponseSchema.parse({ page: {} })
    expect(res.page.events).toEqual([])
  })
})

describe('RoomSchema v0.5.0 fields', () => {
  it('parses a live-server room', () => {
    const room = RoomSchema.parse({
      id: 'RHM2DtNetvopQqO', kind: 'ROOM_KIND_CHANNEL', name: 'announcements', groupId: 'G_1', universal: true,
      threadingMode: 'ROOM_THREADING_MODE_ENABLED', threadSlowModeSeconds: 0,
      createdAt: '2026-11-10T00:15:03.811088648Z', showMembershipEvents: true,
    })
    expect(room.slowModeSeconds).toBe(0)
    expect(room.threadSlowModeSeconds).toBe(0)
    expect(room.showMembershipEvents).toBe(true)
  })
})

describe('RoomWithViewerStateSchema', () => {
  it('parses a pending invitation in viewer state', () => {
    const r = RoomWithViewerStateSchema.parse({
      room: validRoom,
      viewerState: { invitation: { id: 'I_1', roomId: 'room_1', status: 'ROOM_INVITATION_STATUS_PENDING' }, canRejoin: true },
    })
    expect(r.viewerState?.invitation?.status).toBe('ROOM_INVITATION_STATUS_PENDING')
    expect(r.viewerState?.invitation?.canAccept).toBe(false)
    expect(r.viewerState?.isMember).toBe(false)
    expect(r.viewerState?.permissions).toEqual([])
  })
})

describe('RoomGroupSchema', () => {
  it('parses room and sidebar-link items', () => {
    const g = RoomGroupSchema.parse({
      id: 'G_1',
      items: [{ room: { room: validRoom } }, { sidebarLink: { id: 'L_1', label: 'Docs' } }],
    })
    expect(g.name).toBe('')
    expect(g.items[0].room?.room.id).toBe('room_1')
    expect(g.items[1].sidebarLink).toEqual({ id: 'L_1', label: 'Docs', url: '' })
  })
})

describe('PageInfoSchema', () => {
  it('coerces int64 totalCount and defaults omitted fields', () => {
    expect(PageInfoSchema.parse({ totalCount: '3' })).toEqual({ totalCount: 3, hasMore: false })
    expect(PageInfoSchema.parse({})).toEqual({ totalCount: 0, hasMore: false })
  })
})

describe('room timeline events', () => {
  const base = { id: 'E', createdAt: 't', actorId: 'U_1' }

  it('models every RoomTimelineEvent kind', () => {
    const res = GetRoomEventsResponseSchema.parse({
      page: {
        events: [
          { ...base, roomCreated: { roomId: 'r' } },
          { ...base, roomUpdated: { roomId: 'r' } },
          { ...base, roomDeleted: { roomId: 'r' } },
          { ...base, roomArchived: { roomId: 'r' } },
          { ...base, roomUnarchived: { roomId: 'r' } },
          { ...base, roomThreadingModeChanged: { roomId: 'r', threadingMode: 'ROOM_THREADING_MODE_REQUIRED' } },
          { ...base, userJoinedRoom: { roomId: 'r' } },
          { ...base, userLeftRoom: {} },
          { ...base, callStarted: { roomId: 'r', callId: 'c' } },
          { ...base, callEnded: { roomId: 'r', callId: 'c' } },
          { ...base, somethingNew: {} },
        ],
      },
    })
    expect(res.page.events.map(timelineEventKind)).toEqual([
      'roomCreated', 'roomUpdated', 'roomDeleted', 'roomArchived', 'roomUnarchived',
      'roomThreadingModeChanged', 'userJoinedRoom', 'userLeftRoom', 'callStarted', 'callEnded', 'unknown',
    ])
    expect(res.page.events[5].roomThreadingModeChanged?.threadingMode).toBe('ROOM_THREADING_MODE_REQUIRED')
    expect(res.page.events[7].userLeftRoom?.roomId).toBe('')
    expect(res.page.events[9].callEnded?.callId).toBe('c')
  })

  it('identifies messagePosted and parses includes.users', () => {
    const res = GetRoomEventsResponseSchema.parse({
      page: {
        events: [{ ...base, messagePosted: { message: { id: 'E', roomId: 'r', createdAt: 't', actorId: 'U_1' } } }],
        includes: { users: { U_1: { id: 'U_1', login: 'sdktest', displayName: 'SDK Test', presenceStatus: 'PRESENCE_STATUS_ONLINE' } } },
      },
    })
    expect(timelineEventKind(res.page.events[0])).toBe('messagePosted')
    expect(res.page.includes?.users.U_1.displayName).toBe('SDK Test')
  })

  it('defaults omitted createdAt/actorId and includes.users', () => {
    const res = GetRoomEventsResponseSchema.parse({ page: { events: [{ id: 'E' }], includes: {} } })
    expect(res.page.events[0].actorId).toBe('')
    expect(res.page.includes?.users).toEqual({})
  })

  it('GetRoomEventsAroundResponseSchema defaults targetIndex', () => {
    const res = GetRoomEventsAroundResponseSchema.parse({ page: {} })
    expect(res.targetIndex).toBe(0)
    expect(res.page.events).toEqual([])
  })
})
