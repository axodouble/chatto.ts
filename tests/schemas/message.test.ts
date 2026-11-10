import { describe, expect, it } from 'bun:test'
import {
  MessageSchema,
  CreateMessageInputSchema,
  UpdateMessageInputSchema,
  MessageResponseSchema,
  DeleteMessageResponseSchema,
  AddReactionResponseSchema,
  RemoveReactionResponseSchema,
} from '../../src/schemas/message'

const validMessage = {
  id: 'evt_abc',
  roomId: 'room_1',
  createdAt: '2026-07-09T10:00:00Z',
  actorId: 'user_1',
  body: 'Hello',
  reactions: [],
}

describe('MessageSchema', () => {
  it('parses a valid message', () => {
    const msg = MessageSchema.parse(validMessage)
    expect(msg.id).toBe('evt_abc')
    expect(msg.body).toBe('Hello')
    expect(msg.reactions).toEqual([])
  })

  it('allows optional fields to be absent', () => {
    const { body, ...noBody } = validMessage
    const msg = MessageSchema.parse(noBody)
    expect(msg.body).toBeUndefined()
  })

  it('defaults reactions to empty array when absent', () => {
    const { reactions, ...noReactions } = validMessage
    const msg = MessageSchema.parse(noReactions)
    expect(msg.reactions).toEqual([])
  })

  it('defaults omitted reaction hasReacted to false', () => {
    const msg = MessageSchema.parse({
      ...validMessage,
      reactions: [{ emoji: '👍', count: 1 }],
    })
    expect(msg.reactions[0]?.hasReacted).toBe(false)
  })

  it('defaults attachments to empty array when absent', () => {
    const msg = MessageSchema.parse(validMessage)
    expect(msg.attachments).toEqual([])
  })

  it('parses attachments when present', () => {
    const msg = MessageSchema.parse({
      ...validMessage,
      attachments: [{ id: 'at_1', filename: 'p.png', contentType: 'image/png', width: 10, height: 10 }],
    })
    expect(msg.attachments).toHaveLength(1)
    expect(msg.attachments[0]?.id).toBe('at_1')
  })
})

describe('CreateMessageInputSchema', () => {
  it('requires roomId', () => {
    expect(() => CreateMessageInputSchema.parse({})).toThrow()
  })

  it('parses valid create input', () => {
    const input = CreateMessageInputSchema.parse({ roomId: 'room_1', body: 'Hi' })
    expect(input.roomId).toBe('room_1')
    expect(input.body).toBe('Hi')
  })

  it('parses attachmentAssetIds', () => {
    const input = CreateMessageInputSchema.parse({ roomId: 'room_1', attachmentAssetIds: ['as_1', 'as_2'] })
    expect(input.attachmentAssetIds).toEqual(['as_1', 'as_2'])
  })
})

describe('UpdateMessageInputSchema', () => {
  it('requires roomId and eventId', () => {
    expect(() => UpdateMessageInputSchema.parse({ roomId: 'room_1' })).toThrow()
  })

  it('parses valid update input', () => {
    const input = UpdateMessageInputSchema.parse({ roomId: 'room_1', eventId: 'evt_1', body: 'Updated' })
    expect(input.eventId).toBe('evt_1')
  })
})

describe('MessageResponseSchema', () => {
  it('parses wrapped message response', () => {
    const res = MessageResponseSchema.parse({ message: validMessage })
    expect(res.message.id).toBe('evt_abc')
  })
})

describe('DeleteMessageResponseSchema', () => {
  it('parses the empty Chatto 0.5 response', () => {
    expect(DeleteMessageResponseSchema.parse({})).toEqual({})
  })
})

describe('AddReactionResponseSchema', () => {
  it('parses added: true', () => {
    expect(AddReactionResponseSchema.parse({ added: true }).added).toBe(true)
  })
})

describe('RemoveReactionResponseSchema', () => {
  it('parses removed: true', () => {
    expect(RemoveReactionResponseSchema.parse({ removed: true }).removed).toBe(true)
  })
})

describe('v0.5 MessageService response schemas', () => {
  it('ListReactionUsersResponseSchema defaults an empty response', async () => {
    const { ListReactionUsersResponseSchema } = await import('../../src/schemas/message')
    expect(ListReactionUsersResponseSchema.parse({ page: {} })).toEqual({ userIds: [], page: { totalCount: 0, hasMore: false } })
    expect(ListReactionUsersResponseSchema.parse({ userIds: ['U'], page: { totalCount: '1' } }).page?.totalCount).toBe(1)
  })

  it('FetchLinkPreviewResponseSchema parses a preview with social post and an empty response', async () => {
    const { FetchLinkPreviewResponseSchema } = await import('../../src/schemas/message')
    const res = FetchLinkPreviewResponseSchema.parse({
      preview: {
        url: 'https://bsky.app/x', embedType: 'generic',
        socialPost: { provider: 'bluesky', author: { displayName: 'A' }, images: [{ url: 'u' }], quotedPost: { text: 'q' } },
      },
      previewToken: 'cht_1',
    })
    expect(res.preview?.socialPost?.provider).toBe('bluesky')
    expect(res.preview?.socialPost?.author?.handle).toBe('')
    expect(res.preview?.socialPost?.images[0]?.assetId).toBe('')
    expect(FetchLinkPreviewResponseSchema.parse({})).toEqual({ previewToken: '' })
  })

  it('BatchGetMessages / pin / empty responses parse proto3-omitted fields', async () => {
    const m = await import('../../src/schemas/message')
    expect(m.BatchGetMessagesResponseSchema.parse({})).toEqual({ messages: [] })
    expect(m.DeleteLinkPreviewResponseSchema.parse({})).toEqual({})
    expect(m.DeletePinnedMessageResponseSchema.parse({})).toEqual({ deleted: false })
    expect(m.CreatePinnedMessageResponseSchema.parse({ pinnedMessage: { message: validMessage } }).pinnedMessage?.message?.pinned)
      .toBe(false)
    expect(m.SetAttachmentDescriptionResponseSchema.parse({ message: validMessage }).message.id).toBe('evt_abc')
  })

  it('AddReactionResponseSchema parses the returned reaction', () => {
    const res = AddReactionResponseSchema.parse({ added: true, reaction: { emoji: 'heart', count: 1, hasReacted: true } })
    expect(res.reaction).toEqual({ emoji: 'heart', count: 1, hasReacted: true, previewUserIds: [] })
  })
})
