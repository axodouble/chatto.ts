import { z } from 'zod'
import { PageInfoSchema } from './page'
import { RoomSchema } from './room'
import { MessageSchema } from './message'
import { DirectoryMemberSchema } from './user'
import { AssetSchema } from './asset'

// Response schemas for chatto.api.v1.RoomService (rooms.proto, read_state.proto).
// proto3 JSON omits zero values, so every scalar/repeated field carries a default.

/** Response of CreateRoom / UpdateRoom / ArchiveRoom / UnarchiveRoom / JoinRoom / StartDM. */
export const RoomMutationResponseSchema = z.object({ room: RoomSchema })

export const JoinRoomGroupResponseSchema = z.object({
  /** Room IDs that transitioned from not joined to joined. */
  joinedRoomIds: z.array(z.string()).default([]),
})

export const EmptyResponseSchema = z.object({})

// --- Notices ---------------------------------------------------------------

export const RoomNoticeSchema = z.object({
  /** Markdown source. Empty means the notice has been cleared. */
  body: z.string().default(''),
  /** Opaque write version; send it back as `expectedVersion` on mutations. */
  version: z.string().default(''),
  /** Opaque dismissal revision. Empty when there is no published notice. */
  publicationId: z.string().default(''),
  publishedAt: z.string().optional(),
})

export const RoomNoticeResponseSchema = z.object({
  notice: RoomNoticeSchema.prefault({}),
})

// --- Read state -------------------------------------------------------------

export const ReadMarkerSchema = z.object({
  lastReadEventId: z.string().default(''),
  /** Creation time of the last-read event, when it can still be resolved. */
  lastReadAt: z.string().optional(),
})

export const RoomReadStateSchema = z.object({
  roomId: z.string(),
  /** Absent when no marker has been stored. */
  marker: ReadMarkerSchema.optional(),
})

export const GetRoomReadStateResponseSchema = z.object({ state: RoomReadStateSchema })
export const BatchGetRoomReadStatesResponseSchema = z.object({
  states: z.array(RoomReadStateSchema).default([]),
})

export const MarkRoomAsReadResponseSchema = z.object({
  /** New room read timestamp stored for the current user. */
  lastReadAt: z.string().optional(),
  /** Previous room read timestamp, when one existed. */
  previousLastReadAt: z.string().optional(),
})

// --- Members ----------------------------------------------------------------

export const ListMembersResponseSchema = z.object({
  /** Member user IDs in ascending order. */
  userIds: z.array(z.string()).default([]),
  page: PageInfoSchema.optional(),
})
export const MemberResponseSchema = z.object({ member: DirectoryMemberSchema })
export const BatchGetMembersResponseSchema = z.object({
  members: z.array(DirectoryMemberSchema).default([]),
})
export const RemoveMemberResponseSchema = z.object({ removed: z.boolean().default(false) })

// --- Suspensions -----------------------------------------------------------

export const RoomSuspensionSchema = z.object({
  id: z.string(),
  roomId: z.string().default(''),
  /** Room metadata, when the room still exists. */
  room: RoomSchema.optional(),
  userId: z.string().default(''),
  /** Suspended user's profile, when the user still exists. */
  user: DirectoryMemberSchema.optional(),
  moderatorId: z.string().default(''),
  moderator: DirectoryMemberSchema.optional(),
  reason: z.string().default(''),
  createdAt: z.string().optional(),
  /** Absent means the suspension is indefinite. */
  expiresAt: z.string().optional(),
})

export const ListSuspensionsResponseSchema = z.object({
  suspensions: z.array(RoomSuspensionSchema).default([]),
  page: PageInfoSchema.optional(),
})

// --- Attachments ------------------------------------------------------------

export const RoomAttachmentListItemSchema = z.object({
  attachment: AssetSchema,
  messageEventId: z.string().default(''),
  /** Thread root event ID when the containing message is a thread reply. */
  threadRootEventId: z.string().optional(),
  createdAt: z.string().optional(),
  description: z.string().optional(),
})

export const ListRoomAttachmentsResponseSchema = z.object({
  attachments: z.array(RoomAttachmentListItemSchema).default([]),
  page: PageInfoSchema.optional(),
})

// --- Pins ------------------------------------------------------------------

export const PinnedMessageSchema = z.object({ message: MessageSchema })

export const ListPinnedMessagesResponseSchema = z.object({
  /** Newest pin first. */
  pinnedMessages: z.array(PinnedMessageSchema).default([]),
  page: PageInfoSchema.optional(),
  /** Opaque marker of the latest pin; stable across unpins. Do not interpret. */
  latestPinMarker: z.string().default(''),
})
export const CreatePinnedMessageResponseSchema = z.object({ pinnedMessage: PinnedMessageSchema })
export const DeletePinnedMessageResponseSchema = z.object({ deleted: z.boolean().default(false) })

export type RoomNotice = z.infer<typeof RoomNoticeSchema>
export type ReadMarker = z.infer<typeof ReadMarkerSchema>
export type RoomReadState = z.infer<typeof RoomReadStateSchema>
export type MarkRoomAsReadResult = z.infer<typeof MarkRoomAsReadResponseSchema>
export type RoomSuspension = z.infer<typeof RoomSuspensionSchema>
export type RoomAttachmentListItem = z.infer<typeof RoomAttachmentListItemSchema>
