import { z } from 'zod'
import { MessageAttachmentSchema } from './asset'

export const MessageReactionSchema = z.object({
  emoji: z.string(),
  // proto3 JSON omits zero-value scalars.
  count: z.number().int().default(0),
  hasReacted: z.boolean().default(false),
  previewUserIds: z.array(z.string()).default([]),
})

export const SocialPostAuthorSchema = z.looseObject({
  displayName: z.string().default(''),
  handle: z.string().default(''),
  avatarUrl: z.string().optional(),
  avatarAssetId: z.string().optional(),
})

export const SocialPostImageSchema = z.looseObject({
  url: z.string().default(''),
  assetId: z.string().default(''),
  alt: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
})

export const SocialPostExternalLinkSchema = z.looseObject({
  url: z.string().default(''),
  title: z.string().optional(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  imageAssetId: z.string().optional(),
})

/** Provider-neutral social-post data (e.g. a Bluesky post) for native preview cards. */
export const SocialPostPreviewSchema = z.looseObject({
  provider: z.string().default(''),
  author: SocialPostAuthorSchema.optional(),
  text: z.string().default(''),
  publishedAt: z.string().optional(),
  images: z.array(SocialPostImageSchema).default([]),
  externalLink: SocialPostExternalLinkSchema.optional(),
  contentWarning: z.string().optional(),
  url: z.string().default(''),
  /** Quoted post. The server omits quotes nested inside a quote, so this is one level deep. */
  quotedPost: z.record(z.string(), z.unknown()).optional(),
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
  socialPost: SocialPostPreviewSchema.optional(),
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

export const MessageAttachmentDescriptionInputSchema = z.object({
  assetId: z.string(),
  description: z.string(),
})

export const CreateMessageInputSchema = z.object({
  roomId: z.string(),
  body: z.string().optional(),
  inReplyTo: z.string().optional(),
  threadRootEventId: z.string().optional(),
  alsoSendToChannel: z.boolean().optional(),
  attachmentAssetIds: z.array(z.string()).optional(),
  /** Token returned by `FetchLinkPreview` for the preview to attach. */
  linkPreviewToken: z.string().optional(),
  /** Establish the new root message as a thread immediately. */
  createThread: z.boolean().optional(),
  attachmentDescriptions: z.array(MessageAttachmentDescriptionInputSchema).optional(),
  /** Caller-generated UUID making retries of this send safe for 30 minutes. */
  idempotencyKey: z.string().optional(),
})

export const UpdateMessageInputSchema = z.object({
  roomId: z.string(),
  eventId: z.string(),
  body: z.string().optional(),
  alsoSendToChannel: z.boolean().optional(),
  /** FieldMask of the fields to apply (`body`, `alsoSendToChannel`), comma-separated. */
  updateMask: z.string().optional(),
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

// proto3 JSON: int64 is a string; missing page info means an empty page.
const PageInfoSchema = z.object({
  totalCount: z.coerce.number().default(0),
  hasMore: z.boolean().default(false),
})

export const ListReactionUsersResponseSchema = z.object({
  userIds: z.array(z.string()).default([]),
  page: PageInfoSchema.optional(),
})

export const FetchLinkPreviewResponseSchema = z.object({
  /** Absent when the URL cannot be previewed. */
  preview: LinkPreviewSchema.optional(),
  /** Empty when `omitPreviewToken` was set. */
  previewToken: z.string().default(''),
})

export const DeleteLinkPreviewResponseSchema = z.object({})

export const BatchGetMessagesResponseSchema = z.object({
  messages: z.array(MessageSchema).default([]),
})

export const SetAttachmentDescriptionResponseSchema = z.object({ message: MessageSchema })

export const PinnedMessageSchema = z.object({ message: MessageSchema.optional() })

export const CreatePinnedMessageResponseSchema = z.object({
  pinnedMessage: PinnedMessageSchema.optional(),
})

export const DeletePinnedMessageResponseSchema = z.object({
  deleted: z.boolean().default(false),
})

export type LinkPreview = z.infer<typeof LinkPreviewSchema>
export type SocialPostPreview = z.infer<typeof SocialPostPreviewSchema>
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>
export type ThreadViewerState = z.infer<typeof ThreadViewerStateSchema>
export type MessageViewerState = z.infer<typeof MessageViewerStateSchema>
export type MessageAttachmentDescriptionInput = z.infer<typeof MessageAttachmentDescriptionInputSchema>
export type FetchLinkPreviewResult = z.infer<typeof FetchLinkPreviewResponseSchema>
export type AddReactionResult = z.infer<typeof AddReactionResponseSchema>
export type RemoveReactionResult = z.infer<typeof RemoveReactionResponseSchema>
