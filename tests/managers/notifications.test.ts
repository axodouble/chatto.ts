import { describe, it, expect, mock } from 'bun:test'
import { NotificationManager } from '../../src/managers/notifications'
import { ChattoValidationError } from '../../src/errors'

const SVC = 'chatto.api.v1.NotificationService'
const POLICY = 'chatto.api.v1.NotificationPolicyService'

// The mock runs the real Zod schema (4th arg), like RestClient does, so the
// tests exercise proto3 default handling.
function makeCtx(postReturn: unknown) {
  const ctx: any = { rest: {}, reply: postReturn }
  ctx.rest.post = mock(async (_s: string, _m: string, _b: unknown, schema: any) => schema.parse(ctx.reply))
  return ctx
}
function setReply(ctx: any, value: unknown) {
  ctx.reply = value
}
function lastCall(ctx: any) {
  return ctx.rest.post.mock.calls.at(-1)
}

const occurrenceWire = {
  id: 'N_1',
  createdAt: '2026-11-10T00:00:00Z',
  actor: { id: 'U_2', login: 'bob' },
  signal: {
    roleMentionReceived: {
      message: { room: { id: 'R_1', kind: 'ROOM_KIND_CHANNEL', name: 'general' }, eventId: 'E_1', threadRootEventId: 'E_0' },
      roleNames: ['ops'],
    },
  },
  unread: true,
  expiresAt: '2027-02-08T00:00:00Z',
  attentionLevel: 'NOTIFICATION_ATTENTION_LEVEL_IMPORTANT',
}

// Live server output: the JSON encoder emits the deprecated alias names.
const policyWire = {
  policy: {
    scope: { roomId: 'R_1' },
    policy: {
      overrides: { reactions: 'NOTIFICATION_DELIVERY_MODE_SILENT' },
      effective: {
        directMessages: 'NOTIFICATION_DELIVERY_MODE_ALERT',
        followedThreads: 'NOTIFICATION_DELIVERY_MODE_SILENT',
        followedRooms: 'NOTIFICATION_DELIVERY_MODE_OFF',
        reactions: 'NOTIFICATION_DELIVERY_MODE_SILENT',
        roomMessages: 'NOTIFICATION_DELIVERY_MODE_UNREAD_BADGE',
        roomInvitations: 'NOTIFICATION_DELIVERY_MODE_PUSH_NOTIFICATION',
      },
    },
  },
}

describe('NotificationManager — occurrences', () => {
  it('list() sends the page and returns counters', async () => {
    const ctx = makeCtx({
      occurrences: [occurrenceWire],
      page: { totalCount: '3', hasMore: true },
      unreadCount: 2,
      importantUnreadCount: 1,
      nextExpiryAt: '2027-01-01T00:00:00Z',
      roomUnreadCounts: [{ roomId: 'R_1', unreadCount: 2 }],
    })
    const list = await new NotificationManager(ctx).list({ limit: 1 })
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'ListNotificationOccurrences', { page: { limit: 1, offset: undefined } }])
    expect(list.totalCount).toBe(3)
    expect(list.hasMore).toBe(true)
    expect(list.unreadCount).toBe(2)
    expect(list.importantUnreadCount).toBe(1)
    expect(list.roomUnreadCounts).toEqual([{ roomId: 'R_1', unreadCount: 2, importantUnreadCount: 0 }])
    const n = list.items[0]!
    expect(n.signal.kind).toBe('roleMentionReceived')
    expect(n.signal.roleMentionReceived!.roleNames).toEqual(['ops'])
    expect(n.signal.roleMentionReceived!.message!.room!.name).toBe('general')
    expect(n.attentionLevel).toBe('NOTIFICATION_ATTENTION_LEVEL_IMPORTANT')
  })

  it('list() handles the empty `{ page: {} }` response and validates limit', async () => {
    const ctx = makeCtx({ page: {} })
    const list = await new NotificationManager(ctx).list()
    expect(lastCall(ctx)[2]).toEqual({ page: undefined })
    expect(list).toEqual({
      items: [], totalCount: 0, hasMore: false, unreadCount: 0, importantUnreadCount: 0,
      nextExpiryAt: undefined, roomUnreadCounts: [],
    })
    await expect(new NotificationManager(ctx).list({ limit: 101 })).rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('fetch() parses a minimal occurrence and unknown signal kinds', async () => {
    const ctx = makeCtx({ occurrence: { id: 'N_2', signal: { someFutureSignal: { x: 1 } } } })
    const n = await new NotificationManager(ctx).fetch('N_2')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'GetNotificationOccurrence', { notificationId: 'N_2' }])
    expect(n.unread).toBe(false)
    expect(n.attentionLevel).toBe('NOTIFICATION_ATTENTION_LEVEL_UNSPECIFIED')
    expect(n.signal.kind).toBe('unknown')
    expect((n.signal as any).someFutureSignal).toEqual({ x: 1 })

    setReply(ctx, { occurrence: { id: 'N_3' } })
    expect((await new NotificationManager(ctx).fetch('N_3')).signal.kind).toBe('unknown')
  })

  it('fetchMany() short-circuits, validates, and calls BatchGet', async () => {
    const ctx = makeCtx({})
    const m = new NotificationManager(ctx)
    expect(await m.fetchMany([])).toEqual([])
    expect(ctx.rest.post).not.toHaveBeenCalled()
    await expect(m.fetchMany(Array.from({ length: 101 }, (_, i) => `N_${i}`))).rejects.toBeInstanceOf(ChattoValidationError)
    expect(await m.fetchMany(['N_1'])).toEqual([])
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'BatchGetNotificationOccurrences', { notificationIds: ['N_1'] }])
  })

  it('markRead() returns the updated occurrence', async () => {
    const ctx = makeCtx({ occurrence: { ...occurrenceWire, unread: undefined } })
    const n = await new NotificationManager(ctx).markRead('N_1')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'MarkNotificationRead', { notificationId: 'N_1' }])
    expect(n.unread).toBe(false)
  })

  it('delete() / deleteMany() / deleteAll()', async () => {
    const ctx = makeCtx({ deleted: true })
    const m = new NotificationManager(ctx)
    expect(await m.delete('N_1')).toBe(true)
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'DeleteNotificationOccurrence', { notificationId: 'N_1' }])
    setReply(ctx, {})
    expect(await m.delete('N_1')).toBe(false)

    expect(await m.deleteMany([])).toBe(0)
    setReply(ctx, { deletedCount: 2 })
    expect(await m.deleteMany(['N_1', 'N_2'])).toBe(2)
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'BatchDeleteNotificationOccurrences', { notificationIds: ['N_1', 'N_2'] }])
    await expect(m.deleteMany(Array.from({ length: 101 }, (_, i) => `N_${i}`))).rejects.toBeInstanceOf(ChattoValidationError)

    setReply(ctx, {})
    expect(await m.deleteAll()).toBe(0)
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'DeleteAllNotificationOccurrences', {}])
  })
})

