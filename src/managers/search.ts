import type { z } from 'zod'
import type { ClientContext } from '../context'
import type { Message } from '../resources/message'
import type { UserData } from '../types'
import type { RoomSummary } from '../schemas/voice'
import type { ThreadSummarySchema } from '../schemas/message'
import { ChattoValidationError } from '../errors'
import {
  GetSearchStatusResponseSchema,
  SearchMessagesResponseSchema,
  type MessageSearchState,
  type MessageSearchResultData,
} from '../schemas/search'

const SERVICE = 'chatto.api.v1.MessageSearchService'

export type MessageSearchOrder =
  | 'relevance' | 'newest' | 'thread_activity' | 'thread_created'
  | 'MESSAGE_SEARCH_ORDER_UNSPECIFIED' | 'MESSAGE_SEARCH_ORDER_RELEVANCE' | 'MESSAGE_SEARCH_ORDER_NEWEST'
  | 'MESSAGE_SEARCH_ORDER_THREAD_ACTIVITY' | 'MESSAGE_SEARCH_ORDER_THREAD_CREATED'

export type MessageSearchScope =
  | 'all' | 'followed_threads'
  | 'MESSAGE_SEARCH_SCOPE_UNSPECIFIED' | 'MESSAGE_SEARCH_SCOPE_FOLLOWED_THREADS'

export type MessageSearchGroupBy =
  | 'message' | 'thread'
  | 'MESSAGE_SEARCH_GROUP_BY_UNSPECIFIED' | 'MESSAGE_SEARCH_GROUP_BY_THREAD'

export type ThreadRootAuthorFilter =
  | 'all' | 'viewer' | 'others'
  | 'THREAD_ROOT_AUTHOR_FILTER_UNSPECIFIED' | 'THREAD_ROOT_AUTHOR_FILTER_VIEWER' | 'THREAD_ROOT_AUTHOR_FILTER_OTHERS'

export interface SearchOptions {
  /** Restrict to one room (intersected with readable rooms and `in:` filters). */
  roomId?: string
  /** Restrict to one author (intersected with `from:` filters). */
  authorId?: string
  /** Exclusive lower bound on message creation time. */
  createdAfter?: Date | string
  /** Exclusive upper bound on message creation time. */
  createdBefore?: Date | string
  /** Only messages that currently have attachments. */
  hasAttachments?: boolean
  /** Result order. Default relevance. `thread_*` orders require `groupBy: 'thread'`. */
  order?: MessageSearchOrder
  /** Candidate scope. Default: all accessible messages. */
  scope?: MessageSearchScope
  /** `'thread'` returns one row per matching thread with `thread` context. */
  groupBy?: MessageSearchGroupBy
  /** Root-author filter; only valid with `scope: 'followed_threads'`. */
  rootAuthorFilter?: ThreadRootAuthorFilter
  /** Results per page (1–100). Server default: 50. */
  pageSize?: number
  /** Cursor from a previous page's `nextCursor`. Bound to every other option. */
  cursor?: string
}

export interface SearchAllOptions extends Omit<SearchOptions, 'cursor'> {
  /** Stop after this many pages. Default: unlimited. */
  maxPages?: number
}

/** Thread context of a grouped search result, with messages hydrated. */
export interface SearchThreadContext {
  /** Thread root, when still visible. */
  rootMessage?: Message
  /** Most recent visible reply; need not match the query. */
  latestReply?: Message
  room?: RoomSummary
  thread?: z.infer<typeof ThreadSummarySchema>
  directMessageParticipantUserIds: string[]
}

export interface SearchResult {
  /** The matching message (with thread grouping: the thread's best match). */
  message: Message
  /** Provider relevance score; higher is more relevant for the same query. */
  relevanceScore: number
  /** Present only with `groupBy: 'thread'`. */
  thread?: SearchThreadContext
}

export interface SearchPage {
  results: SearchResult[]
  /** Cursor for the next page, or `null` when there are no more matches. */
  nextCursor: string | null
  /** Total distinct matching threads; only with `groupBy: 'thread'`. */
  threadTotalCount?: number
  /** Related users keyed by ID (grouped results), avoiding per-row lookups. */
  users: Record<string, UserData>
}

export interface SearchStatus {
  state: MessageSearchState
  /** Raw proto Duration (e.g. `"30s"`), when the server suggests a retry delay. */
  retryAfter?: string
  /** `retryAfter` converted to milliseconds. */
  retryAfterMs?: number
}

const ORDER: Record<string, string> = {
  relevance: 'MESSAGE_SEARCH_ORDER_RELEVANCE',
  newest: 'MESSAGE_SEARCH_ORDER_NEWEST',
  thread_activity: 'MESSAGE_SEARCH_ORDER_THREAD_ACTIVITY',
  thread_created: 'MESSAGE_SEARCH_ORDER_THREAD_CREATED',
}
const SCOPE: Record<string, string> = {
  all: 'MESSAGE_SEARCH_SCOPE_UNSPECIFIED',
  followed_threads: 'MESSAGE_SEARCH_SCOPE_FOLLOWED_THREADS',
}
const GROUP_BY: Record<string, string> = {
  message: 'MESSAGE_SEARCH_GROUP_BY_UNSPECIFIED',
  thread: 'MESSAGE_SEARCH_GROUP_BY_THREAD',
}
const ROOT_AUTHOR: Record<string, string> = {
  all: 'THREAD_ROOT_AUTHOR_FILTER_UNSPECIFIED',
  viewer: 'THREAD_ROOT_AUTHOR_FILTER_VIEWER',
  others: 'THREAD_ROOT_AUTHOR_FILTER_OTHERS',
}

