import type { z } from 'zod'
import type { ClientContext } from '../context'
import type { Message } from '../resources/message'
import type { ThreadSummary, ThreadViewerState } from '../schemas/message'
import { GetRoomEventsResponseSchema } from '../schemas/room'
import {
  GetThreadEventsResponseSchema,
  GetThreadEventsAroundResponseSchema,
  GetThreadReadStateResponseSchema,
  BatchGetThreadReadStatesResponseSchema,
  ListThreadParticipantsResponseSchema,
  ListFollowedThreadsResponseSchema,
  FollowThreadResponseSchema,
  UnfollowThreadResponseSchema,
  MarkThreadAsReadResponseSchema,
  type ThreadFollowState,
  type ThreadReadState,
  type MarkThreadAsReadResult,
  type RoomSummary,
  type ThreadRootAuthorFilter,
  type ThreadOrder,
} from '../schemas/thread'
import { ChattoValidationError } from '../errors'
import { pageRequest, toPage, type Page, type PageOptions } from '../util/page'

type TimelinePage = z.output<typeof GetRoomEventsResponseSchema>['page']

const SERVICE = 'chatto.api.v1.ThreadService'
const MAX_BATCH = 100

/** One page of a thread timeline. */
export interface ThreadEventsPage {
  /** Messages in chronological order (oldest first). Non-message events are dropped. */
  messages: Message[]
  /** Opaque cursor for paging older (`before`). */
  startCursor?: string
  /** Opaque cursor for paging newer (`after`). */
  endCursor?: string
  hasOlder: boolean
  hasNewer: boolean
  /** Viewer follow/unread/slow-mode state for the thread. */
  viewerState?: ThreadViewerState
}

/** A thread timeline window around an anchor event. */
export interface ThreadEventsWindow extends ThreadEventsPage {
  /** Index of the anchor within `messages`, or -1 when the anchor is not a message. */
  targetIndex: number
}

/** One followed thread, ready to render without further fetches. */
export interface FollowedThread {
  /** Root message, when still visible. */
  rootMessage?: Message
  /** Most recent visible reply, when any. */
  latestReply?: Message
  room?: RoomSummary
  thread?: ThreadSummary
  /** For DM threads: participant ids to derive a label from. Empty for channels. */
  directMessageParticipantUserIds: string[]
}

export interface ListFollowedThreadsOptions extends PageOptions {
  /** Include followed direct-message threads (default false). */
  includeDirectMessageThreads?: boolean
  /** Only threads with unread replies; `totalCount` then counts only those. */
  unreadOnly?: boolean
  /** Filter by root-message author. */
  rootAuthor?: 'viewer' | 'others' | ThreadRootAuthorFilter
  /** Sort order (default newest activity first). */
  order?: 'activity' | 'created' | ThreadOrder
}

/** A thread identified by room and root message id. */
export interface ThreadTarget {
  roomId: string
  threadRootEventId: string
}

const ROOT_AUTHOR: Record<string, ThreadRootAuthorFilter> = {
  viewer: 'THREAD_ROOT_AUTHOR_FILTER_VIEWER',
  others: 'THREAD_ROOT_AUTHOR_FILTER_OTHERS',
}
const ORDER: Record<string, ThreadOrder> = {
  activity: 'THREAD_ORDER_ACTIVITY',
  created: 'THREAD_ORDER_CREATED',
}

/** Thread timelines, follow state and read state (`chatto.api.v1.ThreadService`). */
export class ThreadManager {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Fetch the whole thread (root plus all replies) by walking older pages.
   * Messages are de-duplicated by id.
   */
  async fetchHistory(roomId: string, threadRootEventId: string): Promise<Message[]> {
    const messagesById = new Map<string, Message>()
    const seenCursors = new Set<string>()
    let before: string | undefined

    // Walk older pages via `startCursor` until the server reports no more,
    // de-duping by message id (first occurrence wins) and bailing out if a
    // cursor ever repeats so a misbehaving server can't loop forever.
    for (;;) {
      const res = await this.ctx.rest.post(
        SERVICE,
        'GetThreadEvents',
        { roomId, threadRootEventId, limit: 100, before },
        GetRoomEventsResponseSchema,
      )

      const messages = await this.hydrateEvents(res.page.events)
      for (const message of messages) {
        if (!messagesById.has(message.id)) messagesById.set(message.id, message)
      }

      const cursor = res.page.startCursor
      if (!res.page.hasOlder || cursor == null || cursor.trim() === '' || seenCursors.has(cursor)) {
        return [...messagesById.values()]
      }
      seenCursors.add(cursor)
      before = cursor
    }
  }

