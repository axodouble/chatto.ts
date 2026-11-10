import { z } from 'zod'
import { PageInfoSchema } from './page'
import { MessageSchema } from './message'
import { RoomInvitationSchema } from './room-invitation'
// NOTE: user.ts imports PageInfoSchema from this module, so UserSchema is only
// referenced lazily below (inside z.lazy) to keep the import cycle safe.
import { UserSchema } from './user'

export { PageInfoSchema }

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
  /** Pending invitation for the viewer; does not grant access to room content. */
  invitation: RoomInvitationSchema.optional(),
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

// proto3 JSON omits empty repeated fields, so `rooms` is absent when the caller
// is a member of no rooms.
export const ListRoomsResponseSchema = z.object({
  rooms: z.array(RoomWithViewerStateSchema).default([]),
  page: PageInfoSchema.optional(),
})

export const GetRoomResponseSchema = z.object({
  room: RoomWithViewerStateSchema,
})

export const RoomDirectoryScopeSchema = z
  .enum([
    'ROOM_DIRECTORY_SCOPE_UNSPECIFIED',
    'ROOM_DIRECTORY_SCOPE_ALL',
    'ROOM_DIRECTORY_SCOPE_CHANNELS',
    'ROOM_DIRECTORY_SCOPE_DMS',
  ])

export const RoomArchiveFilterSchema = z
  .enum([
    'ROOM_ARCHIVE_FILTER_UNSPECIFIED',
    'ROOM_ARCHIVE_FILTER_ACTIVE',
    'ROOM_ARCHIVE_FILTER_ARCHIVED',
    'ROOM_ARCHIVE_FILTER_ALL',
  ])

export const BatchGetRoomsResponseSchema = z.object({
  rooms: z.array(RoomWithViewerStateSchema).default([]),
})

// ---------------------------------------------------------------------------
// Room groups
// ---------------------------------------------------------------------------

export const SidebarLinkSchema = z.object({
  id: z.string(),
  label: z.string().default(''),
  /** Absolute http(s) URL or server-local path. */
  url: z.string().default(''),
})

/** One sidebar entry: exactly one of `room` / `sidebarLink` is set (proto oneof). */
export const RoomGroupItemSchema = z.object({
  room: RoomWithViewerStateSchema.optional(),
  sidebarLink: SidebarLinkSchema.optional(),
})

export const RoomGroupViewerStateSchema = z.object({
  permissions: z.array(PermissionGrantSchema).default([]),
})

export const RoomGroupSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  description: z.string().optional(),
  /** Mixed room / sidebar-link entries in sidebar order. */
  items: z.array(RoomGroupItemSchema).default([]),
  viewerState: RoomGroupViewerStateSchema.optional(),
})

export const ListRoomGroupsResponseSchema = z.object({
  groups: z.array(RoomGroupSchema).default([]),
})
export const GetRoomGroupResponseSchema = z.object({ group: RoomGroupSchema })
export const BatchGetRoomGroupsResponseSchema = ListRoomGroupsResponseSchema

// ---------------------------------------------------------------------------
// Room timeline (room_timeline.proto). Also used for thread timelines.
// ---------------------------------------------------------------------------

const RoomMessagePostedSchema = z.object({
  message: MessageSchema,
})

/** Payload for room lifecycle and membership timeline events. */
export const RoomTimelineRoomEventSchema = z.object({
  roomId: z.string().default(''),
})

/** Payload for voice-call lifecycle timeline events. */
export const RoomTimelineCallEventSchema = z.object({
  roomId: z.string().default(''),
  callId: z.string().default(''),
})

export const RoomTimelineThreadingModeChangedEventSchema = z.object({
  roomId: z.string().default(''),
  threadingMode: RoomThreadingModeSchema.default('ROOM_THREADING_MODE_UNSPECIFIED'),
})

/**
 * One event in a room or thread timeline. The `event` oneof is encoded flat:
 * exactly one of the payload fields below is set (none, for event kinds this
 * SDK does not know yet). Use {@link timelineEventKind} to switch on it.
 */
