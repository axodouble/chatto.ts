import { z } from 'zod'
import { MessageAttachmentSchema } from './asset'

export const MessageReactionSchema = z.object({
  emoji: z.string(),
  // proto3 JSON omits zero-value scalars.
  count: z.number().int().default(0),
  hasReacted: z.boolean().default(false),
  previewUserIds: z.array(z.string()).default([]),
})

export const LinkPreviewSchema = z.looseObject({
  url: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  imageAssetId: z.string().optional(),
  siteName: z.string().optional(),
  embedType: z.string().optional(),
  embedId: z.string().optional(),
  /** Rich social-post preview (author, text, images), when available. */
  socialPost: z.record(z.string(), z.unknown()).optional(),
})

export const ThreadViewerStateSchema = z.object({
  isFollowing: z.boolean().optional(),
  hasUnreadReplies: z.boolean().optional(),
  slowModeNextPostAt: z.string().optional(),
})

export const ThreadSummarySchema = z.object({
  threadRootEventId: z.string().default(''),
  replyCount: z.number().int().default(0),
  lastReplyAt: z.string().optional(),
  participantPreviewUserIds: z.array(z.string()).default([]),
  participantCount: z.number().int().default(0),
  viewerState: ThreadViewerStateSchema.optional(),
})

export const MessageViewerStateSchema = z.object({
  canReplyInThread: z.boolean().optional(),
  threadSlowModeNextPostAt: z.string().optional(),
})

export const MessageSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  createdAt: z.string(),
  actorId: z.string(),
  body: z.string().optional(),
  updatedAt: z.string().optional(),
  inReplyTo: z.string().optional(),
  threadRootEventId: z.string().optional(),
  echoOfEventId: z.string().optional(),
  echoFromThreadRootEventId: z.string().optional(),
  channelEchoEventId: z.string().optional(),
  reactions: z.array(MessageReactionSchema).default([]),
  attachments: z.array(MessageAttachmentSchema).default([]),
  linkPreview: LinkPreviewSchema.optional(),
  /** Present only once a durable thread exists for this root message. */
  thread: ThreadSummarySchema.optional(),
  /** Set when the content was retracted or crypto-shredded. */
  deletedAt: z.string().optional(),
  pinned: z.boolean().default(false),
  viewerState: MessageViewerStateSchema.optional(),
})

export const CreateMessageInputSchema = z.object({
  roomId: z.string(),
  body: z.string().optional(),
  inReplyTo: z.string().optional(),
  threadRootEventId: z.string().optional(),
  alsoSendToChannel: z.boolean().optional(),
  attachmentAssetIds: z.array(z.string()).optional(),
})

export const UpdateMessageInputSchema = z.object({
  roomId: z.string(),
  eventId: z.string(),
  body: z.string().optional(),
  alsoSendToChannel: z.boolean().optional(),
})

export const MessageResponseSchema = z.object({ message: MessageSchema })
// Chatto 0.5 removed the `deleted` flag: success is an empty response.
export const DeleteMessageResponseSchema = z.object({})
export const DeleteAttachmentResponseSchema = z.object({})
export const AddReactionResponseSchema = z.object({
  added: z.boolean().default(false),
  reaction: MessageReactionSchema.optional(),
})
export const RemoveReactionResponseSchema = z.object({
  removed: z.boolean().default(false),
  reaction: MessageReactionSchema.optional(),
})
