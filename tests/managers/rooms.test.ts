import { describe, it, expect, mock } from 'bun:test'
import { RoomManager } from '../../src/managers/rooms'
import { RoomInvitationManager } from '../../src/managers/room-invitations'
import { Room } from '../../src/resources/room'
import { User } from '../../src/resources/user'
import { Attachment } from '../../src/resources/attachment'
import { ChattoValidationError } from '../../src/errors'

const validRoom = {
  id: 'room_1',
  name: 'General',
  kind: 'ROOM_KIND_CHANNEL',
  archived: false,
  universal: false,
}

const member = { user: { id: 'U_1', login: 'alice', displayName: 'Alice' }, roles: ['everyone'] }
const msg = { id: 'evt_1', roomId: 'room_1', createdAt: '2026-11-10T00:00:00Z', actorId: 'U_1', body: 'hi' }

/**
 * Mock RestClient.post that, like the real client, parses the response with the
 * given schema. Responses are returned in order; the last one repeats.
 */
function parsingPost(...responses: unknown[]) {
  let call = 0
  return mock(async (_s: string, _m: string, _b: unknown, schema: any) =>
    schema.parse(responses[Math.min(call++, responses.length - 1)]),
  )
}

function makeCtx(...responses: unknown[]) {
  return {
    rest: { post: parsingPost(...responses) },
    hydrateMessage: mock(async (data: any) => ({ hydrated: data.id })),
  } as any
}

function lastCall(ctx: any) {
  return ctx.rest.post.mock.calls.at(-1)
}

function expectCall(ctx: any, service: string, method: string, body: unknown) {
  expect(ctx.rest.post).toHaveBeenCalledWith(`chatto.api.v1.${service}`, method, body, expect.anything())
}

