import { z } from 'zod'
import { MessageAttachmentSchema } from './asset'

export const MessageReactionSchema = z.object({
  emoji: z.string(),
  count: z.number().int(),
  hasReacted: z.boolean().default(false),
  previewUserIds: z.array(z.string()).default([]),
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
  reactions: z.array(MessageReactionSchema).default([]),
  attachments: z.array(MessageAttachmentSchema).default([]),
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
export const DeleteMessageResponseSchema = z.object({ deleted: z.boolean() })
export const DeleteAttachmentResponseSchema = z.object({ deleted: z.boolean() })
export const AddReactionResponseSchema = z.object({ added: z.boolean() })
export const RemoveReactionResponseSchema = z.object({ removed: z.boolean() })