export const RoomTimelineEventSchema = z.object({
  id: z.string(),
  createdAt: z.string().default(''),
  /** User ID of the event actor (`"system"` for server-generated events). */
  actorId: z.string().default(''),
  messagePosted: RoomMessagePostedSchema.optional(),
  roomCreated: RoomTimelineRoomEventSchema.optional(),
  roomUpdated: RoomTimelineRoomEventSchema.optional(),
  roomDeleted: RoomTimelineRoomEventSchema.optional(),
  roomArchived: RoomTimelineRoomEventSchema.optional(),
  roomUnarchived: RoomTimelineRoomEventSchema.optional(),
  roomThreadingModeChanged: RoomTimelineThreadingModeChangedEventSchema.optional(),
  userJoinedRoom: RoomTimelineRoomEventSchema.optional(),
  userLeftRoom: RoomTimelineRoomEventSchema.optional(),
  callStarted: RoomTimelineCallEventSchema.optional(),
  callEnded: RoomTimelineCallEventSchema.optional(),
})

export type RoomTimelineEvent = z.infer<typeof RoomTimelineEventSchema>

export const ROOM_TIMELINE_EVENT_KINDS = [
  'messagePosted',
  'roomCreated',
  'roomUpdated',
  'roomDeleted',
  'roomArchived',
  'roomUnarchived',
  'roomThreadingModeChanged',
  'userJoinedRoom',
  'userLeftRoom',
  'callStarted',
  'callEnded',
] as const

export type RoomTimelineEventKind = (typeof ROOM_TIMELINE_EVENT_KINDS)[number] | 'unknown'

/** Which payload a timeline event carries (`'unknown'` for kinds newer than this SDK). */
export function timelineEventKind(event: RoomTimelineEvent): RoomTimelineEventKind {
  for (const kind of ROOM_TIMELINE_EVENT_KINDS) {
    if (event[kind] != null) return kind
  }
  return 'unknown'
}

export const RoomTimelineIncludesSchema = z.object({
  /** Users referenced by the page, keyed by user ID. */
  users: z.record(z.string(), z.lazy(() => UserSchema)).default({}),
})

/** Cursor page of timeline events (oldest first). Cursors are opaque. */
export const RoomTimelinePageSchema = z.object({
  // Omitted entirely (proto3 JSON) when a page has no events — default to [].
  events: z.array(RoomTimelineEventSchema).default([]),
  startCursor: z.string().optional(),
  endCursor: z.string().optional(),
  hasOlder: z.boolean().default(false),
  hasNewer: z.boolean().default(false),
  includes: RoomTimelineIncludesSchema.optional(),
})

export type RoomTimelinePage = z.infer<typeof RoomTimelinePageSchema>

export const GetRoomEventsResponseSchema = z.object({
  page: RoomTimelinePageSchema,
})

export const GetRoomEventsAroundResponseSchema = z.object({
  page: RoomTimelinePageSchema,
  /** Zero-based index of the anchor event within `page.events`. */
  targetIndex: z.number().int().default(0),
})

export type RoomWithViewerState = z.infer<typeof RoomWithViewerStateSchema>
export type RoomViewerState = z.infer<typeof RoomViewerStateSchema>
export type RoomKind = z.infer<typeof RoomKindSchema>
export type RoomThreadingMode = z.infer<typeof RoomThreadingModeSchema>
export type RoomDirectoryScope = z.infer<typeof RoomDirectoryScopeSchema>
export type RoomArchiveFilter = z.infer<typeof RoomArchiveFilterSchema>
export type PermissionGrant = z.infer<typeof PermissionGrantSchema>
export type RoomGroup = z.infer<typeof RoomGroupSchema>
export type RoomGroupItem = z.infer<typeof RoomGroupItemSchema>
export type SidebarLink = z.infer<typeof SidebarLinkSchema>
