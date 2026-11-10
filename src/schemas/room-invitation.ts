import { z } from 'zod'
import { PageInfoSchema } from './page'

export const RoomInvitationStatusSchema = z
  .enum([
    'ROOM_INVITATION_STATUS_UNSPECIFIED',
    'ROOM_INVITATION_STATUS_PENDING',
    'ROOM_INVITATION_STATUS_ACCEPTED',
    'ROOM_INVITATION_STATUS_DECLINED',
    'ROOM_INVITATION_STATUS_EXPIRED',
  ])
  .catch('ROOM_INVITATION_STATUS_UNSPECIFIED')

/** An invitation visible only to its sender and recipient. */
export const RoomInvitationSchema = z.object({
  id: z.string(),
  roomId: z.string().default(''),
  senderId: z.string().default(''),
  recipientId: z.string().default(''),
  createdAt: z.string().optional(),
  /** Expiry does not extend when the invitation is read. */
  expiresAt: z.string().optional(),
  status: RoomInvitationStatusSchema.default('ROOM_INVITATION_STATUS_UNSPECIFIED'),
  /** True only for the recipient while current room and sender rules permit acceptance. */
  canAccept: z.boolean().default(false),
})

export const RoomInvitationResponseSchema = z.object({ invitation: RoomInvitationSchema })
export const BatchGetRoomInvitationsResponseSchema = z.object({
  invitations: z.array(RoomInvitationSchema).default([]),
})
export const ListRoomInvitationsResponseSchema = z.object({
  invitations: z.array(RoomInvitationSchema).default([]),
  page: PageInfoSchema.optional(),
})

export type RoomInvitation = z.infer<typeof RoomInvitationSchema>
export type RoomInvitationStatus = z.infer<typeof RoomInvitationStatusSchema>
