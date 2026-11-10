import { z } from 'zod'

import { RoomKindSchema } from './room'
import { UserSchema } from './user'

export const RoomSummarySchema = z.object({
  id: z.string(),
  kind: RoomKindSchema,
  name: z.string().default(''),
})
export type RoomSummary = z.infer<typeof RoomSummarySchema>

export const CallParticipantSchema = z.object({
  user: UserSchema.optional(),
  joinedAt: z.string().optional(),
  callId: z.string().default(''),
})
export type CallParticipant = z.infer<typeof CallParticipantSchema>

export const ActiveCallSchema = z.object({
  room: RoomSummarySchema.optional(),
  callId: z.string().default(''),
  participants: z.array(CallParticipantSchema).default([]),
})
export type ActiveCall = z.infer<typeof ActiveCallSchema>

export const ActiveCallsResponseSchema = z.object({ calls: z.array(ActiveCallSchema).default([]) })
export const GetActiveCallResponseSchema = z.object({ call: ActiveCallSchema })
export const ListCallParticipantsResponseSchema = z.object({
  participants: z.array(CallParticipantSchema).default([]),
})
export const JoinCallResponseSchema = z.object({ joined: z.boolean().default(false) })
export const LeaveCallResponseSchema = z.object({ left: z.boolean().default(false) })

export const CallTokenSchema = z.object({
  /** LiveKit JWT. */
  token: z.string().default(''),
  /** Shared E2EE key for the active call. */
  e2eeKey: z.string().default(''),
  callId: z.string().default(''),
})
export type CallToken = z.infer<typeof CallTokenSchema>

export const CallMediaPublisherKindSchema = z.enum([
  'CALL_MEDIA_PUBLISHER_KIND_UNSPECIFIED',
  'CALL_MEDIA_PUBLISHER_KIND_GAME_SHARE',
])
export type CallMediaPublisherKind = z.infer<typeof CallMediaPublisherKindSchema>