function enumInput(value: string | undefined, map: Record<string, string>): string | undefined {
  if (value == null) return undefined
  return map[value] ?? value
}

function timestamp(value: Date | string | undefined): string | undefined {
  if (value == null) return undefined
  return value instanceof Date ? value.toISOString() : value
}

function durationMs(value: string | undefined): number | undefined {
  if (value == null) return undefined
  const m = /^(-?\d+(?:\.\d+)?)s$/.exec(value)
  return m ? Math.round(Number(m[1]) * 1000) : undefined
}

/**
 * Full-text message search (`chatto.api.v1.MessageSearchService`). Results
 * are limited to messages the caller can currently read.
 */
export class SearchManager {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Report whether search is enabled and ready. Works even when search is
   * disabled. `search()` fails with `failed_precondition` when disabled and
   * `unavailable` while the index is not ready.
   */
  async status(): Promise<SearchStatus> {
    const res = await this.ctx.rest.post(SERVICE, 'GetStatus', {}, GetSearchStatusResponseSchema)
    return { state: res.state, retryAfter: res.retryAfter, retryAfterMs: durationMs(res.retryAfter) }
  }

  /**
   * Search current message bodies. `query` (1–1024 bytes) supports words,
   * "exact phrases", `AND`, and `in:` / `from:` / `before:` / `after:` /
   * `has:attachment` filters. Pages read a live index, so results may shift
   * between pages, and a page can be short even when `nextCursor` is set.
   */
  async search(query: string, opts: SearchOptions = {}): Promise<SearchPage> {
    if (query.length === 0) {
      throw new ChattoValidationError('empty_query', 'Search query must not be empty')
    }
    if (new TextEncoder().encode(query).length > 1024) {
      throw new ChattoValidationError('query_too_long', 'Search query must be at most 1024 bytes')
    }
    if (opts.pageSize != null && opts.pageSize > 100) {
      throw new ChattoValidationError('page_size_too_large', 'At most 100 search results may be requested per page')
    }
    const res = await this.ctx.rest.post(
      SERVICE,
      'SearchMessages',
      {
        query,
        roomId: opts.roomId,
        authorId: opts.authorId,
        createdAfter: timestamp(opts.createdAfter),
        createdBefore: timestamp(opts.createdBefore),
        hasAttachments: opts.hasAttachments || undefined,
        order: enumInput(opts.order, ORDER),
        pageSize: opts.pageSize,
        cursor: opts.cursor || undefined,
        scope: enumInput(opts.scope, SCOPE),
        groupBy: enumInput(opts.groupBy, GROUP_BY),
        rootAuthorFilter: enumInput(opts.rootAuthorFilter, ROOT_AUTHOR),
      },
      SearchMessagesResponseSchema,
    )
    const results = await Promise.all(
      res.results
        .filter((r): r is MessageSearchResultData & { message: NonNullable<MessageSearchResultData['message']> } =>
          r.message != null)
        .map(r => this.hydrateResult(r)),
    )
    return {
      results,
      nextCursor: res.nextCursor || null,
      threadTotalCount: res.threadTotalCount,
      users: res.includes?.users ?? {},
    }
  }

  /**
   * Iterate over every result of a search, following `nextCursor` until the
   * end (or `maxPages`). Stops if the server ever returns a cursor it already
   * returned, to avoid looping forever. Because pages come from a live index,
   * results can repeat or be skipped while the index advances.
   *
   * ```ts
   * for await (const hit of client.search.searchAll('deploy', { roomId })) {
   *   console.log(hit.message.content)
   * }
   * ```
   */
  async *searchAll(query: string, opts: SearchAllOptions = {}): AsyncGenerator<SearchResult, void, undefined> {
    const { maxPages, ...searchOpts } = opts
    const seen = new Set<string>()
    let cursor: string | undefined
    for (let pages = 0; maxPages == null || pages < maxPages; pages++) {
      const page = await this.search(query, { ...searchOpts, cursor })
      yield* page.results
      if (page.nextCursor == null || seen.has(page.nextCursor)) return
      seen.add(page.nextCursor)
      cursor = page.nextCursor
    }
  }

  private async hydrateResult(
    r: MessageSearchResultData & { message: NonNullable<MessageSearchResultData['message']> },
  ): Promise<SearchResult> {
    const ctx = r.threadContext
    const [message, rootMessage, latestReply] = await Promise.all([
      this.ctx.hydrateMessage(r.message),
      ctx?.rootMessage ? this.ctx.hydrateMessage(ctx.rootMessage) : undefined,
      ctx?.latestReply ? this.ctx.hydrateMessage(ctx.latestReply) : undefined,
    ])
    const result: SearchResult = { message, relevanceScore: r.relevanceScore }
    if (ctx != null) {
      result.thread = {
        rootMessage,
        latestReply,
        room: ctx.room,
        thread: ctx.thread,
        directMessageParticipantUserIds: ctx.directMessageParticipantUserIds,
      }
    }
    return result
  }
}
