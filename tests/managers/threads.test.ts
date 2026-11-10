import { describe, it, expect, mock } from 'bun:test'
import { ThreadManager } from '../../src/managers/threads'
import { Message } from '../../src/resources/message'
import { Room } from '../../src/resources/room'
import { User } from '../../src/resources/user'

function makeCtx(postImpl: (svc: string, method: string, payload: any) => unknown) {
  const ctx: any = {
    rest: { post: mock(async (svc: string, method: string, payload: any) => postImpl(svc, method, payload)) },
    hydrateMessage: mock(async (data: any) => new Message(data, ctx, {
      author: User.partial(data.actorId), channel: Room.partial(data.roomId, ctx),
    })),
  }
  return ctx
}

function msg(id: string) {
  return { id, roomId: 'R_1', createdAt: 't', actorId: 'U_1', body: id, reactions: [] }
}

function event(id: string) {
  return { id, createdAt: 't', actorId: 'U_1', messagePosted: { message: msg(id) } }
}

describe('ThreadManager.fetchHistory', () => {
  it('calls GetThreadEvents with the thread root and a top-level cursor', async () => {
    const ctx = makeCtx(() => ({ page: { events: [event('evt_1')], hasOlder: false, hasNewer: false } }))
    const msgs = await new ThreadManager(ctx).fetchHistory('R_1', 'root_1')
    expect(ctx.rest.post).toHaveBeenCalledWith(
      'chatto.api.v1.ThreadService',
      'GetThreadEvents',
      expect.objectContaining({ roomId: 'R_1', threadRootEventId: 'root_1', limit: 100 }),
      expect.anything(),
    )
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toBeInstanceOf(Message)
  })

  it('filters out non-message timeline events', async () => {
    const ctx = makeCtx(() => ({
      page: { events: [{ id: 'sys', createdAt: 't', actorId: 'system' }], hasOlder: false, hasNewer: false },
    }))
    const msgs = await new ThreadManager(ctx).fetchHistory('R_1', 'root_1')
    expect(msgs).toHaveLength(0)
  })

  it('paginates through older pages via startCursor until hasOlder is false', async () => {
    const pages = [
      { page: { events: [event('evt_3'), event('evt_2')], startCursor: 'c1', hasOlder: true, hasNewer: false } },
      { page: { events: [event('evt_1')], startCursor: 'c2', hasOlder: false, hasNewer: false } },
    ]
    let call = 0
    const ctx = makeCtx((_svc, _method, payload) => {
      const page = pages[call++]
      // first request has no cursor; second must carry the previous startCursor
      if (call === 1) expect(payload.before).toBeUndefined()
      if (call === 2) expect(payload.before).toBe('c1')
      return page
    })
    const msgs = await new ThreadManager(ctx).fetchHistory('R_1', 'root_1')
    expect(ctx.rest.post).toHaveBeenCalledTimes(2)
    expect(msgs.map(m => m.id)).toEqual(['evt_3', 'evt_2', 'evt_1'])
  })

  it('de-duplicates messages by id across pages (first occurrence wins)', async () => {
    const pages = [
      { page: { events: [event('evt_1')], startCursor: 'c1', hasOlder: true, hasNewer: false } },
      { page: { events: [event('evt_1'), event('evt_0')], startCursor: 'c2', hasOlder: false, hasNewer: false } },
    ]
    let call = 0
    const ctx = makeCtx(() => pages[call++])
    const msgs = await new ThreadManager(ctx).fetchHistory('R_1', 'root_1')
    expect(msgs.map(m => m.id)).toEqual(['evt_1', 'evt_0'])
  })

  it('stops when the server repeats a cursor (cycle guard)', async () => {
    const ctx = makeCtx(() => ({
      page: { events: [event('evt_1')], startCursor: 'loop', hasOlder: true, hasNewer: false },
    }))
    const msgs = await new ThreadManager(ctx).fetchHistory('R_1', 'root_1')
    // page 1 fetches then sets cursor 'loop'; page 2 returns 'loop' again -> stop
    expect(ctx.rest.post).toHaveBeenCalledTimes(2)
    expect(msgs).toHaveLength(1)
  })

  it('stops when startCursor is missing or blank even if hasOlder is true', async () => {
    const ctx = makeCtx(() => ({
      page: { events: [event('evt_1')], startCursor: '   ', hasOlder: true, hasNewer: false },
    }))
    const msgs = await new ThreadManager(ctx).fetchHistory('R_1', 'root_1')
    expect(ctx.rest.post).toHaveBeenCalledTimes(1)
    expect(msgs).toHaveLength(1)
  })
})

