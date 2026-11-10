import { z } from 'zod'
import { MessageSchema, ThreadSummarySchema, ThreadViewerStateSchema } from './message'
import { GetRoomEventsResponseSchema, PageInfoSchema, RoomKindSchema } from './room'
import { UserSchema } from './user'

/** Follow state for one thread and the current user. */
export const ThreadFollowStateSchema = z.object({
  roomId: z.string().default(''),
  threadRootEventId: z.string().default(''),
  following: z.boolean().default(false),
})

export const FollowThreadResponseSchema = z.object({ state: ThreadFollowStateSchema.optional() })
export const UnfollowThreadResponseSchema = FollowThreadResponseSchema

/** Stored read position. `lastReadAt` is absent when the event can no longer be resolved. */
export const ReadMarkerSchema = z.object({
  lastReadEventId: z.string().default(''),
  lastReadAt: z.string().optional(),
})

export const ThreadReadStateSchema = z.object({
  roomId: z.string().default(''),
  threadRootEventId: z.string().default(''),
  /** Absent when the viewer has never stored a marker for this thread. */
  marker: ReadMarkerSchema.optional(),
})

export const GetThreadReadStateResponseSchema = z.object({ state: ThreadReadStateSchema.optional() })

export const BatchGetThreadReadStatesResponseSchema = z.object({
  states: z.array(ThreadReadStateSchema).default([]),
})

export const MarkThreadAsReadResponseSchema = z.object({
  previousLastReadAt: z.string().optional(),
  /** Resulting marker time; a stale request keeps the newer marker. */
  lastReadAt: z.string().optional(),
})

export const ListThreadParticipantsResponseSchema = z.object({
  userIds: z.array(z.string()).default([]),
  page: PageInfoSchema.optional(),
})

export const RoomSummarySchema = z.object({
  id: z.string(),
  kind: RoomKindSchema.default('ROOM_KIND_UNSPECIFIED'),
  /** DM rooms may have an empty name; derive a label from participants. */
  name: z.string().default(''),
})

export const TimelineIncludesSchema = z.object({
  users: z.record(z.string(), UserSchema).default({}),
})

export const FollowedThreadSchema = z.object({
  rootMessage: MessageSchema.optional(),
  room: RoomSummarySchema.optional(),
  thread: ThreadSummarySchema.optional(),
  latestReply: MessageSchema.optional(),
  directMessageParticipantUserIds: z.array(z.string()).default([]),
})

export const ListFollowedThreadsResponseSchema = z.object({
  threads: z.array(FollowedThreadSchema).default([]),
  includes: TimelineIncludesSchema.optional(),
  page: PageInfoSchema.optional(),
})

// Reuse the room timeline page shape (same `RoomTimelinePage` proto message).
const TimelinePageSchema = GetRoomEventsResponseSchema.shape.page

export const GetThreadEventsResponseSchema = z.object({
  page: TimelinePageSchema,
  viewerState: ThreadViewerStateSchema.optional(),
})

export const GetThreadEventsAroundResponseSchema = z.object({
  page: TimelinePageSchema,
  targetIndex: z.number().int().default(0),
  viewerState: ThreadViewerStateSchema.optional(),
})

export const ThreadRootAuthorFilterSchema = z.enum([
  'THREAD_ROOT_AUTHOR_FILTER_UNSPECIFIED',
  'THREAD_ROOT_AUTHOR_FILTER_VIEWER',
  'THREAD_ROOT_AUTHOR_FILTER_OTHERS',
])

export const ThreadOrderSchema = z.enum(['THREAD_ORDER_UNSPECIFIED', 'THREAD_ORDER_ACTIVITY', 'THREAD_ORDER_CREATED'])

export type ThreadFollowState = z.infer<typeof ThreadFollowStateSchema>
export type ReadMarker = z.infer<typeof ReadMarkerSchema>
export type ThreadReadState = z.infer<typeof ThreadReadStateSchema>
export type MarkThreadAsReadResult = z.infer<typeof MarkThreadAsReadResponseSchema>
export type RoomSummary = z.infer<typeof RoomSummarySchema>
export type ThreadRootAuthorFilter = z.infer<typeof ThreadRootAuthorFilterSchema>
export type ThreadOrder = z.infer<typeof ThreadOrderSchema>
