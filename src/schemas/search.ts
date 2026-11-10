import { z } from 'zod'

import { MessageSchema, ThreadSummarySchema } from './message'
import { UserSchema } from './user'
import { RoomSummarySchema } from './voice'

/** Current availability of message search on the server. */
export const MessageSearchStateSchema = z
  .enum([
    'MESSAGE_SEARCH_STATE_UNSPECIFIED',
    'MESSAGE_SEARCH_STATE_DISABLED',
    'MESSAGE_SEARCH_STATE_STARTING',
    'MESSAGE_SEARCH_STATE_INDEXING',
    'MESSAGE_SEARCH_STATE_READY',
    'MESSAGE_SEARCH_STATE_DEGRADED',
    'MESSAGE_SEARCH_STATE_UNAVAILABLE',
  ])
  .catch('MESSAGE_SEARCH_STATE_UNSPECIFIED')
  .default('MESSAGE_SEARCH_STATE_UNSPECIFIED')

export const GetSearchStatusResponseSchema = z.object({
  state: MessageSearchStateSchema,
  /** Suggested delay before re-checking while not ready, as a proto Duration (e.g. "30s"). */
  retryAfter: z.string().optional(),
})

/** Thread context of a grouped (`groupBy: 'thread'`) search result. */
export const ThreadSearchContextSchema = z.object({
  rootMessage: MessageSchema.optional(),
  room: RoomSummarySchema.optional(),
  thread: ThreadSummarySchema.optional(),
  latestReply: MessageSchema.optional(),
  /** Conversation-label participants for direct messages; empty for channels. */
  directMessageParticipantUserIds: z.array(z.string()).default([]),
})

export const MessageSearchResultSchema = z.object({
  message: MessageSchema.optional(),
  // proto `double`: JSON may carry "NaN"/"Infinity" strings.
  relevanceScore: z.coerce.number().default(0),
  threadContext: ThreadSearchContextSchema.optional(),
})

export const SearchMessagesResponseSchema = z.object({
  results: z.array(MessageSearchResultSchema).default([]),
  nextCursor: z.string().default(''),
  /** uint64, present only with thread grouping. */
  threadTotalCount: z.coerce.number().optional(),
  includes: z
    .object({ users: z.record(z.string(), UserSchema).default({}) })
    .optional(),
})

export type MessageSearchState = z.infer<typeof MessageSearchStateSchema>
export type SearchStatusData = z.infer<typeof GetSearchStatusResponseSchema>
export type ThreadSearchContextData = z.infer<typeof ThreadSearchContextSchema>
export type MessageSearchResultData = z.infer<typeof MessageSearchResultSchema>
