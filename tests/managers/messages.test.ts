import { describe, it, expect, mock } from 'bun:test'
import { MessageManager } from '../../src/managers/messages'
import { Message } from '../../src/resources/message'
import { Room } from '../../src/resources/room'
import { User } from '../../src/resources/user'
import { ChattoValidationError } from '../../src/errors'

let uploadCounter = 0
function makeCtx(postReturn: unknown) {
  uploadCounter = 0
  const ctx: any = {
    rest: { post: mock().mockResolvedValue(postReturn) },
    assets: { upload: mock(async () => ({ id: `as_up_${++uploadCounter}` })) },
    hydrateMessage: mock(async (data: any) => new Message(data, ctx, {
      author: User.partial(data.actorId), channel: Room.partial(data.roomId, ctx),
    })),
  }
  return ctx
}

function createArg(ctx: any) {
  return ctx.rest.post.mock.calls.find((c: any[]) => c[1] === 'CreateMessage')[2]
}

const file = { data: new Uint8Array([1, 2, 3]), filename: 'a.png', contentType: 'image/png' }
const msgData = { id: 'evt_1', roomId: 'R_1', createdAt: 't', actorId: 'U_1', body: 'hi', reactions: [] }

describe('MessageManager', () => {
  it('send() accepts a string and returns a hydrated Message', async () => {
    const ctx = makeCtx({ message: msgData })
    const sent = await new MessageManager(ctx).send('R_1', 'hi')
    expect(ctx.rest.post).toHaveBeenCalledWith(
      'chatto.api.v1.MessageService', 'CreateMessage',
      expect.objectContaining({ roomId: 'R_1', body: 'hi' }), expect.anything(),
    )
    expect(sent).toBeInstanceOf(Message)
  })

  it('send() uploads pending files and attaches the resulting asset ids', async () => {
    const ctx = makeCtx({ message: msgData })
    await new MessageManager(ctx).send('R_1', { content: 'hi', files: [file, file] })
    expect(ctx.assets.upload).toHaveBeenCalledTimes(2)
    expect(ctx.assets.upload).toHaveBeenCalledWith('R_1', file)
    expect(createArg(ctx).attachmentAssetIds).toEqual(['as_up_1', 'as_up_2'])
  })

  it('send() merges explicit attachment ids before uploaded ones', async () => {
    const ctx = makeCtx({ message: msgData })
    await new MessageManager(ctx).send('R_1', { content: 'hi', attachmentIds: ['as_x'], files: [file] })
    expect(createArg(ctx).attachmentAssetIds).toEqual(['as_x', 'as_up_1'])
  })

  it('send() with only files and no content is allowed', async () => {
    const ctx = makeCtx({ message: msgData })
    await new MessageManager(ctx).send('R_1', { files: [file] })
    expect(createArg(ctx).body).toBeUndefined()
    expect(createArg(ctx).attachmentAssetIds).toEqual(['as_up_1'])
  })

  it('send() throws when more than 10 attachments are supplied', async () => {
    const ctx = makeCtx({ message: msgData })
    const ids = Array.from({ length: 11 }, (_, i) => `as_${i}`)
    await expect(new MessageManager(ctx).send('R_1', { content: 'hi', attachmentIds: ids }))
      .rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('send() validates the attachment count before uploading any files', async () => {
    const ctx = makeCtx({ message: msgData })
    const files = Array.from({ length: 11 }, () => file)
    await expect(new MessageManager(ctx).send('R_1', { content: 'hi', files }))
      .rejects.toBeInstanceOf(ChattoValidationError)
    expect(ctx.assets.upload).not.toHaveBeenCalled()
  })

  it('send() throws when there is neither content nor attachments', async () => {
    const ctx = makeCtx({ message: msgData })
    await expect(new MessageManager(ctx).send('R_1', { content: '' }))
      .rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('fetch() returns a hydrated Message', async () => {
    const ctx = makeCtx({ message: msgData })
    const msg = await new MessageManager(ctx).fetch('R_1', 'evt_1')
    expect(ctx.rest.post).toHaveBeenCalledWith(
      'chatto.api.v1.MessageService', 'GetMessage',
      { roomId: 'R_1', eventId: 'evt_1' }, expect.anything(),
    )
    expect(msg.content).toBe('hi')
  })
})

function callFor(ctx: any, method: string) {
  return ctx.rest.post.mock.calls.find((c: any[]) => c[1] === method)
}

describe('MessageManager v0.5', () => {
  it('send() passes the new CreateMessage fields and an auto idempotency key', async () => {
    const ctx = makeCtx({ message: msgData })
    await new MessageManager(ctx).send('R_1', {
      content: 'hi', createThread: true, linkPreviewToken: 'cht_x',
      files: [{ ...file, description: 'pic' }],
    })
    const body = createArg(ctx)
    expect(body).toMatchObject({
      roomId: 'R_1', body: 'hi', createThread: true, linkPreviewToken: 'cht_x',
      attachmentAssetIds: ['as_up_1'], attachmentDescriptions: [{ assetId: 'as_up_1', description: 'pic' }],
    })
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('send() parses a response with omitted fields and exposes v0.5 message fields', async () => {
    const ctx = makeCtx({
      message: {
        id: 'E', roomId: 'R_1', createdAt: 't', actorId: 'U',
        thread: { threadRootEventId: 'E', participantCount: 1, viewerState: { isFollowing: true } },
        viewerState: { canReplyInThread: true },
      },
    })
    const ctxPost = ctx.rest.post
    ctx.rest.post = mock(async (s: string, m: string, b: any, schema: any) => schema.parse(await ctxPost(s, m, b, schema)))
    const msg = await new MessageManager(ctx).send('R_1', 'hi')
    expect(msg.thread?.replyCount).toBe(0)
    expect(msg.thread?.viewerState?.isFollowing).toBe(true)
    expect(msg.pinned).toBe(false)
    expect(msg.reactions).toEqual([])
    expect(msg.viewerState?.canReplyInThread).toBe(true)
  })

  it('fetchMany() calls BatchGetMessages, short-circuits on [] and caps at 100', async () => {
    const ctx = makeCtx({ messages: [msgData] })
    const mgr = new MessageManager(ctx)
    expect(await mgr.fetchMany('R_1', [])).toEqual([])
    expect(ctx.rest.post).not.toHaveBeenCalled()
    const msgs = await mgr.fetchMany('R_1', ['evt_1', 'evt_x'])
    expect(callFor(ctx, 'BatchGetMessages')[2]).toEqual({ roomId: 'R_1', eventIds: ['evt_1', 'evt_x'] })
    expect(msgs).toHaveLength(1)
    await expect(mgr.fetchMany('R_1', Array.from({ length: 101 }, (_, i) => `e${i}`)))
      .rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('edit() sends only changed fields with an update mask', async () => {
    const ctx = makeCtx({ message: msgData })
    await new MessageManager(ctx).edit('R_1', 'evt_1', { alsoSendToChannel: false })
    expect(callFor(ctx, 'UpdateMessage')[2]).toEqual({
      roomId: 'R_1', eventId: 'evt_1', alsoSendToChannel: false, updateMask: 'alsoSendToChannel',
    })
  })

  it('edit() rejects an empty edit without calling the server', async () => {
    const ctx = makeCtx({ message: msgData })
    await expect(new MessageManager(ctx).edit('R_1', 'evt_1', {})).rejects.toBeInstanceOf(ChattoValidationError)
    expect(ctx.rest.post).not.toHaveBeenCalled()
  })

  it('react()/removeReaction() map Unicode emoji to shortcode names and return the reaction', async () => {
    const reaction = { emoji: 'thumbsup', count: 1, hasReacted: true, previewUserIds: ['U'] }
    const ctx = makeCtx({ added: true, reaction })
    const res = await new MessageManager(ctx).react('R_1', 'evt_1', '👍')
    expect(callFor(ctx, 'AddReaction')[2]).toEqual({ roomId: 'R_1', messageEventId: 'evt_1', emoji: 'thumbsup' })
    expect(res.reaction?.emoji).toBe('thumbsup')
    await new MessageManager(ctx).removeReaction('R_1', 'evt_1', 'heart')
    expect(callFor(ctx, 'RemoveReaction')[2]).toEqual({ roomId: 'R_1', messageEventId: 'evt_1', emoji: 'heart' })
  })

  it('fetchReactionUsers() calls ListReactionUsers and pages the result', async () => {
    const ctx = makeCtx(null)
    const { ListReactionUsersResponseSchema } = await import('../../src/schemas/message')
    ctx.rest.post = mock(async () => ListReactionUsersResponseSchema.parse({ userIds: ['U1'], page: { totalCount: '3', hasMore: true } }))
    const page = await new MessageManager(ctx).fetchReactionUsers('R_1', 'evt_1', 'heart', { limit: 1 })
    expect(ctx.rest.post).toHaveBeenCalledWith(
      'chatto.api.v1.MessageService', 'ListReactionUsers',
      { roomId: 'R_1', messageEventId: 'evt_1', emoji: 'heart', page: { limit: 1, offset: undefined } }, expect.anything(),
    )
    expect(page).toEqual({ items: ['U1'], totalCount: 3, hasMore: true })
    // proto3: a reaction nobody has returns `{ page: {} }`.
    ctx.rest.post = mock(async () => ListReactionUsersResponseSchema.parse({ page: {} }))
    expect(await new MessageManager(ctx).fetchReactionUsers('R_1', 'evt_1', 'joy'))
      .toEqual({ items: [], totalCount: 0, hasMore: false })
  })

  it('fetchLinkPreview() calls FetchLinkPreview and validates the URL', async () => {
    const ctx = makeCtx({ preview: { url: 'https://example.com', title: 'Example' }, previewToken: 'cht_1' })
    const res = await new MessageManager(ctx).fetchLinkPreview('https://example.com')
    expect(ctx.rest.post).toHaveBeenCalledWith(
      'chatto.api.v1.MessageService', 'FetchLinkPreview',
      { url: 'https://example.com', omitPreviewToken: undefined }, expect.anything(),
    )
    expect(res.previewToken).toBe('cht_1')
    await new MessageManager(ctx).fetchLinkPreview('https://x.y', { omitPreviewToken: true })
    expect(ctx.rest.post.mock.calls[1][2]).toEqual({ url: 'https://x.y', omitPreviewToken: true })
    await expect(new MessageManager(ctx).fetchLinkPreview('')).rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('deleteLinkPreview()/deleteAttachment()/delete() send the right requests', async () => {
    const ctx = makeCtx({})
    const mgr = new MessageManager(ctx)
    await mgr.deleteLinkPreview('R_1', 'evt_1', 'https://example.com')
    await mgr.deleteAttachment('R_1', 'evt_1', 'at_1')
    await mgr.delete('R_1', 'evt_1')
    expect(callFor(ctx, 'DeleteLinkPreview')[2]).toEqual({ roomId: 'R_1', eventId: 'evt_1', url: 'https://example.com' })
    expect(callFor(ctx, 'DeleteAttachment')[2]).toEqual({ roomId: 'R_1', eventId: 'evt_1', attachmentId: 'at_1' })
    expect(callFor(ctx, 'DeleteMessage')[2]).toEqual({ roomId: 'R_1', eventId: 'evt_1' })
  })

  it('setAttachmentDescription() trims, validates and returns the updated message', async () => {
    const ctx = makeCtx({ message: msgData })
    const msg = await new MessageManager(ctx).setAttachmentDescription('R_1', 'evt_1', 'at_1', '  a dog \n')
    expect(callFor(ctx, 'SetAttachmentDescription')[2]).toEqual({
      roomId: 'R_1', eventId: 'evt_1', attachmentId: 'at_1', description: 'a dog',
    })
    expect(msg).toBeInstanceOf(Message)
    await expect(new MessageManager(ctx).setAttachmentDescription('R_1', 'evt_1', 'at_1', 'x'.repeat(1001)))
      .rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('pin()/unpin() call RoomService pin RPCs', async () => {
    const ctx = makeCtx({ pinnedMessage: { message: { ...msgData, pinned: true } } })
    const pinned = await new MessageManager(ctx).pin('R_1', 'evt_1')
    expect(ctx.rest.post).toHaveBeenCalledWith(
      'chatto.api.v1.RoomService', 'CreatePinnedMessage', { roomId: 'R_1', messageEventId: 'evt_1' }, expect.anything(),
    )
    expect(pinned?.pinned).toBe(true)
    ctx.rest.post = mock().mockResolvedValue({ deleted: true })
    expect(await new MessageManager(ctx).unpin('R_1', 'evt_1')).toBe(true)
    expect(ctx.rest.post).toHaveBeenCalledWith(
      'chatto.api.v1.RoomService', 'DeletePinnedMessage', { roomId: 'R_1', messageEventId: 'evt_1' }, expect.anything(),
    )
  })
})
