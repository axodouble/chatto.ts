import { describe, it, expect, mock } from 'bun:test'
import { AdminDiagnosticsManager } from '../../../src/managers/admin/diagnostics'

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

// Trimmed from a live Chatto 0.5.0 server.
const wire = {
  systemInfo: {
    connection: { connected: true, serverId: 'NAGM', serverName: 'NAGM', version: '2.14.7', maxPayload: '1048576', rtt: '5.624µs' },
    account: { memory: '-1', memoryUsed: '513', storage: '-1', storageUsed: '2793843', streams: -1, streamsUsed: 8, consumers: -1, consumersUsed: 23 },
    nats: {
      totalMessages: '1795', totalBytes: '2794356',
      streams: [{ name: 'EVT', subjects: ['evt.>'], storage: 'File', messages: '1507', bytes: '501637', firstSequence: '1', lastSequence: '1530', consumerCount: 16, replicas: 1 }],
      consumers: [{ stream: 'EVT', name: 'c1', pullBased: true, pending: '2' }],
    },
    stats: { userCount: 2, channelRoomCount: 3, dmRoomCount: 6 },
  },
  projections: [{
    key: 'server_content_view', name: 'Server Content View', subjects: ['evt.>'], started: true,
    startupDurationSeconds: 0.0037, lastAppliedSequence: '1530', failedSequence: '0', entryCount: '295',
    metrics: [{ name: 'catalog_rooms', value: '8', bytes: '780' }, { name: 'catalog_archived_rooms' }],
  }],
  assetCleanup: { health: 'ADMIN_ASSET_CLEANUP_HEALTH_HEALTHY', lastInspectedSequence: '0', latestDeletionSequence: '0' },
  durableWorkers: [{ key: 'asset_cleanup', health: 'ADMIN_DURABLE_WORKER_HEALTH_HEALTHY', pendingCount: '0', waitingCount: '1' }],
  projectionsAvailable: true,
  livekit: { webhookUrl: 'http://localhost:4000/webhooks/livekit', connectionState: 'ADMIN_LIVE_KIT_CONNECTION_STATE_NOT_CONFIGURED' },
}

describe('AdminDiagnosticsManager', () => {
  it('getSystemInfo() calls the RPC and coerces int64 fields', async () => {
    const ctx = makeCtx(wire)
    const info = await new AdminDiagnosticsManager(ctx).getSystemInfo()
    expect(lastCall(ctx).slice(0, 3)).toEqual(['chatto.admin.v1.AdminDiagnosticsService', 'GetSystemInfo', {}])
    expect(info.systemInfo.connection.maxPayload).toBe(1048576)
    expect(info.systemInfo.account.memory).toBe(-1)
    expect(info.systemInfo.nats.totalConsumerPending).toBe(0)
    expect(info.systemInfo.nats.streams[0]!.messages).toBe(1507)
    expect(info.systemInfo.nats.streams[0]!.clusterLeader).toBe('')
    expect(info.systemInfo.nats.consumers[0]!.pending).toBe(2)
    expect(info.systemInfo.nats.consumers[0]!.filterSubjects).toEqual([])
    expect(info.projections[0]!.metrics[1]).toEqual({ name: 'catalog_archived_rooms', value: 0, bytes: 0 })
    expect(info.projections[0]!.lag).toBe(0)
    expect(info.assetCleanup.pendingCount).toBe(0)
    expect(info.durableWorkers[0]!.ackPendingCount).toBe('')
    expect(info.livekit.enabled).toBe(false)
    expect(info.livekit.connectionState).toBe('ADMIN_LIVE_KIT_CONNECTION_STATE_NOT_CONFIGURED')
  })

  it('getSystemInfo() fills defaults for an empty {} response', async () => {
    const info = await new AdminDiagnosticsManager(makeCtx({})).getSystemInfo()
    expect(info.projections).toEqual([])
    expect(info.durableWorkers).toEqual([])
    expect(info.projectionsAvailable).toBeUndefined()
    expect(info.systemInfo.stats).toEqual({ userCount: 0, channelRoomCount: 0, dmRoomCount: 0 })
    expect(info.systemInfo.connection.connected).toBe(false)
    expect(info.systemInfo.nats.streams).toEqual([])
    expect(info.assetCleanup.health).toBe('ADMIN_ASSET_CLEANUP_HEALTH_UNSPECIFIED')
    expect(info.livekit.connectionState).toBe('ADMIN_LIVE_KIT_CONNECTION_STATE_UNSPECIFIED')
  })
})