describe('RoomManager', () => {
  it('exposes an invitations manager', () => {
    expect(new RoomManager(makeCtx({})).invitations).toBeInstanceOf(RoomInvitationManager)
  })

  describe('.list()', () => {
    it('calls ListRooms and returns Room[]', async () => {
      const ctx = makeCtx({ rooms: [{ room: validRoom }] })
      const rooms = await new RoomManager(ctx).list()
      expectCall(ctx, 'RoomDirectoryService', 'ListRooms', {})
      expect(rooms).toHaveLength(1)
      expect(rooms[0]).toBeInstanceOf(Room)
      expect(rooms[0].id).toBe('room_1')
    })

    it('follows hasMore across pages when no limit/offset is given', async () => {
      const ctx = makeCtx(
        { rooms: [{ room: validRoom }], page: { totalCount: '2', hasMore: true } },
        { rooms: [{ room: { ...validRoom, id: 'room_2' } }], page: { totalCount: '2' } },
      )
      const rooms = await new RoomManager(ctx).list({ scope: 'channels' })
      expect(rooms.map(r => r.id)).toEqual(['room_1', 'room_2'])
      expect(ctx.rest.post.mock.calls[0][2]).toEqual({ scope: 'ROOM_DIRECTORY_SCOPE_CHANNELS' })
      expect(ctx.rest.post.mock.calls[1][2]).toEqual({ scope: 'ROOM_DIRECTORY_SCOPE_CHANNELS', page: { offset: 1, limit: undefined } })
    })

    it('returns an empty list for `{}`', async () => {
      expect(await new RoomManager(makeCtx({})).list()).toEqual([])
    })
  })

  describe('.listPage()', () => {
    it('sends scope/archive filter/page and passes viewer state into Room', async () => {
      const ctx = makeCtx({
        rooms: [{
          room: validRoom,
          viewerState: { isMember: true, permissions: [{ permission: 'message.post', granted: true }, { permission: 'room.manage' }] },
        }],
        page: { totalCount: '7', hasMore: true },
      })
      const page = await new RoomManager(ctx).listPage({ scope: 'ROOM_DIRECTORY_SCOPE_DMS', archive: 'all', limit: 1, offset: 2 })
      expectCall(ctx, 'RoomDirectoryService', 'ListRooms', {
        scope: 'ROOM_DIRECTORY_SCOPE_DMS',
        archiveFilter: 'ROOM_ARCHIVE_FILTER_ALL',
        page: { limit: 1, offset: 2 },
      })
      expect(page.totalCount).toBe(7)
      expect(page.hasMore).toBe(true)
      const room = page.items[0]
      expect(room.isMember).toBe(true)
      expect(room.can('message.post')).toBe(true)
      expect(room.can('room.manage')).toBe(false)
    })
  })

  describe('.fetch()', () => {
    it('calls GetRoom and returns a Room', async () => {
      const ctx = makeCtx({ room: { room: validRoom, memberUserIds: ['U_1'] } })
      const room = await new RoomManager(ctx).fetch('room_1')
      expectCall(ctx, 'RoomDirectoryService', 'GetRoom', { roomId: 'room_1' })
      expect(room).toBeInstanceOf(Room)
      expect(room.name).toBe('General')
      expect(room.memberUserIds).toEqual(['U_1'])
    })
  })

  describe('.fetchMany()', () => {
    it('calls BatchGetRooms', async () => {
      const ctx = makeCtx({ rooms: [{ room: validRoom }] })
      const rooms = await new RoomManager(ctx).fetchMany(['room_1'])
      expectCall(ctx, 'RoomDirectoryService', 'BatchGetRooms', { roomIds: ['room_1'] })
      expect(rooms[0].id).toBe('room_1')
    })

    it('short-circuits empty input and rejects > 100 ids', async () => {
      const ctx = makeCtx({})
      expect(await new RoomManager(ctx).fetchMany([])).toEqual([])
      expect(ctx.rest.post).not.toHaveBeenCalled()
      await expect(new RoomManager(ctx).fetchMany(Array(101).fill('r'))).rejects.toBeInstanceOf(ChattoValidationError)
    })

    it('handles an omitted rooms field', async () => {
      expect(await new RoomManager(makeCtx({})).fetchMany(['x'])).toEqual([])
    })
  })

  describe('room groups', () => {
    const group = {
      id: 'G_1',
      name: 'Lobby',
      items: [{ room: { room: validRoom } }, { sidebarLink: { id: 'L_1', label: 'Docs', url: '/docs' } }],
      viewerState: { permissions: [{ permission: 'room.create', granted: true }] },
    }

    it('.listGroups() calls ListRoomGroups', async () => {
      const ctx = makeCtx({ groups: [group] })
      const groups = await new RoomManager(ctx).listGroups()
      expectCall(ctx, 'RoomDirectoryService', 'ListRoomGroups', {})
      expect(groups[0].items[0].room?.room.id).toBe('room_1')
      expect(groups[0].items[1].sidebarLink?.url).toBe('/docs')
      expect(await new RoomManager(makeCtx({})).listGroups()).toEqual([])
    })

    it('.fetchGroup() calls GetRoomGroup and defaults omitted fields', async () => {
      const ctx = makeCtx({ group: { id: 'G_2' } })
      const g = await new RoomManager(ctx).fetchGroup('G_2')
      expectCall(ctx, 'RoomDirectoryService', 'GetRoomGroup', { groupId: 'G_2' })
      expect(g).toEqual({ id: 'G_2', name: '', items: [] })
    })

    it('.fetchGroups() calls BatchGetRoomGroups and short-circuits empty input', async () => {
      const ctx = makeCtx({ groups: [group] })
      expect(await new RoomManager(ctx).fetchGroups([])).toEqual([])
      await new RoomManager(ctx).fetchGroups(['G_1'])
      expectCall(ctx, 'RoomDirectoryService', 'BatchGetRoomGroups', { groupIds: ['G_1'] })
    })
  })

  describe('lifecycle', () => {
    it('.create() calls CreateRoom with a mapped threading mode', async () => {
      const ctx = makeCtx({ room: validRoom })
      const room = await new RoomManager(ctx).create({ name: 'General', groupId: 'G_1', threadingMode: 'required' })
      expectCall(ctx, 'RoomService', 'CreateRoom', {
        name: 'General',
        description: undefined,
        groupId: 'G_1',
        universal: undefined,
        threadingMode: 'ROOM_THREADING_MODE_REQUIRED',
      })
      expect(room).toBeInstanceOf(Room)
    })

    it('.update() sends only given fields plus an update mask; null resets', async () => {
      const ctx = makeCtx({ room: { ...validRoom, slowModeSeconds: 30, threadSlowModeSeconds: 0 } })
      const room = await new RoomManager(ctx).update('room_1', {
        name: 'New',
        description: null,
        slowModeSeconds: 30,
        threadingMode: 'ROOM_THREADING_MODE_DISABLED',
      })
      expectCall(ctx, 'RoomService', 'UpdateRoom', {
        roomId: 'room_1',
        name: 'New',
        slowModeSeconds: 30,
        threadingMode: 'ROOM_THREADING_MODE_DISABLED',
        updateMask: 'name,description,slowModeSeconds,threadingMode',
      })
      expect(room.slowModeSeconds).toBe(30)
      expect(room.threadSlowModeSeconds).toBe(0)
    })

    it('.update() validates input', async () => {
      const m = new RoomManager(makeCtx({}))
      await expect(m.update('r', {})).rejects.toBeInstanceOf(ChattoValidationError)
      await expect(m.update('r', { slowModeSeconds: 21601 })).rejects.toBeInstanceOf(ChattoValidationError)
      await expect(m.update('r', { threadSlowModeSeconds: -1 })).rejects.toBeInstanceOf(ChattoValidationError)
    })

    it('.archive() / .unarchive() / .join() return Rooms', async () => {
      const ctx = makeCtx({ room: { ...validRoom, archived: true } })
      const m = new RoomManager(ctx)
      expect((await m.archive('room_1')).archived).toBe(true)
      expectCall(ctx, 'RoomService', 'ArchiveRoom', { roomId: 'room_1' })
      await m.unarchive('room_1')
      expectCall(ctx, 'RoomService', 'UnarchiveRoom', { roomId: 'room_1' })
      await m.join('room_1')
      expectCall(ctx, 'RoomService', 'JoinRoom', { roomId: 'room_1' })
    })

    it('.leave() calls LeaveRoom', async () => {
      const ctx = makeCtx({})
      await new RoomManager(ctx).leave('room_1')
      expectCall(ctx, 'RoomService', 'LeaveRoom', { roomId: 'room_1' })
    })

    it('.joinGroup() returns joined ids, defaulting to []', async () => {
      const ctx = makeCtx({ joinedRoomIds: ['a', 'b'] })
      expect(await new RoomManager(ctx).joinGroup('G_1')).toEqual(['a', 'b'])
      expectCall(ctx, 'RoomService', 'JoinRoomGroup', { groupId: 'G_1' })
      expect(await new RoomManager(makeCtx({})).joinGroup('G_1')).toEqual([])
    })

    it('.startDM() accepts a single id or an array', async () => {
      const ctx = makeCtx({ room: { id: 'dm_1', kind: 'ROOM_KIND_DM', threadingMode: 'ROOM_THREADING_MODE_ENABLED', showMembershipEvents: false } })
      const m = new RoomManager(ctx)
      const dm = await m.startDM('U_2')
      expectCall(ctx, 'RoomService', 'StartDM', { participantIds: ['U_2'] })
      expect(dm.isDM).toBe(true)
      expect(dm.name).toBe('')
      expect(dm.showMembershipEvents).toBe(false)
      await m.startDM()
      expectCall(ctx, 'RoomService', 'StartDM', { participantIds: [] })
      await expect(m.startDM(Array(10).fill('u'))).rejects.toBeInstanceOf(ChattoValidationError)
    })
  })

  describe('members', () => {
    it('.listMembers() returns a page of user ids', async () => {
      const ctx = makeCtx({ userIds: ['U_1'], page: { totalCount: '1' } })
      const page = await new RoomManager(ctx).listMembers('room_1', { search: 'al', presence: ['online', 'PRESENCE_STATUS_AWAY'], limit: 10 })
      expectCall(ctx, 'RoomService', 'ListMembers', {
        roomId: 'room_1',
        search: 'al',
        page: { limit: 10, offset: undefined },
        presenceStatuses: ['PRESENCE_STATUS_ONLINE', 'PRESENCE_STATUS_AWAY'],
      })
      expect(page).toEqual({ items: ['U_1'], totalCount: 1, hasMore: false })
      expect((await new RoomManager(makeCtx({})).listMembers('r')).items).toEqual([])
    })

    it('.fetchMember() / .addMember() return Users', async () => {
      const ctx = makeCtx({ member })
      const m = new RoomManager(ctx)
      const u = await m.fetchMember('room_1', 'U_1')
      expectCall(ctx, 'RoomService', 'GetMember', { roomId: 'room_1', userId: 'U_1' })
      expect(u).toBeInstanceOf(User)
      expect(u.login).toBe('alice')
      await m.addMember('room_1', 'U_1')
      expectCall(ctx, 'RoomService', 'AddMember', { roomId: 'room_1', userId: 'U_1' })
    })

    it('.fetchMembers() calls BatchGetMembers', async () => {
      const ctx = makeCtx({ members: [member] })
      const users = await new RoomManager(ctx).fetchMembers('room_1', ['U_1'])
      expectCall(ctx, 'RoomService', 'BatchGetMembers', { roomId: 'room_1', userIds: ['U_1'] })
      expect(users[0].id).toBe('U_1')
      expect(await new RoomManager(makeCtx({})).fetchMembers('room_1', [])).toEqual([])
    })

    it('.removeMember() returns removed flag, false when omitted', async () => {
      const ctx = makeCtx({ removed: true })
      expect(await new RoomManager(ctx).removeMember('room_1', 'U_1')).toBe(true)
      expectCall(ctx, 'RoomService', 'RemoveMember', { roomId: 'room_1', userId: 'U_1' })
      expect(await new RoomManager(makeCtx({})).removeMember('room_1', 'U_1')).toBe(false)
    })
  })

  describe('moderation', () => {
    it('.removeUser() sends reason and a timestamp suspension', async () => {
      const ctx = makeCtx({})
      await new RoomManager(ctx).removeUser('room_1', 'U_1', {
        reason: 'spam',
        suspendUntil: new Date('2027-01-01T00:00:00Z'),
      })
      expectCall(ctx, 'RoomService', 'RemoveUser', {
        roomId: 'room_1',
        userId: 'U_1',
        reason: 'spam',
        suspensionExpiresAt: '2027-01-01T00:00:00.000Z',
        suspendIndefinitely: undefined,
      })
    })

    it('.removeUser() supports indefinite suspension and validates', async () => {
      const ctx = makeCtx({})
      const m = new RoomManager(ctx)
      await m.removeUser('room_1', 'U_1', { reason: 'x', suspendIndefinitely: true })
      expect(lastCall(ctx)[2].suspendIndefinitely).toBe(true)
      await expect(m.removeUser('r', 'u', { reason: '' })).rejects.toBeInstanceOf(ChattoValidationError)
      await expect(
        m.removeUser('r', 'u', { reason: 'x', suspendUntil: 'later', suspendIndefinitely: true }),
      ).rejects.toBeInstanceOf(ChattoValidationError)
    })

    it('.liftSuspension() calls LiftSuspension', async () => {
      const ctx = makeCtx({})
      await new RoomManager(ctx).liftSuspension('room_1', 'U_1', 'appeal')
      expectCall(ctx, 'RoomService', 'LiftSuspension', { roomId: 'room_1', userId: 'U_1', reason: 'appeal' })
    })

    it('.listSuspensions() parses suspensions', async () => {
      const ctx = makeCtx({
        suspensions: [{ id: 'S_1', roomId: 'room_1', room: validRoom, userId: 'U_1', user: member, moderatorId: 'U_2', reason: 'spam', createdAt: 't' }],
        page: { totalCount: '1' },
      })
      const page = await new RoomManager(ctx).listSuspensions({ roomId: 'room_1', limit: 5 })
      expectCall(ctx, 'RoomService', 'ListSuspensions', { roomId: 'room_1', page: { limit: 5, offset: undefined } })
      expect(page.items[0].user?.user.login).toBe('alice')
      expect(page.items[0].expiresAt).toBeUndefined()
      expect((await new RoomManager(makeCtx({})).listSuspensions()).items).toEqual([])
    })
  })

  describe('notices', () => {
    it('.fetchNotice() defaults an empty notice', async () => {
      const ctx = makeCtx({ notice: {} })
      expect(await new RoomManager(ctx).fetchNotice('room_1')).toEqual({ body: '', version: '', publicationId: '' })
      expectCall(ctx, 'RoomService', 'GetNotice', { roomId: 'room_1' })
    })

    it('.publishNotice() sends version and republish', async () => {
      const ctx = makeCtx({ notice: { body: 'hi', version: 'v2', publicationId: 'p', publishedAt: 't' } })
      const n = await new RoomManager(ctx).publishNotice('room_1', 'hi', { expectedVersion: 'v1', republish: true })
      expectCall(ctx, 'RoomService', 'PublishNotice', { roomId: 'room_1', body: 'hi', expectedVersion: 'v1', republish: true })
      expect(n.version).toBe('v2')
      await expect(new RoomManager(ctx).publishNotice('r', '')).rejects.toBeInstanceOf(ChattoValidationError)
      await expect(new RoomManager(ctx).publishNotice('r', 'x'.repeat(4001))).rejects.toBeInstanceOf(ChattoValidationError)
    })

    it('.clearNotice() calls ClearNotice', async () => {
      const ctx = makeCtx({ notice: { version: 'v3' } })
      const n = await new RoomManager(ctx).clearNotice('room_1', { expectedVersion: 'v2' })
      expectCall(ctx, 'RoomService', 'ClearNotice', { roomId: 'room_1', expectedVersion: 'v2' })
      expect(n.body).toBe('')
    })
  })

  describe('read state', () => {
    it('.fetchReadState() parses a state without marker', async () => {
      const ctx = makeCtx({ state: { roomId: 'room_1' } })
      const s = await new RoomManager(ctx).fetchReadState('room_1')
      expectCall(ctx, 'RoomService', 'GetRoomReadState', { roomId: 'room_1' })
      expect(s).toEqual({ roomId: 'room_1' })
    })

    it('.fetchReadStates() calls BatchGetRoomReadStates', async () => {
      const ctx = makeCtx({ states: [{ roomId: 'room_1', marker: { lastReadEventId: 'E_1', lastReadAt: 't' } }] })
      const s = await new RoomManager(ctx).fetchReadStates(['room_1'])
      expectCall(ctx, 'RoomService', 'BatchGetRoomReadStates', { roomIds: ['room_1'] })
      expect(s[0].marker?.lastReadEventId).toBe('E_1')
      expect(await new RoomManager(makeCtx({})).fetchReadStates([])).toEqual([])
      expect(await new RoomManager(makeCtx({})).fetchReadStates(['x'])).toEqual([])
    })

    it('.markAsRead() calls MarkRoomAsRead', async () => {
      const ctx = makeCtx({ lastReadAt: 't2', previousLastReadAt: 't1' })
      const r = await new RoomManager(ctx).markAsRead('room_1', 'E_9')
      expectCall(ctx, 'RoomService', 'MarkRoomAsRead', { roomId: 'room_1', upToEventId: 'E_9' })
      expect(r).toEqual({ lastReadAt: 't2', previousLastReadAt: 't1' })
      expect(await new RoomManager(makeCtx({})).markAsRead('room_1')).toEqual({})
    })
  })

  describe('pins', () => {
    it('.listPins() hydrates messages and keeps the marker', async () => {
      const ctx = makeCtx({ pinnedMessages: [{ message: msg }], page: { totalCount: '1' }, latestPinMarker: 'm1' })
      const page = await new RoomManager(ctx).listPins('room_1', { limit: 10 })
      expectCall(ctx, 'RoomService', 'ListPinnedMessages', { roomId: 'room_1', page: { limit: 10, offset: undefined } })
      expect(page.items).toEqual([{ hydrated: 'evt_1' }] as any)
      expect(page.latestPinMarker).toBe('m1')
      const empty = await new RoomManager(makeCtx({ page: {} })).listPins('room_1')
      expect(empty).toEqual({ items: [], totalCount: 0, hasMore: false, latestPinMarker: '' })
    })

    it('.pin() / .unpin()', async () => {
      const ctx = makeCtx({ pinnedMessage: { message: msg } })
      expect(await new RoomManager(ctx).pin('room_1', 'evt_1')).toEqual({ hydrated: 'evt_1' } as any)
      expectCall(ctx, 'RoomService', 'CreatePinnedMessage', { roomId: 'room_1', messageEventId: 'evt_1' })
      const ctx2 = makeCtx({ deleted: true })
      expect(await new RoomManager(ctx2).unpin('room_1', 'evt_1')).toBe(true)
      expectCall(ctx2, 'RoomService', 'DeletePinnedMessage', { roomId: 'room_1', messageEventId: 'evt_1' })
      expect(await new RoomManager(makeCtx({})).unpin('room_1', 'evt_1')).toBe(false)
    })
  })

  describe('timeline', () => {
    it('.fetchEvents() returns all event kinds and includes', async () => {
      const ctx = makeCtx({
        page: {
          events: [
            { id: 'E_0', createdAt: 't', actorId: 'system', roomCreated: { roomId: 'room_1' } },
            { id: 'E_1', createdAt: 't', actorId: 'U_1', userJoinedRoom: { roomId: 'room_1' } },
            { id: 'E_2', createdAt: 't', actorId: 'U_1', callStarted: { roomId: 'room_1', callId: 'C_1' } },
          ],
          startCursor: 'a',
          endCursor: 'b',
          hasOlder: true,
          includes: { users: { U_1: { id: 'U_1', login: 'alice' } } },
        },
      })
      const page = await new RoomManager(ctx).fetchEvents('room_1', { limit: 3, after: 'x' })
      expectCall(ctx, 'RoomService', 'GetRoomEvents', { roomId: 'room_1', limit: 3, before: undefined, after: 'x' })
      expect(page.events[2].callStarted?.callId).toBe('C_1')
      expect(page.includes?.users.U_1.login).toBe('alice')
    })

    it('.fetchEvents() sends only `before` when both cursors are given', async () => {
      const ctx = makeCtx({ page: {} })
      await new RoomManager(ctx).fetchEvents('room_1', { before: 'b', after: 'a' })
      expect(lastCall(ctx)[2]).toEqual({ roomId: 'room_1', limit: undefined, before: 'b', after: undefined })
    })

    it('.fetchEventsAround() returns targetIndex', async () => {
      const ctx = makeCtx({ page: { events: [{ id: 'E_1', createdAt: 't', actorId: 'U_1', messagePosted: { message: msg } }] }, targetIndex: 0 })
      const page = await new RoomManager(ctx).fetchEventsAround('room_1', 'E_1', { limit: 5 })
      expectCall(ctx, 'RoomService', 'GetRoomEventsAround', { roomId: 'room_1', eventId: 'E_1', limit: 5 })
      expect(page.targetIndex).toBe(0)
      expect(page.events).toHaveLength(1)
      const empty = await new RoomManager(makeCtx({ page: {} })).fetchEventsAround('room_1', 'E_1')
      expect(empty.targetIndex).toBe(0)
      expect(empty.events).toEqual([])
    })
  })

  it('.sendTyping() calls RefreshTypingIndicator with optional thread', async () => {
    const ctx = makeCtx({})
    await new RoomManager(ctx).sendTyping('room_1', 'E_root')
    expectCall(ctx, 'RoomService', 'RefreshTypingIndicator', { roomId: 'room_1', threadRootEventId: 'E_root' })
  })

  it('.listAttachments() wraps assets as Attachments', async () => {
    const ctx = makeCtx({
      attachments: [{
        attachment: { id: 'A_1', filename: 'a.png', contentType: 'image/png', size: '42' },
        messageEventId: 'evt_1',
        createdAt: 't',
      }],
      page: { totalCount: '1' },
    })
    const page = await new RoomManager(ctx).listAttachments('room_1', { thumbnail: { width: 64, height: 64, fit: 'cover' }, limit: 1 })
    expectCall(ctx, 'RoomService', 'ListRoomAttachments', {
      roomId: 'room_1',
      thumbnail: { width: 64, height: 64, fit: 'IMAGE_FIT_MODE_COVER' },
      page: { limit: 1, offset: undefined },
    })
    expect(page.items[0].attachment).toBeInstanceOf(Attachment)
    expect(page.items[0].attachment.size).toBe(42)
    expect(page.items[0].threadRootEventId).toBeUndefined()
    expect((await new RoomManager(makeCtx({ page: {} })).listAttachments('room_1')).items).toEqual([])
  })
})
