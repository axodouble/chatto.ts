import { describe, it, expect, mock } from 'bun:test'
import { Room } from '../../src/resources/room'
import { Message } from '../../src/resources/message'

const roomData = { id: 'R_1', name: 'general', kind: 'channel', archived: false, universal: false }

function makeCtx(postReturn: unknown) {
  const ctx: any = {
    // Parse like the real RestClient so proto3-omitted fields get their defaults.
    rest: { post: mock(async (_s: string, _m: string, _b: unknown, schema: any) => schema.parse(postReturn)) },
    assets: { upload: mock(async () => ({ id: 'as_up_1' })) },
    resolveUser: mock(async (id: string) => ({ id })),
    resolveRoom: mock(async (id: string) => Room.partial(id, ctx)),
    hydrateMessage: mock(async (data: any) => new Message(data, ctx, {
      author: { id: data.actorId } as any,
      channel: Room.partial(data.roomId, ctx),
    })),
  }
  return ctx
}

describe('Room', () => {
  it('exposes data properties', () => {
    const room = new Room(roomData as any, makeCtx(null))
    expect(room.id).toBe('R_1')
    expect(room.name).toBe('general')
  })

  it('Room.partial builds a Room from just an id', () => {
    const ctx = makeCtx(null)
    const room = Room.partial('R_9', ctx)
    expect(room.id).toBe('R_9')
  })

  describe('.send()', () => {
    it('accepts a plain string and returns a hydrated Message', async () => {
      const msgData = { id: 'evt_1', roomId: 'R_1', createdAt: 't', actorId: 'U_1', body: 'hi', reactions: [] }
      const ctx = makeCtx({ message: msgData })
      const room = new Room(roomData as any, ctx)
      const sent = await room.send('hi')
      expect(ctx.rest.post).toHaveBeenCalledWith(
        'chatto.api.v1.MessageService',
        'CreateMessage',
        expect.objectContaining({ roomId: 'R_1', body: 'hi' }),
        expect.anything(),
      )
      expect(ctx.hydrateMessage).toHaveBeenCalledWith(expect.objectContaining(msgData))
      expect(sent).toBeInstanceOf(Message)
    })

    it('uploads pending files and attaches the resulting asset ids', async () => {
      const msgData = { id: 'evt_1', roomId: 'R_1', createdAt: 't', actorId: 'U_1', body: 'hi', reactions: [] }
      const ctx = makeCtx({ message: msgData })
      const room = new Room(roomData as any, ctx)
      const file = { data: new Uint8Array([1, 2, 3]), filename: 'a.png', contentType: 'image/png' }
      await room.send({ content: 'hi', files: [file] })
      expect(ctx.assets.upload).toHaveBeenCalledWith('R_1', file)
      expect(ctx.rest.post).toHaveBeenCalledWith(
        'chatto.api.v1.MessageService',
        'CreateMessage',
        expect.objectContaining({ attachmentAssetIds: ['as_up_1'] }),
        expect.anything(),
      )
    })
  })

  describe('.fetchHistory()', () => {
    it('calls GetRoomEvents and returns Message[] hydrated via ctx', async () => {
      const msgData = { id: 'evt_1', roomId: 'R_1', createdAt: 't', actorId: 'U_1', body: 'hi', reactions: [] }
      const ctx = makeCtx({
        page: {
          events: [
            { id: 'evt_1', createdAt: 't', actorId: 'U_1', messagePosted: { message: msgData } },
          ],
          hasOlder: false,
          hasNewer: false,
        },
      })
      const room = new Room(roomData as any, ctx)
      const msgs = await room.fetchHistory({ limit: 20 })
      expect(ctx.rest.post).toHaveBeenCalledWith(
        'chatto.api.v1.RoomService',
        'GetRoomEvents',
        expect.objectContaining({ roomId: 'R_1', limit: 20 }),
        expect.anything(),
      )
      expect(ctx.hydrateMessage).toHaveBeenCalledWith(expect.objectContaining(msgData))
      expect(msgs).toHaveLength(1)
      expect(msgs[0]).toBeInstanceOf(Message)
    })

    it('filters out non-message timeline events', async () => {
      const ctx = makeCtx({
        page: {
          events: [
            { id: 'evt_system', createdAt: 't', actorId: 'system' },
          ],
          hasOlder: false,
          hasNewer: false,
        },
      })
      const room = new Room(roomData as any, ctx)
      const msgs = await room.fetchHistory()
      expect(msgs).toHaveLength(0)
    })

    it('passes before cursor when provided', async () => {
      const ctx = makeCtx({ page: { events: [], hasOlder: false, hasNewer: false } })
      const room = new Room(roomData as any, ctx)
      await room.fetchHistory({ before: 'cursor_abc' })
      expect(ctx.rest.post).toHaveBeenCalledWith(
        'chatto.api.v1.RoomService',
        'GetRoomEvents',
        expect.objectContaining({ before: 'cursor_abc' }),
        expect.anything(),
      )
    })
  })

  describe('v0.5.0 fields', () => {
    it('exposes room settings and defaults', () => {
      const room = new Room({
        id: 'R_1', name: 'general', kind: 'ROOM_KIND_CHANNEL', archived: false, universal: true,
        groupId: 'G_1', slowModeSeconds: 10, threadingMode: 'ROOM_THREADING_MODE_REQUIRED',
        threadSlowModeSeconds: 5, createdAt: '2026-01-01T00:00:00Z',
      }, makeCtx(null))
      expect(room.groupId).toBe('G_1')
      expect(room.universal).toBe(true)
      expect(room.slowModeSeconds).toBe(10)
      expect(room.threadingMode).toBe('ROOM_THREADING_MODE_REQUIRED')
      expect(room.threadSlowModeSeconds).toBe(5)
      expect(room.createdAt).toBe('2026-01-01T00:00:00Z')
      expect(room.showMembershipEvents).toBe(true) // absent means true
      expect(room.isChannel).toBe(true)
      expect(room.viewerState).toBeUndefined()
      expect(room.can('message.post')).toBeUndefined()
      expect(room.memberUserIds).toEqual([])
    })

    it('Room.fromViewerState carries viewer state and DM data', () => {
      const room = Room.fromViewerState({
        room: { id: 'D_1', name: '', kind: 'ROOM_KIND_DM', archived: false, universal: false, slowModeSeconds: 0, threadingMode: 'ROOM_THREADING_MODE_ENABLED' },
        viewerState: { isMember: true, hasUnread: true, permissions: [{ permission: 'message.post', granted: true }] },
        memberUserIds: ['U_1', 'U_2'],
        hasMessageHistory: true,
        lastMessageAt: 't',
      }, makeCtx(null))
      expect(room.isDM).toBe(true)
      expect(room.isMember).toBe(true)
      expect(room.viewerState?.hasUnread).toBe(true)
      expect(room.can('message.post')).toBe(true)
      expect(room.can('message.pin')).toBe(false)
      expect(room.memberUserIds).toEqual(['U_1', 'U_2'])
      expect(room.hasMessageHistory).toBe(true)
      expect(room.lastMessageAt).toBe('t')
    })
  })

  describe('convenience methods', () => {
    const cases: Array<[string, (r: Room) => Promise<unknown>, string, string, unknown, unknown]> = [
      ['join', r => r.join(), 'RoomService', 'JoinRoom', { roomId: 'R_1' }, { room: roomData }],
      ['leave', r => r.leave(), 'RoomService', 'LeaveRoom', { roomId: 'R_1' }, {}],
      ['archive', r => r.archive(), 'RoomService', 'ArchiveRoom', { roomId: 'R_1' }, { room: roomData }],
      ['unarchive', r => r.unarchive(), 'RoomService', 'UnarchiveRoom', { roomId: 'R_1' }, { room: roomData }],
      ['update', r => r.update({ description: 'd' }), 'RoomService', 'UpdateRoom', { roomId: 'R_1', description: 'd', updateMask: 'description' }, { room: roomData }],
      ['invite', r => r.invite('U_2'), 'RoomInvitationService', 'CreateRoomInvitation', { roomId: 'R_1', recipientId: 'U_2' }, { invitation: { id: 'I_1' } }],
      ['listMembers', r => r.listMembers(), 'RoomService', 'ListMembers', { roomId: 'R_1', search: undefined, page: undefined, presenceStatuses: undefined }, {}],
      ['fetchMember', r => r.fetchMember('U_1'), 'RoomService', 'GetMember', { roomId: 'R_1', userId: 'U_1' }, { member: { user: { id: 'U_1' } } }],
      ['fetchMembers', r => r.fetchMembers(['U_1']), 'RoomService', 'BatchGetMembers', { roomId: 'R_1', userIds: ['U_1'] }, {}],
      ['addMember', r => r.addMember('U_1'), 'RoomService', 'AddMember', { roomId: 'R_1', userId: 'U_1' }, { member: { user: { id: 'U_1' } } }],
      ['removeMember', r => r.removeMember('U_1'), 'RoomService', 'RemoveMember', { roomId: 'R_1', userId: 'U_1' }, {}],
      ['removeUser', r => r.removeUser('U_1', { reason: 'spam' }), 'RoomService', 'RemoveUser', { roomId: 'R_1', userId: 'U_1', reason: 'spam', suspensionExpiresAt: undefined, suspendIndefinitely: undefined }, {}],
      ['liftSuspension', r => r.liftSuspension('U_1', 'ok'), 'RoomService', 'LiftSuspension', { roomId: 'R_1', userId: 'U_1', reason: 'ok' }, {}],
      ['listSuspensions', r => r.listSuspensions({ limit: 2 }), 'RoomService', 'ListSuspensions', { roomId: 'R_1', page: { limit: 2, offset: undefined } }, {}],
      ['fetchNotice', r => r.fetchNotice(), 'RoomService', 'GetNotice', { roomId: 'R_1' }, { notice: {} }],
      ['publishNotice', r => r.publishNotice('hi'), 'RoomService', 'PublishNotice', { roomId: 'R_1', body: 'hi', expectedVersion: undefined, republish: undefined }, { notice: {} }],
      ['clearNotice', r => r.clearNotice({ expectedVersion: 'v' }), 'RoomService', 'ClearNotice', { roomId: 'R_1', expectedVersion: 'v' }, { notice: {} }],
      ['fetchReadState', r => r.fetchReadState(), 'RoomService', 'GetRoomReadState', { roomId: 'R_1' }, { state: { roomId: 'R_1' } }],
      ['markAsRead', r => r.markAsRead(), 'RoomService', 'MarkRoomAsRead', { roomId: 'R_1', upToEventId: undefined }, {}],
      ['listPins', r => r.listPins(), 'RoomService', 'ListPinnedMessages', { roomId: 'R_1', page: undefined }, {}],
      ['unpin', r => r.unpin('E_1'), 'RoomService', 'DeletePinnedMessage', { roomId: 'R_1', messageEventId: 'E_1' }, {}],
      ['sendTyping', r => r.sendTyping('E_root'), 'RoomService', 'RefreshTypingIndicator', { roomId: 'R_1', threadRootEventId: 'E_root' }, {}],
      ['listAttachments', r => r.listAttachments(), 'RoomService', 'ListRoomAttachments', { roomId: 'R_1', thumbnail: undefined, page: undefined }, {}],
      ['fetchEvents', r => r.fetchEvents({ limit: 1 }), 'RoomService', 'GetRoomEvents', { roomId: 'R_1', limit: 1, before: undefined, after: undefined }, { page: {} }],
    ]
    for (const [name, call, service, method, body, response] of cases) {
      it(`.${name}() calls ${service}.${method}`, async () => {
        const ctx = makeCtx(response)
        await call(new Room(roomData as any, ctx))
        expect(ctx.rest.post).toHaveBeenCalledWith(`chatto.api.v1.${service}`, method, body, expect.anything())
      })
    }

    it('.pin() returns the hydrated pinned message', async () => {
      const msgData = { id: 'E_1', roomId: 'R_1', createdAt: 't', actorId: 'U_1' }
      const ctx = makeCtx({ pinnedMessage: { message: msgData } })
      const m = await new Room(roomData as any, ctx).pin('E_1')
      expect(m).toBeInstanceOf(Message)
      expect(ctx.hydrateMessage).toHaveBeenCalledWith(expect.objectContaining(msgData))
    })
  })

  describe('.fetchHistoryAround()', () => {
    it('calls GetRoomEventsAround and returns only messages', async () => {
      const msgData = { id: 'evt_1', roomId: 'R_1', createdAt: 't', actorId: 'U_1', body: 'hi', reactions: [] }
      const ctx = makeCtx({
        page: {
          events: [
            { id: 'evt_0', createdAt: 't', actorId: 'U_1', userJoinedRoom: { roomId: 'R_1' } },
            { id: 'evt_1', createdAt: 't', actorId: 'U_1', messagePosted: { message: msgData } },
          ],
        },
        targetIndex: 1,
      })
      const msgs = await new Room(roomData as any, ctx).fetchHistoryAround('evt_1', { limit: 10 })
      expect(ctx.rest.post).toHaveBeenCalledWith(
        'chatto.api.v1.RoomService',
        'GetRoomEventsAround',
        { roomId: 'R_1', eventId: 'evt_1', limit: 10 },
        expect.anything(),
      )
      expect(msgs).toHaveLength(1)
      expect(msgs[0].id).toBe('evt_1')
    })
  })
})
