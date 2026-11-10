import { z } from 'zod'

export const MessageDeleteEventSchema = z.object({
  roomId: z.string(),
  eventId: z.string(),
  actorId: z.string().optional(),
})

/**
 * `emoji` is a Chatto reaction name (e.g. `thumbsup`, `wave::skin-tone-3`),
 * not a Unicode glyph. Sending accepts either; see `toReactionName`.
 */
export const ReactionEventSchema = z.object({
  roomId: z.string(),
  messageEventId: z.string(),
  emoji: z.string(),
  actorId: z.string().optional(),
})
