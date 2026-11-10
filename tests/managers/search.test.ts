import { describe, it, expect, mock } from 'bun:test'
import { SearchManager } from '../../src/managers/search'
import { Message } from '../../src/resources/message'
import { Room } from '../../src/resources/room'
import { User } from '../../src/resources/user'
import { ChattoValidationError } from '../../src/errors'

const SVC = 'chatto.api.v1.MessageSearchService'

function makeCtx(postImpl: (method: string, body: any) => unknown) {
  const ctx: any = {
    // Runs the real Zod schema (4th arg), like RestClient does.
    rest: { post: mock(async (_s: string, method: string, body: any, schema: any) => schema.parse(postImpl(method, body))) },
    hydrateMessage: mock(async (data: any) => new Message(data, ctx, {
      author: User.partial(data.actorId), channel: Room.partial(data.roomId, ctx),
    })),
  }
  return ctx
}

const msg = (id: string) => ({ id, roomId: 'R_1', createdAt: 't', actorId: 'U_1', body: `body ${id}` })

describe('SearchManager', () => {
  it('status() parses state and retryAfter', async () => {
    const ctx = makeCtx(() => ({ state: 'MESSAGE_SEARCH_STATE_INDEXING', retryAfter: '1.500s' }))
    const status = await new SearchManager(ctx).status()
    expect(ctx.rest.post.mock.calls[0].slice(0, 3)).toEqual([SVC, 'GetStatus', {}])
    expect(status).toEqual({ state: 'MESSAGE_SEARCH_STATE_INDEXING', retryAfter: '1.500s', retryAfterMs: 1500 })
  })

  it('status() defaults an empty response to UNSPECIFIED and unknown states via catch', async () => {
    expect((await new SearchManager(makeCtx(() => ({}))).status()).state).toBe('MESSAGE_SEARCH_STATE_UNSPECIFIED')
    expect((await new SearchManager(makeCtx(() => ({ state: 'MESSAGE_SEARCH_STATE_NEW' }))).status()).state)
      .toBe('MESSAGE_SEARCH_STATE_UNSPECIFIED')
  })

  it('search() maps options to the wire request', async () => {
    const ctx = makeCtx(() => ({}))
    await new SearchManager(ctx).search('deploy', {
      roomId: 'R_1', authorId: 'U_1', createdAfter: new Date('2026-01-01T00:00:00Z'), createdBefore: '2026-02-01T00:00:00Z',
      hasAttachments: true, order: 'newest', scope: 'followed_threads', groupBy: 'thread', rootAuthorFilter: 'viewer',
      pageSize: 10, cursor: 'c1',
    })
    expect(ctx.rest.post.mock.calls[0].slice(0, 3)).toEqual([SVC, 'SearchMessages', {
      query: 'deploy', roomId: 'R_1', authorId: 'U_1',
      createdAfter: '2026-01-01T00:00:00.000Z', createdBefore: '2026-02-01T00:00:00Z',
      hasAttachments: true, order: 'MESSAGE_SEARCH_ORDER_NEWEST', pageSize: 10, cursor: 'c1',
      scope: 'MESSAGE_SEARCH_SCOPE_FOLLOWED_THREADS', groupBy: 'MESSAGE_SEARCH_GROUP_BY_THREAD',
      rootAuthorFilter: 'THREAD_ROOT_AUTHOR_FILTER_VIEWER',
    }])
  })

  it('search() passes raw proto enum names through', async () => {
    const ctx = makeCtx(() => ({}))
    await new SearchManager(ctx).search('x', { order: 'MESSAGE_SEARCH_ORDER_THREAD_CREATED' })
    expect(ctx.rest.post.mock.calls[0][2].order).toBe('MESSAGE_SEARCH_ORDER_THREAD_CREATED')
  })

  it('search() returns an empty page for `{}`', async () => {
    const page = await new SearchManager(makeCtx(() => ({}))).search('nothing')
    expect(page).toEqual({ results: [], nextCursor: null, threadTotalCount: undefined, users: {} })
  })

  it('search() hydrates message results', async () => {
    const ctx = makeCtx(() => ({
      results: [{ message: msg('E_1'), relevanceScore: 2.5 }, { message: msg('E_2') }],
      nextCursor: 'c2',
    }))
    const page = await new SearchManager(ctx).search('body')
    expect(page.nextCursor).toBe('c2')
    expect(page.results).toHaveLength(2)
    expect(page.results[0]!.message).toBeInstanceOf(Message)
    expect(page.results[0]!.message.content).toBe('body E_1')
    expect(page.results[0]!.relevanceScore).toBe(2.5)
    expect(page.results[1]!.relevanceScore).toBe(0)
    expect(page.results[0]!.thread).toBeUndefined()
  })

  it('search() hydrates thread-grouped results with context and includes', async () => {
    const ctx = makeCtx(() => ({
      results: [{
        message: msg('E_reply'),
        relevanceScore: 1,
        threadContext: {
          rootMessage: msg('E_root'),
          room: { id: 'R_1', kind: 'ROOM_KIND_CHANNEL', name: 'general' },
          thread: { threadRootEventId: 'E_root', replyCount: 3 },
          latestReply: msg('E_latest'),
        },
      }],
      threadTotalCount: '7',
      includes: { users: { U_1: { id: 'U_1', login: 'alice' } } },
    }))
    const page = await new SearchManager(ctx).search('x', { groupBy: 'thread' })
    const thread = page.results[0]!.thread!
    expect(thread.rootMessage).toBeInstanceOf(Message)
    expect(thread.rootMessage!.id).toBe('E_root')
    expect(thread.latestReply!.id).toBe('E_latest')
    expect(thread.room).toEqual({ id: 'R_1', kind: 'ROOM_KIND_CHANNEL', name: 'general' })
    expect(thread.thread!.replyCount).toBe(3)
    expect(thread.directMessageParticipantUserIds).toEqual([])
    expect(page.threadTotalCount).toBe(7)
    expect(page.users.U_1!.login).toBe('alice')
  })

  it('search() validates query and page size', async () => {
    const m = new SearchManager(makeCtx(() => ({})))
    await expect(m.search('')).rejects.toBeInstanceOf(ChattoValidationError)
    await expect(m.search('é'.repeat(513))).rejects.toBeInstanceOf(ChattoValidationError)
    await expect(m.search('x', { pageSize: 101 })).rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('searchAll() follows cursors until the end', async () => {
    const pages: Record<string, unknown> = {
      '': { results: [{ message: msg('E_1') }], nextCursor: 'c1' },
      c1: { results: [{ message: msg('E_2') }], nextCursor: 'c2' },
      c2: { results: [{ message: msg('E_3') }] },
    }
    const ctx = makeCtx((_m, body) => pages[body.cursor ?? ''])
    const ids: string[] = []
    for await (const hit of new SearchManager(ctx).searchAll('x', { pageSize: 1 })) ids.push(hit.message.id)
    expect(ids).toEqual(['E_1', 'E_2', 'E_3'])
    expect(ctx.rest.post.mock.calls.map((c: any[]) => c[2].cursor)).toEqual([undefined, 'c1', 'c2'])
  })

  it('searchAll() stops on a repeated cursor and respects maxPages', async () => {
    const ctx = makeCtx(() => ({ results: [{ message: msg('E_1') }], nextCursor: 'same' }))
    const ids: string[] = []
    for await (const hit of new SearchManager(ctx).searchAll('x')) ids.push(hit.message.id)
    expect(ctx.rest.post).toHaveBeenCalledTimes(2)
    expect(ids).toEqual(['E_1', 'E_1'])

    let n = 0
    const ctx2 = makeCtx(() => ({ results: [{ message: msg('E') }], nextCursor: `c${++n}` }))
    let count = 0
    for await (const _ of new SearchManager(ctx2).searchAll('x', { maxPages: 3 })) count++
    expect(count).toBe(3)
    expect(ctx2.rest.post).toHaveBeenCalledTimes(3)
  })
})