  /**
   * Fetch one page of a thread. Without a cursor, returns the latest replies
   * plus the root message. `before`/`after` take `startCursor`/`endCursor` from
   * a previous page (if both are given, `before` wins). `limit` defaults to 50
   * (max 500). Requires room membership and read access.
   */
  async fetchEvents(
    roomId: string,
    threadRootEventId: string,
    opts: { limit?: number; before?: string; after?: string } = {},
  ): Promise<ThreadEventsPage> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'GetThreadEvents',
      {
        roomId,
        threadRootEventId,
        limit: opts.limit,
        // `before`/`after` form a oneof, encoded flat in proto3 JSON.
        before: opts.before,
        after: opts.before == null ? opts.after : undefined,
      },
      GetThreadEventsResponseSchema,
    )
    return this.toEventsPage(res.page, res.viewerState)
  }

  /**
   * Fetch a thread window centred on `eventId` (e.g. to open a reply from a
   * notification). `limit` defaults to 50; the root is always included.
   */
  async fetchEventsAround(
    roomId: string,
    threadRootEventId: string,
    eventId: string,
    opts: { limit?: number } = {},
  ): Promise<ThreadEventsWindow> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'GetThreadEventsAround',
      { roomId, threadRootEventId, eventId, limit: opts.limit },
      GetThreadEventsAroundResponseSchema,
    )
    const page = await this.toEventsPage(res.page, res.viewerState)
    const anchorId = res.page.events[res.targetIndex]?.id ?? eventId
    return { ...page, targetIndex: page.messages.findIndex(m => m.id === anchorId) }
  }

  /**
   * Distinct thread authors (root author plus reply authors, excluding erased
   * users), ordered by user id. Page size defaults to 50 (max 100).
   */
  async fetchParticipants(roomId: string, threadRootEventId: string, page?: PageOptions): Promise<Page<string>> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'ListThreadParticipants',
      { roomId, threadRootEventId, page: pageRequest(page) },
      ListThreadParticipantsResponseSchema,
    )
    return toPage(res.userIds, res.page)
  }

  /**
   * List threads the current user follows (channel threads only unless
   * `includeDirectMessageThreads`). Page size defaults to 20 (max 100). Activity
   * can reorder results between pages; restart at offset 0 after an update.
   */
  async listFollowed(opts: ListFollowedThreadsOptions = {}): Promise<Page<FollowedThread>> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'ListFollowedThreads',
      {
        page: pageRequest(opts),
        includeDirectMessageThreads: opts.includeDirectMessageThreads || undefined,
        unreadOnly: opts.unreadOnly || undefined,
        rootAuthorFilter: opts.rootAuthor == null ? undefined : (ROOT_AUTHOR[opts.rootAuthor] ?? opts.rootAuthor),
        order: opts.order == null ? undefined : (ORDER[opts.order] ?? opts.order),
      },
      ListFollowedThreadsResponseSchema,
    )
    const threads = await Promise.all(
      res.threads.map(async t => ({
        rootMessage: t.rootMessage == null ? undefined : await this.ctx.hydrateMessage(t.rootMessage),
        latestReply: t.latestReply == null ? undefined : await this.ctx.hydrateMessage(t.latestReply),
        room: t.room,
        thread: t.thread,
        directMessageParticipantUserIds: t.directMessageParticipantUserIds,
      })),
    )
    return toPage(threads, res.page)
  }

  /** Follow a thread. Requires membership and read access. */
  async follow(roomId: string, threadRootEventId: string): Promise<ThreadFollowState> {
    const res = await this.ctx.rest.post(SERVICE, 'FollowThread', { roomId, threadRootEventId }, FollowThreadResponseSchema)
    return res.state ?? { roomId, threadRootEventId, following: true }
  }

  /** Stop following a thread. */
  async unfollow(roomId: string, threadRootEventId: string): Promise<ThreadFollowState> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'UnfollowThread',
      { roomId, threadRootEventId },
      UnfollowThreadResponseSchema,
    )
    return res.state ?? { roomId, threadRootEventId, following: false }
  }

  /**
   * Mark a thread read through `upToEventId` (a thread event) without touching
   * the room read marker. Omit it to mark through the latest reply. A stale
   * request keeps the newer marker.
   */
  async markAsRead(roomId: string, threadRootEventId: string, upToEventId?: string): Promise<MarkThreadAsReadResult> {
    return this.ctx.rest.post(
      SERVICE,
      'MarkThreadAsRead',
      { roomId, threadRootEventId, upToEventId },
      MarkThreadAsReadResponseSchema,
    )
  }

  /** Read the viewer's stored thread read marker without changing it. `marker` is absent if never set. */
  async fetchReadState(roomId: string, threadRootEventId: string): Promise<ThreadReadState> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'GetThreadReadState',
      { roomId, threadRootEventId },
      GetThreadReadStateResponseSchema,
    )
    return res.state ?? { roomId, threadRootEventId }
  }

  /**
   * Read up to 100 thread read states. Missing and inaccessible threads are
   * omitted; order follows the request, de-duplicated.
   */
  async fetchReadStates(targets: ThreadTarget[]): Promise<ThreadReadState[]> {
    if (targets.length === 0) return []
    if (targets.length > MAX_BATCH) {
      throw new ChattoValidationError('too_many_threads', `At most ${MAX_BATCH} thread read states may be fetched at once`)
    }
    const res = await this.ctx.rest.post(
      SERVICE,
      'BatchGetThreadReadStates',
      { targets: targets.map(t => ({ roomId: t.roomId, threadRootEventId: t.threadRootEventId })) },
      BatchGetThreadReadStatesResponseSchema,
    )
    return res.states
  }

  private hydrateEvents(events: TimelinePage['events']): Promise<Message[]> {
    return Promise.all(
      events
        .filter(e => e.messagePosted != null)
        .map(e => this.ctx.hydrateMessage(e.messagePosted!.message)),
    )
  }

  private async toEventsPage(
    page: TimelinePage,
    viewerState: ThreadViewerState | undefined,
  ): Promise<ThreadEventsPage> {
    return {
      messages: await this.hydrateEvents(page.events),
      startCursor: page.startCursor || undefined,
      endCursor: page.endCursor || undefined,
      hasOlder: page.hasOlder,
      hasNewer: page.hasNewer,
      viewerState,
    }
  }
}