// Parses responses through the real schema so proto3-omitted fields get defaults.
function makeParsingCtx(postImpl: (method: string, payload: any) => unknown) {
  const ctx: any = makeCtx(() => null)
  ctx.rest.post = mock(async (_svc: string, method: string, payload: any, schema: any) =>
    schema.parse(postImpl(method, payload)))
  return ctx
}

describe('ThreadManager v0.5', () => {
  it('fetchEvents() sends cursors as a flat oneof and returns a page with viewer state', async () => {
    const ctx = makeParsingCtx(() => ({
      page: { events: [event('root'), event('r1')], startCursor: 's', endCursor: 'e', hasOlder: true },
      viewerState: { isFollowing: true },
    }))
    const page = await new ThreadManager(ctx).fetchEvents('R_1', 'root', { limit: 10, before: 'c', after: 'ignored' })
    expect(ctx.rest.post.mock.calls[0].slice(0, 3)).toEqual([
      'chatto.api.v1.ThreadService', 'GetThreadEvents',
      { roomId: 'R_1', threadRootEventId: 'root', limit: 10, before: 'c', after: undefined },
    ])
    expect(page.messages.map(m => m.id)).toEqual(['root', 'r1'])
    expect(page).toMatchObject({ startCursor: 's', endCursor: 'e', hasOlder: true, hasNewer: false })
    expect(page.viewerState?.isFollowing).toBe(true)
  })

  it('fetchEvents() handles an empty page', async () => {
    const ctx = makeParsingCtx(() => ({ page: {} }))
    const page = await new ThreadManager(ctx).fetchEvents('R_1', 'root')
    expect(page).toMatchObject({ messages: [], hasOlder: false, hasNewer: false, startCursor: undefined })
  })

  it('fetchEventsAround() maps targetIndex onto the message list', async () => {
    const ctx = makeParsingCtx(() => ({
      page: { events: [{ id: 'sys', createdAt: 't', actorId: 'x' }, event('root'), event('r1')] },
      targetIndex: 2,
      viewerState: {},
    }))
    const win = await new ThreadManager(ctx).fetchEventsAround('R_1', 'root', 'r1', { limit: 5 })
    expect(ctx.rest.post.mock.calls[0][1]).toBe('GetThreadEventsAround')
    expect(ctx.rest.post.mock.calls[0][2]).toEqual({ roomId: 'R_1', threadRootEventId: 'root', eventId: 'r1', limit: 5 })
    expect(win.targetIndex).toBe(1)
    expect(win.messages[win.targetIndex]?.id).toBe('r1')
  })

  it('fetchParticipants() calls ListThreadParticipants', async () => {
    const ctx = makeParsingCtx(() => ({ userIds: ['U1'], page: { totalCount: '1' } }))
    const page = await new ThreadManager(ctx).fetchParticipants('R_1', 'root', { limit: 10, offset: 5 })
    expect(ctx.rest.post.mock.calls[0][2]).toEqual({ roomId: 'R_1', threadRootEventId: 'root', page: { limit: 10, offset: 5 } })
    expect(page).toEqual({ items: ['U1'], totalCount: 1, hasMore: false })
  })

  it('listFollowed() maps friendly options and hydrates root/latest messages', async () => {
    const ctx = makeParsingCtx(() => ({
      threads: [{
        rootMessage: msg('root'),
        latestReply: { ...msg('r1'), threadRootEventId: 'root' },
        room: { id: 'R_1', kind: 'ROOM_KIND_CHANNEL', name: 'general' },
        thread: { threadRootEventId: 'root', replyCount: 1 },
      }, {}],
      includes: { users: { U_1: { id: 'U_1', login: 'u' } } },
      page: { totalCount: '2', hasMore: true },
    }))
    const page = await new ThreadManager(ctx).listFollowed({
      limit: 2, unreadOnly: true, includeDirectMessageThreads: true, rootAuthor: 'others', order: 'THREAD_ORDER_CREATED',
    })
    expect(ctx.rest.post.mock.calls[0][2]).toEqual({
      page: { limit: 2, offset: undefined }, includeDirectMessageThreads: true, unreadOnly: true,
      rootAuthorFilter: 'THREAD_ROOT_AUTHOR_FILTER_OTHERS', order: 'THREAD_ORDER_CREATED',
    })
    expect(page.totalCount).toBe(2)
    expect(page.hasMore).toBe(true)
    expect(page.items[0]?.rootMessage).toBeInstanceOf(Message)
    expect(page.items[0]?.latestReply?.id).toBe('r1')
    expect(page.items[0]?.room?.name).toBe('general')
    expect(page.items[1]).toEqual({
      rootMessage: undefined, latestReply: undefined, room: undefined, thread: undefined,
      directMessageParticipantUserIds: [],
    })
  })

  it('listFollowed() with no options sends an empty request and parses {}', async () => {
    const ctx = makeParsingCtx(() => ({}))
    const page = await new ThreadManager(ctx).listFollowed()
    expect(ctx.rest.post.mock.calls[0][2]).toEqual({
      page: undefined, includeDirectMessageThreads: undefined, unreadOnly: undefined, rootAuthorFilter: undefined, order: undefined,
    })
    expect(page).toEqual({ items: [], totalCount: 0, hasMore: false })
  })

  it('follow()/unfollow() return the follow state (defaulting omitted following=false)', async () => {
    const ctx = makeParsingCtx(method => method === 'FollowThread'
      ? { state: { roomId: 'R_1', threadRootEventId: 'root', following: true } }
      : { state: { roomId: 'R_1', threadRootEventId: 'root' } })
    const mgr = new ThreadManager(ctx)
    expect((await mgr.follow('R_1', 'root')).following).toBe(true)
    expect((await mgr.unfollow('R_1', 'root')).following).toBe(false)
    expect(ctx.rest.post.mock.calls.map((c: any[]) => [c[1], c[2]])).toEqual([
      ['FollowThread', { roomId: 'R_1', threadRootEventId: 'root' }],
      ['UnfollowThread', { roomId: 'R_1', threadRootEventId: 'root' }],
    ])
  })

  it('markAsRead() calls MarkThreadAsRead with an optional upToEventId', async () => {
    const ctx = makeParsingCtx(() => ({ lastReadAt: '2026-01-01T00:00:00Z' }))
    const res = await new ThreadManager(ctx).markAsRead('R_1', 'root', 'r1')
    expect(ctx.rest.post.mock.calls[0][2]).toEqual({ roomId: 'R_1', threadRootEventId: 'root', upToEventId: 'r1' })
    expect(res).toEqual({ lastReadAt: '2026-01-01T00:00:00Z' })
  })

  it('fetchReadState() returns the state, including an absent marker', async () => {
    const ctx = makeParsingCtx(() => ({ state: { roomId: 'R_1', threadRootEventId: 'root' } }))
    const state = await new ThreadManager(ctx).fetchReadState('R_1', 'root')
    expect(ctx.rest.post.mock.calls[0][1]).toBe('GetThreadReadState')
    expect(state).toEqual({ roomId: 'R_1', threadRootEventId: 'root' })
  })

  it('fetchReadStates() batches targets, short-circuits on [] and caps at 100', async () => {
    const ctx = makeParsingCtx(() => ({
      states: [{ roomId: 'R_1', threadRootEventId: 'root', marker: { lastReadEventId: 'r1', lastReadAt: 't' } }],
    }))
    const mgr = new ThreadManager(ctx)
    expect(await mgr.fetchReadStates([])).toEqual([])
    expect(ctx.rest.post).not.toHaveBeenCalled()
    const states = await mgr.fetchReadStates([{ roomId: 'R_1', threadRootEventId: 'root' }])
    expect(ctx.rest.post.mock.calls[0][1]).toBe('BatchGetThreadReadStates')
    expect(ctx.rest.post.mock.calls[0][2]).toEqual({ targets: [{ roomId: 'R_1', threadRootEventId: 'root' }] })
    expect(states[0]?.marker?.lastReadEventId).toBe('r1')
    const many = Array.from({ length: 101 }, (_, i) => ({ roomId: 'R', threadRootEventId: `t${i}` }))
    await expect(mgr.fetchReadStates(many)).rejects.toThrow()
  })
})