describe('NotificationManager — policies', () => {
  it('fetchPolicy() encodes scopes and normalizes deprecated mode aliases', async () => {
    const ctx = makeCtx(policyWire)
    const m = new NotificationManager(ctx)
    const p = await m.fetchPolicy({ roomId: 'R_1' })
    expect(lastCall(ctx).slice(0, 3)).toEqual([POLICY, 'GetNotificationPolicy', { scope: { roomId: 'R_1' } }])
    expect(p.scope).toEqual({ kind: 'room', roomId: 'R_1' })
    expect(p.policy.overrides).toEqual({ reactions: 'NOTIFICATION_DELIVERY_MODE_IN_APP_NOTIFICATION' })
    expect(p.policy.effective.directMessages).toBe('NOTIFICATION_DELIVERY_MODE_PUSH_NOTIFICATION')
    expect(p.policy.effective.followedThreads).toBe('NOTIFICATION_DELIVERY_MODE_IN_APP_NOTIFICATION')
    expect(p.policy.effective.roomInvitations).toBe('NOTIFICATION_DELIVERY_MODE_PUSH_NOTIFICATION')
    expect(p.policy.effective.roomMessages).toBe('NOTIFICATION_DELIVERY_MODE_UNREAD_BADGE')
    expect(p.policy.effective.replies).toBeUndefined()

    await m.fetchPolicy('server')
    expect(lastCall(ctx)[2]).toEqual({ scope: { server: {} } })
    await m.fetchPolicy({ roomGroupId: 'G_1' })
    expect(lastCall(ctx)[2]).toEqual({ scope: { roomGroupId: 'G_1' } })
    await m.fetchPolicy({ kind: 'room', roomId: 'R_9' })
    expect(lastCall(ctx)[2]).toEqual({ scope: { roomId: 'R_9' } })
  })

  it('fetchPolicy() parses the server scope and empty overrides', async () => {
    const ctx = makeCtx({ policy: { scope: { server: {} }, policy: { overrides: {} } } })
    const p = await new NotificationManager(ctx).fetchPolicy('server')
    expect(p).toEqual({ scope: { kind: 'server' }, policy: { overrides: {}, effective: {} } })
  })

  it('fetchPolicies() batches scopes', async () => {
    const ctx = makeCtx({})
    const m = new NotificationManager(ctx)
    expect(await m.fetchPolicies([])).toEqual([])
    expect(ctx.rest.post).not.toHaveBeenCalled()
    expect(await m.fetchPolicies(['server', { roomId: 'R_1' }])).toEqual([])
    expect(lastCall(ctx).slice(0, 3)).toEqual([POLICY, 'BatchGetNotificationPolicies', {
      scopes: [{ server: {} }, { roomId: 'R_1' }],
    }])
    setReply(ctx, { policies: [policyWire.policy] })
    const [p] = await m.fetchPolicies([{ roomId: 'R_1' }])
    expect(p!.scope).toEqual({ kind: 'room', roomId: 'R_1' })
    await expect(m.fetchPolicies(Array.from({ length: 101 }, () => 'server' as const)))
      .rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('updatePolicy() builds overrides + field mask; null clears to inherit', async () => {
    const ctx = makeCtx(policyWire)
    const m = new NotificationManager(ctx)
    await m.updatePolicy({ roomId: 'R_1' }, {
      reactions: null,
      roomMessages: 'push',
      directMessages: 'NOTIFICATION_DELIVERY_MODE_ALERT',
      replies: 'NOTIFICATION_DELIVERY_MODE_OFF',
    })
    expect(lastCall(ctx).slice(0, 3)).toEqual([POLICY, 'UpdateNotificationPolicy', {
      scope: { roomId: 'R_1' },
      overrides: {
        directMessages: 'NOTIFICATION_DELIVERY_MODE_PUSH_NOTIFICATION',
        replies: 'NOTIFICATION_DELIVERY_MODE_OFF',
        roomMessages: 'NOTIFICATION_DELIVERY_MODE_PUSH_NOTIFICATION',
      },
      updateMask: 'directMessages,replies,reactions,roomMessages',
    }])
    await expect(m.updatePolicy('server', {})).rejects.toBeInstanceOf(ChattoValidationError)
  })
})
