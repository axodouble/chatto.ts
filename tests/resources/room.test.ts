import { describe, it, expect, mock } from 'bun:test'
import { Room } from '../../src/resources/room'
import { Message } from '../../src/resources/message'

const roomData = { id: 'R_1', name: 'general', kind: 'channel', archived: false, universal: false }

function makeCtx(postReturn: unknown) {
  const ctx: any = {
    rest: { post: mock().mockResolvedValue(postReturn) },
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
      expect(ctx.hydrateMessage).toHaveBeenCalledWith(msgData)
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
      expect(ctx.hydrateMessage).toHaveBeenCalledWith(msgData)
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
})
