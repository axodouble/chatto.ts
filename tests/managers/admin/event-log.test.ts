import { describe, it, expect, mock } from 'bun:test'
import { AdminEventLogManager } from '../../../src/managers/admin/event-log'

const SVC = 'chatto.admin.v1.AdminEventLogService'

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

// Captured from a live Chatto 0.5.0 server.
const entryWire = {
  sequence: '1530', subject: 'evt.user.U_owner.privileged_mode_activated', aggregateType: 'user',
  aggregateId: 'U_owner', eventType: 'PrivilegedModeActivatedEvent', eventId: 'EA84edDbk51OWaB',
  actorId: 'U_owner', createdAt: '2026-11-10T00:32:24.941493175Z', payloadJson: '{\n  "id":  "EA84edDbk51OWaB"\n}',
}

describe('AdminEventLogManager', () => {
  it('list() without options sends no filter and parses counters', async () => {
    const ctx = makeCtx({ entries: [entryWire], hasOlder: true, endCursor: '1530', totalCount: '1507', scannedCount: 1, scanLimit: 1 })
    const page = await new AdminEventLogManager(ctx).list({ limit: 1 })
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'ListEvents', { limit: 1, before: undefined, filter: undefined }])
    expect(page.totalCount).toBe(1507)
    expect(page.endCursor).toBe('1530')
    expect(page.scanLimited).toBe(false)
    expect(JSON.parse(page.entries[0]!.payloadJson).id).toBe('EA84edDbk51OWaB')
  })

  it('list() builds the filter (Date → RFC 3339) and handles {}', async () => {
    const ctx = makeCtx({})
    const page = await new AdminEventLogManager(ctx).list({
      before: '1500', eventType: 'MessagePostedEvent', actorId: 'U1',
      from: new Date('2026-11-01T00:00:00Z'), to: '2026-11-02T00:00:00Z',
    })
    expect(lastCall(ctx)[2]).toEqual({
      limit: undefined, before: '1500',
      filter: { eventType: 'MessagePostedEvent', actorId: 'U1', createdAtFrom: '2026-11-01T00:00:00.000Z', createdAtTo: '2026-11-02T00:00:00Z' },
    })
    expect(page).toEqual({ entries: [], hasOlder: false, totalCount: 0, scannedCount: 0, scanLimit: 0, scanLimited: false })
  })

  it('listEventTypes() returns names; [] when omitted', async () => {
    const ctx = makeCtx({ eventTypes: ['AssetCreatedEvent', 'MessagePostedEvent'] })
    const m = new AdminEventLogManager(ctx)
    expect(await m.listEventTypes()).toEqual(['AssetCreatedEvent', 'MessagePostedEvent'])
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'ListEventTypes', {}])
    setReply(ctx, {})
    expect(await m.listEventTypes()).toEqual([])
  })

  it('fetch() stringifies the sequence and defaults fields', async () => {
    const ctx = makeCtx({ entry: { sequence: '1' } })
    const e = await new AdminEventLogManager(ctx).fetch(1)
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'GetEvent', { sequence: '1' }])
    expect(e).toEqual({
      sequence: '1', subject: '', aggregateType: '', aggregateId: '', eventType: '', eventId: '', actorId: '', payloadJson: '',
    })
  })
})
