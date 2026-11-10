import { describe, it, expect, mock } from 'bun:test'
import { Message } from '../../src/resources/message'
import { Room } from '../../src/resources/room'
import { User } from '../../src/resources/user'
import { Attachment } from '../../src/resources/attachment'
import { MessageBuilder } from '../../src/builders/message'

const validMessageData = {
  id: 'evt_1', roomId: 'R_1', createdAt: '2026-07-09T10:00:00Z',
  actorId: 'U_1', body: 'Hello', reactions: [],
}

function makeCtx(postReturn: unknown) {
  const ctx: any = {
    rest: { post: mock().mockResolvedValue(postReturn) },
    assets: { upload: mock(async () => ({ id: 'as_up_1' })) },
    resolveUser: mock(async (id: string) => User.partial(id)),
    resolveRoom: mock(async (id: string) => Room.partial(id, ctx)),
    hydrateMessage: mock(async (data: any) => new Message(data, ctx, {
      author: User.partial(data.actorId),
      channel: Room.partial(data.roomId, ctx),
    })),
  }
  return ctx
}

function makeMessage(data: any, ctx: any) {
  return new Message(data, ctx, { author: User.partial(data.actorId), channel: Room.partial(data.roomId, ctx) })
}

describe('Message', () => {
  it('exposes discord.js-style fields', () => {
    const msg = makeMessage(validMessageData, makeCtx(null))
    expect(msg.id).toBe('evt_1')
    expect(msg.channelId).toBe('R_1')
    expect(msg.content).toBe('Hello')
  })

  it('exposes author as a full User and channel as a Room', () => {
    const msg = makeMessage(validMessageData, makeCtx(null))
    expect(msg.author).toBeInstanceOf(User)
    expect(msg.author.id).toBe('U_1')
    expect(msg.channel).toBeInstanceOf(Room)
    expect(msg.channel.id).toBe('R_1')
  })

  it('hydrates attachments as Attachment instances', () => {
    const data = {
      ...validMessageData,
      attachments: [{ id: 'at_1', filename: 'p.png', contentType: 'image/png', width: 10, height: 10 }],
    }
    const msg = makeMessage(data, makeCtx(null))
    expect(msg.attachments).toHaveLength(1)
    expect(msg.attachments[0]).toBeInstanceOf(Attachment)
    expect(msg.attachments[0]?.id).toBe('at_1')
  })

  it('defaults attachments to an empty array', () => {
    const msg = makeMessage(validMessageData, makeCtx(null))
    expect(msg.attachments).toEqual([])
  })

  describe('.reply()', () => {
    it('accepts a plain string, sets inReplyTo/threadRoot, returns hydrated Message', async () => {
      const replyData = { ...validMessageData, id: 'evt_2' }
      const ctx = makeCtx({ message: replyData })
      const msg = makeMessage(validMessageData, ctx)
      const reply = await msg.reply('Got it!')
      expect(ctx.rest.post).toHaveBeenCalledWith(
        'chatto.api.v1.MessageService',
        'CreateMessage',
        expect.objectContaining({ roomId: 'R_1', inReplyTo: 'evt_1', threadRootEventId: 'evt_1', body: 'Got it!' }),
        expect.anything(),
      )
      expect(reply).toBeInstanceOf(Message)
    })

    it('uses existing threadRootEventId when already a thread reply', async () => {
      const threadData = { ...validMessageData, inReplyTo: 'evt_0', threadRootEventId: 'evt_0' }
      const ctx = makeCtx({ message: { ...validMessageData, id: 'evt_2' } })
      const msg = makeMessage(threadData, ctx)
      await msg.reply(new MessageBuilder().setContent('Also replying'))
      expect(ctx.rest.post).toHaveBeenCalledWith(
        'chatto.api.v1.MessageService', 'CreateMessage',
        expect.objectContaining({ inReplyTo: 'evt_1', threadRootEventId: 'evt_0' }),
        expect.anything(),
      )
    })

    it('does not mutate a caller-supplied MessageBuilder', async () => {
      const replyData = { ...validMessageData, id: 'evt_2' }
      const ctx = makeCtx({ message: replyData })
      const msg = makeMessage(validMessageData, ctx)
      const builder = new MessageBuilder().setContent('x')
      await msg.reply(builder)
      expect(builder.buildCreate('R_1').inReplyTo).toBeUndefined()
    })

    it('uploads files and attaches them when replying', async () => {
      const ctx = makeCtx({ message: { ...validMessageData, id: 'evt_2' } })
      const msg = makeMessage(validMessageData, ctx)
      await msg.reply({ content: 'here', files: [{ data: new Uint8Array([1]), filename: 'a.png', contentType: 'image/png' }] })
      expect(ctx.assets.upload).toHaveBeenCalledWith('R_1', expect.objectContaining({ filename: 'a.png' }))
      expect(ctx.rest.post).toHaveBeenCalledWith(
        'chatto.api.v1.MessageService', 'CreateMessage',
        expect.objectContaining({ attachmentAssetIds: ['as_up_1'], inReplyTo: 'evt_1' }),
        expect.anything(),
      )
    })
  })

  describe('.deleteAttachment()', () => {
    it('calls DeleteAttachment with the attachment id', async () => {
      const ctx = makeCtx({ deleted: true })
      await makeMessage(validMessageData, ctx).deleteAttachment('at_1')
      expect(ctx.rest.post).toHaveBeenCalledWith(
        'chatto.api.v1.MessageService', 'DeleteAttachment',
        { roomId: 'R_1', eventId: 'evt_1', attachmentId: 'at_1' }, expect.anything(),
      )
    })
  })

  describe('.edit()', () => {
    it('accepts a plain string and calls UpdateMessage', async () => {
      const ctx = makeCtx({ message: { ...validMessageData, body: 'Updated' } })
      const msg = makeMessage(validMessageData, ctx)
      const updated = await msg.edit('Updated')
      expect(ctx.rest.post).toHaveBeenCalledWith(
        'chatto.api.v1.MessageService', 'UpdateMessage',
        { roomId: 'R_1', eventId: 'evt_1', body: 'Updated', updateMask: 'body' },
        expect.anything(),
      )
      expect(updated).toBeInstanceOf(Message)
    })
  })

  describe('.delete() / .react()', () => {
    it('delete calls DeleteMessage', async () => {
      const ctx = makeCtx({ deleted: true })
      await makeMessage(validMessageData, ctx).delete()
      expect(ctx.rest.post).toHaveBeenCalledWith(
        'chatto.api.v1.MessageService', 'DeleteMessage',
        { roomId: 'R_1', eventId: 'evt_1' }, expect.anything(),
      )
    })
    it('react calls AddReaction', async () => {
      const ctx = makeCtx({ added: true })
      await makeMessage(validMessageData, ctx).react('thumbsup')
      expect(ctx.rest.post).toHaveBeenCalledWith(
        'chatto.api.v1.MessageService', 'AddReaction',
        { roomId: 'R_1', messageEventId: 'evt_1', emoji: 'thumbsup' }, expect.anything(),
      )
    })
  })

  describe('v0.5 fields', () => {
    it('exposes thread, pin, deletion, viewer state, link preview, reactions and echo ids', () => {
      const msg = makeMessage({
        ...validMessageData,
        reactions: [{ emoji: 'heart', count: 2, hasReacted: true, previewUserIds: [] }],
        linkPreview: { url: 'https://example.com', title: 'Example' },
        thread: { threadRootEventId: 'evt_1', replyCount: 3, participantPreviewUserIds: [], participantCount: 2 },
        pinned: true,
        deletedAt: '2026-01-01T00:00:00Z',
        viewerState: { canReplyInThread: true },
        channelEchoEventId: 'evt_echo',
      }, makeCtx(null))
      expect(msg.reactions[0]?.emoji).toBe('heart')
      expect(msg.linkPreview?.title).toBe('Example')
      expect(msg.thread?.replyCount).toBe(3)
      expect(msg.pinned).toBe(true)
      expect(msg.deletedAt).toBe('2026-01-01T00:00:00Z')
      expect(msg.viewerState?.canReplyInThread).toBe(true)
      expect(msg.channelEchoEventId).toBe('evt_echo')
      expect(msg.threadRootId).toBe('evt_1')
      expect(msg.isThreadReply).toBe(false)
    })

    it('resolves canonical id and thread root for a channel echo', () => {
      const echo = makeMessage(
        { ...validMessageData, id: 'evt_echo', echoOfEventId: 'evt_reply', echoFromThreadRootEventId: 'evt_root' },
        makeCtx(null),
      )
      expect(echo.isEcho).toBe(true)
      expect(echo.canonicalId).toBe('evt_reply')
      expect(echo.threadRootId).toBe('evt_root')
    })
  })

  describe('v0.5 convenience methods', () => {
    function lastCall(ctx: any) {
      const c = ctx.rest.post.mock.calls.at(-1)
      return [c[0], c[1], c[2]]
    }

    it('reply() on an echo targets the original reply and its thread', async () => {
      const ctx = makeCtx({ message: { ...validMessageData, id: 'evt_2' } })
      const echo = makeMessage(
        { ...validMessageData, id: 'evt_echo', echoOfEventId: 'evt_reply', echoFromThreadRootEventId: 'evt_root' }, ctx,
      )
      await echo.reply('hi')
      expect(lastCall(ctx)[2]).toMatchObject({ inReplyTo: 'evt_reply', threadRootEventId: 'evt_root' })
      expect(lastCall(ctx)[2].idempotencyKey).toBeString()
    })

    it('react() maps Unicode emoji to the shortcode name', async () => {
      const ctx = makeCtx({ added: true })
      await makeMessage(validMessageData, ctx).react('👍')
      expect(lastCall(ctx)[2].emoji).toBe('thumbsup')
    })

    it('fetchReactionUsers() calls ListReactionUsers', async () => {
      const ctx = makeCtx({ userIds: ['U_2'], page: { totalCount: 1, hasMore: false } })
      const page = await makeMessage(validMessageData, ctx).fetchReactionUsers('heart')
      expect(lastCall(ctx)).toEqual(['chatto.api.v1.MessageService', 'ListReactionUsers',
        { roomId: 'R_1', messageEventId: 'evt_1', emoji: 'heart', page: undefined }])
      expect(page.items).toEqual(['U_2'])
    })

    it('setAttachmentDescription() calls SetAttachmentDescription', async () => {
      const ctx = makeCtx({ message: validMessageData })
      await makeMessage(validMessageData, ctx).setAttachmentDescription('at_1', 'alt')
      expect(lastCall(ctx)).toEqual(['chatto.api.v1.MessageService', 'SetAttachmentDescription',
        { roomId: 'R_1', eventId: 'evt_1', attachmentId: 'at_1', description: 'alt' }])
    })

    it('removeLinkPreview() defaults to the current preview URL and is a no-op without one', async () => {
      const ctx = makeCtx({})
      await makeMessage(validMessageData, ctx).removeLinkPreview()
      expect(ctx.rest.post).not.toHaveBeenCalled()
      await makeMessage({ ...validMessageData, linkPreview: { url: 'https://e.com' } }, ctx).removeLinkPreview()
      expect(lastCall(ctx)).toEqual(['chatto.api.v1.MessageService', 'DeleteLinkPreview',
        { roomId: 'R_1', eventId: 'evt_1', url: 'https://e.com' }])
    })

    it('pin()/unpin() use the canonical message id', async () => {
      const ctx = makeCtx({ deleted: true })
      const echo = makeMessage({ ...validMessageData, id: 'evt_echo', echoOfEventId: 'evt_reply' }, ctx)
      expect(await echo.unpin()).toBe(true)
      expect(lastCall(ctx)).toEqual(['chatto.api.v1.RoomService', 'DeletePinnedMessage',
        { roomId: 'R_1', messageEventId: 'evt_reply' }])
      ctx.rest.post = mock().mockResolvedValue({ pinnedMessage: { message: validMessageData } })
      await echo.pin()
      expect(lastCall(ctx)).toEqual(['chatto.api.v1.RoomService', 'CreatePinnedMessage',
        { roomId: 'R_1', messageEventId: 'evt_reply' }])
    })

    it('thread helpers target this message\'s thread root', async () => {
      const ctx = makeCtx({ state: { roomId: 'R_1', threadRootEventId: 'evt_0', following: true } })
      const reply = makeMessage({ ...validMessageData, threadRootEventId: 'evt_0' }, ctx)
      await reply.follow()
      expect(lastCall(ctx)).toEqual(['chatto.api.v1.ThreadService', 'FollowThread', { roomId: 'R_1', threadRootEventId: 'evt_0' }])
      await reply.unfollow()
      expect(lastCall(ctx)[1]).toBe('UnfollowThread')
      await reply.markThreadRead()
      expect(lastCall(ctx)).toEqual(['chatto.api.v1.ThreadService', 'MarkThreadAsRead',
        { roomId: 'R_1', threadRootEventId: 'evt_0', upToEventId: 'evt_1' }])
      await makeMessage(validMessageData, ctx).markThreadRead()
      expect(lastCall(ctx)[2]).toEqual({ roomId: 'R_1', threadRootEventId: 'evt_1', upToEventId: undefined })
    })

    it('fetchThread() calls GetThreadEvents for the root', async () => {
      const ctx = makeCtx({ page: { events: [], hasOlder: false, hasNewer: false } })
      const page = await makeMessage(validMessageData, ctx).fetchThread({ limit: 5 })
      expect(lastCall(ctx)).toEqual(['chatto.api.v1.ThreadService', 'GetThreadEvents',
        { roomId: 'R_1', threadRootEventId: 'evt_1', limit: 5, before: undefined, after: undefined }])
      expect(page.messages).toEqual([])
    })
  })
})
