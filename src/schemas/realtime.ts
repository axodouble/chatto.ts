import { z } from 'zod'

export const MessageDeleteEventSchema = z.object({
  roomId: z.string(),
  eventId: z.string(),
  actorId: z.string().optional(),
})

export const ReactionEventSchema = z.object({
  roomId: z.string(),
  messageEventId: z.string(),
  emoji: z.string(),
  actorId: z.string().optional(),
})
