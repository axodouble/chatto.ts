import { z } from 'zod'
import { MessageSchema } from './message'

export const RoomKindSchema = z
  .enum(['ROOM_KIND_UNSPECIFIED', 'ROOM_KIND_CHANNEL', 'ROOM_KIND_DM'])
  .catch('ROOM_KIND_UNSPECIFIED')

export const RoomThreadingModeSchema = z
  .enum([
    'ROOM_THREADING_MODE_UNSPECIFIED',
    'ROOM_THREADING_MODE_REQUIRED',
    'ROOM_THREADING_MODE_ENCOURAGED',
    'ROOM_THREADING_MODE_ENABLED',
    'ROOM_THREADING_MODE_DISABLED',
  ])
  .catch('ROOM_THREADING_MODE_UNSPECIFIED')

// proto3 JSON omits zero values (empty strings, false, 0, enum 0), so every
// scalar carries a default.
export const RoomSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  kind: RoomKindSchema.default('ROOM_KIND_UNSPECIFIED'),
  description: z.string().optional(),
  archived: z.boolean().default(false),
  groupId: z.string().optional(),
  universal: z.boolean().default(false),
  slowModeSeconds: z.number().int().default(0),
  threadingMode: RoomThreadingModeSchema.default('ROOM_THREADING_MODE_UNSPECIFIED'),
  threadSlowModeSeconds: z.number().int().optional(),
  createdAt: z.string().optional(),
  showMembershipEvents: z.boolean().optional(),
})

export const PermissionGrantSchema = z.object({
  permission: z.string(),
  granted: z.boolean().default(false),
})

export const RoomViewerStateSchema = z.looseObject({
  isMember: z.boolean().default(false),
  hasUnread: z.boolean().default(false),
  permissions: z.array(PermissionGrantSchema).default([]),
  slowModeNextPostAt: z.string().optional(),
  /** Pending invitation for the viewer, when there is one. */
  invitation: z.record(z.string(), z.unknown()).optional(),
  canRejoin: z.boolean().optional(),
})

export const RoomWithViewerStateSchema = z.object({
  room: RoomSchema,
  viewerState: RoomViewerStateSchema.optional(),
  memberUserIds: z.array(z.string()).default([]),
  hasMessageHistory: z.boolean().optional(),
  lastMessageAt: z.string().optional(),
  lastRootMessageAt: z.string().optional(),
})

export const PageInfoSchema = z.object({
  totalCount: z.coerce.number().default(0),
  hasMore: z.boolean().default(false),
})

// proto3 JSON omits empty repeated fields, so `rooms` is absent when the caller
// is a member of no rooms.
export const ListRoomsResponseSchema = z.object({
  rooms: z.array(RoomWithViewerStateSchema).default([]),
  page: PageInfoSchema.optional(),
})

export const GetRoomResponseSchema = z.object({
  room: RoomWithViewerStateSchema,
})

const RoomMessagePostedSchema = z.object({
  message: MessageSchema,
})

const RoomTimelineEventSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  actorId: z.string(),
  messagePosted: RoomMessagePostedSchema.optional(),
})

export const GetRoomEventsResponseSchema = z.object({
  page: z.object({
    // Omitted entirely (proto3 JSON) when a page has no events — default to [].
    events: z.array(RoomTimelineEventSchema).default([]),
    startCursor: z.string().optional(),
    endCursor: z.string().optional(),
    hasOlder: z.boolean().default(false),
    hasNewer: z.boolean().default(false),
  }),
})
